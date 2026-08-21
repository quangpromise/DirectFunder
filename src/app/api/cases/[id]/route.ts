import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { canEditCase, canEditColumn, hasFeature } from "@/lib/rbac";
import { getFullName, primarySsn } from "@/lib/client-name";
import { todayIsoDate } from "@/lib/date-format";
import { broadcastCaseChanged, broadcastNotification } from "@/lib/pusher-server";
import { toNotificationRecord } from "@/app/api/notifications/route";
import { postTeamsMessage } from "@/lib/teams-webhook";
import { del } from "@vercel/blob";
import type { ClientNameEntry, ColumnDef, DescriptionReply, FeaturePermissions, OrderRecord } from "@/lib/types";
import type { Prisma } from "@prisma/client";

/** Nhãn vai trò hiện trong nội dung thông báo — khớp đúng chữ dùng ở assignCase cũ trong
 * app-store.ts (đã chuyển logic tạo thông báo xuống đây, xem PATCH bên dưới). */
const ASSIGN_FIELD_ROLE_LABEL: Record<string, string> = {
  assignedTo: "Agent",
  assignedTo2: "Agent 2",
  assignedProcessor: "Processor",
  assignedProcessor2: "Processor 2",
};

function caseRefLabel(c: { clients: [ClientNameEntry, ClientNameEntry]; ssn: [string | null, string | null] }): string {
  const name = getFullName(c);
  const ssn = primarySsn(c);
  return ssn ? `${name} (SSN: ${ssn})` : name;
}

/** Ánh xạ tên field của Case (Prisma) sang `key` của ColumnDef tương ứng — dùng để
 * kiểm tra quyền editableBy theo cột khi field đó có cột cấu hình. Field không có
 * trong map (orders, ssn, descriptionReplies, assignedTo...) chỉ yêu cầu đã đăng nhập,
 * enforcement chi tiết hơn sẽ bổ sung khi wiring frontend thật (giai đoạn sau). */
const FIELD_TO_COLUMN_KEY: Record<string, string> = {
  status: "status",
  clients: "clientName",
  zipcode: "zipcode",
  phone: "phone",
  address: "address",
  description: "description",
  caseNumber: "caseNumber",
  money: "money",
  // Dùng chung nguồn phân quyền với cột ẩn "refunds" (ClientProfileDialog) — trạng thái
  // xử lý từng năm gắn liền với refund nên hợp lý để cùng 1 nhóm role sửa được.
  refundYearStatus: "refunds",
  // Cùng nhóm quyền với refundYearStatus (gắn liền với refund từng năm).
  refundYearEfileDate: "refunds",
};

const ALLOWED_FIELDS = new Set([
  "status",
  "clients",
  "clientLink",
  "zipcode",
  "phone",
  "address",
  "description",
  "descriptionReplies",
  "descriptionReadBy",
  "money",
  "orders",
  "ssn",
  "assignedTo",
  "assignedProcessor",
  "assignedTo2",
  "assignedProcessor2",
  "custom",
  "sortOrder",
  "refundYearStatus",
  "refundYearPendingReason",
  "refundYearEfileDate",
]);

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/cases/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { id } = await ctx.params;
  const socketId = request.headers.get("x-pusher-socket-id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });

  // Agent Leader/Processor Leader chỉ được sửa hồ sơ do chính mình thêm vào hoặc đang
  // gán cho thành viên trong nhóm mình phụ trách — kiểm tra riêng theo từng dòng, chặt
  // hơn quyền sửa theo cột (canEditColumn) áp dụng chung cho các role khác.
  if (me.role === "agent_leader" || me.role === "processor_leader") {
    const target = await prisma.case.findUnique({
      where: { id },
      select: { assignedTo: true, assignedProcessor: true, assignedTo2: true, assignedProcessor2: true, createdBy: true },
    });
    if (!target || !canEditCase(me.role, me.id, target, me.teamMemberIds)) {
      return NextResponse.json({ error: "Không có quyền sửa hồ sơ này" }, { status: 403 });
    }
  }

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const columns = (config?.columns as ColumnDef[] | undefined) ?? [];

  // Cần trạng thái "trước khi sửa" để so sánh & tạo thông báo (giao Agent/Processor/Order,
  // Order chuyển Done) — chỉ fetch khi body thực sự đổi 1 trong các field liên quan, để
  // không tốn thêm round-trip DB cho mọi lần sửa ô thông thường (status/description/...).
  // Logic tạo thông báo này trước đây nằm ở client (assignCase/assignOrderSupport/
  // updateOrderStatus trong app-store.ts) — chuyển hẳn xuống đây để người được giao việc
  // thực sự nhận được thông báo trên máy của họ (server mới biết toUserId là AI để bắn
  // Pusher tới đúng kênh riêng của họ, xem broadcastNotification).
  const notifyFields = ["assignedTo", "assignedTo2", "assignedProcessor", "assignedProcessor2", "orders"];
  const before = notifyFields.some((f) => f in body)
    ? await prisma.case.findUnique({
        where: { id },
        select: {
          clients: true,
          ssn: true,
          assignedTo: true,
          assignedTo2: true,
          assignedProcessor: true,
          assignedProcessor2: true,
          orders: true,
        },
      })
    : null;

  // Processor thêm reply mới vào Description -> tự động đăng tin sang kênh Teams của Agent 1
  // (Case.assignedTo, KHÔNG áp dụng Agent 2) — pre-fetch RIÊNG (không gộp vào `before` ở
  // trên, shape khác nhau), CHỈ khi thật sự cần: đúng field "descriptionReplies" VÀ đúng
  // role "processor" (không tính "processor_leader" dù role đó cũng sửa được Description).
  const descriptionRepliesBefore =
    "descriptionReplies" in body && Array.isArray(body.descriptionReplies) && me.role === "processor"
      ? await prisma.case.findUnique({
          where: { id },
          select: { descriptionReplies: true, assignedTo: true, clients: true, ssn: true, phone: true },
        })
      : null;

  const data: Prisma.CaseUpdateInput = {};
  for (const [field, value] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(field)) continue;
    const columnKey = FIELD_TO_COLUMN_KEY[field];
    if (columnKey) {
      const column = columns.find((c) => c.key === columnKey);
      if (column && !canEditColumn(me.role, column)) {
        return NextResponse.json({ error: `Không có quyền sửa cột ${column.label}` }, { status: 403 });
      }
    }
    if (field === "custom" && value && typeof value === "object") {
      const existing = await prisma.case.findUnique({ where: { id }, select: { custom: true } });
      const merged = { ...((existing?.custom as Record<string, unknown>) ?? {}), ...(value as Record<string, unknown>) };
      data.custom = merged as Prisma.InputJsonValue;
      continue;
    }
    // Client chỉ gửi lên đúng 1 năm vừa đổi (vd. { "2024": "pending" }) — merge cộng dồn
    // vào object hiện có trên DB, tránh ghi đè mất trạng thái các năm khác nếu 2 người
    // sửa gần như cùng lúc (cùng cơ chế merge với "custom" ở trên).
    if (field === "refundYearStatus" && value && typeof value === "object") {
      const existing = await prisma.case.findUnique({ where: { id }, select: { refundYearStatus: true } });
      const merged = {
        ...((existing?.refundYearStatus as Record<string, unknown>) ?? {}),
        ...(value as Record<string, unknown>),
      };
      data.refundYearStatus = merged as Prisma.InputJsonValue;
      continue;
    }
    // Không map qua FIELD_TO_COLUMN_KEY (không có bước canEditColumn ở trên) -> mọi user
    // đã đăng nhập đều sửa được, đúng yêu cầu "phân quyền edit cho tất cả user" (khác
    // refundYearStatus vẫn giới hạn theo role của cột "refunds").
    if (field === "refundYearPendingReason" && value && typeof value === "object") {
      const existing = await prisma.case.findUnique({ where: { id }, select: { refundYearPendingReason: true } });
      const merged = {
        ...((existing?.refundYearPendingReason as Record<string, unknown>) ?? {}),
        ...(value as Record<string, unknown>),
      };
      data.refundYearPendingReason = merged as Prisma.InputJsonValue;
      continue;
    }
    if (field === "refundYearEfileDate" && value && typeof value === "object") {
      const existing = await prisma.case.findUnique({ where: { id }, select: { refundYearEfileDate: true } });
      const merged = {
        ...((existing?.refundYearEfileDate as Record<string, unknown>) ?? {}),
        ...(value as Record<string, unknown>),
      };
      data.refundYearEfileDate = merged as Prisma.InputJsonValue;
      continue;
    }
    (data as Record<string, unknown>)[field] = value;
  }

  // "Processing Date" tự động lấy theo LẦN GẦN NHẤT status thật sự chuyển sang "processing"
  // (yêu cầu 2026-08-14) — chỉ set khi đây là 1 lần CHUYỂN TRẠNG THÁI thật (status cũ khác
  // "processing"), không ghi đè mỗi lần chọn lại đúng status đang có sẵn (vd double-click
  // dropdown). Đây là side-effect tự động (giống money/caseLabel tự tính từ refunds ở
  // client-profile route) nên KHÔNG qua check editableBy riêng của cột "processingDate" —
  // đã được phép sửa "status" (kiểm tra ở vòng lặp trên) là đủ điều kiện.
  if (data.status === "processing") {
    const current = await prisma.case.findUnique({ where: { id }, select: { status: true } });
    if (current && current.status !== "processing") {
      data.processingDate = todayIsoDate();
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Không có trường hợp lệ để cập nhật" }, { status: 400 });
  }

  const row = await prisma.case.update({ where: { id }, data });

  if (before) {
    const refLabel = caseRefLabel({
      clients: before.clients as unknown as [ClientNameEntry, ClientNameEntry],
      ssn: before.ssn as unknown as [string | null, string | null],
    });
    const beforeRec = before as unknown as Record<string, string | null>;
    const rowRec = row as unknown as Record<string, string | null>;

    for (const field of Object.keys(ASSIGN_FIELD_ROLE_LABEL)) {
      if (!(field in body)) continue;
      const newVal = rowRec[field];
      if (newVal && newVal !== beforeRec[field]) {
        const notif = await prisma.notification.create({
          data: {
            type: "assigned",
            toUserId: newVal,
            fromUserId: me.id,
            caseId: id,
            message: `${me.name} đã giao cho bạn hồ sơ ${refLabel} vai trò ${ASSIGN_FIELD_ROLE_LABEL[field]}`,
          },
        });
        await broadcastNotification(newVal, toNotificationRecord(notif), socketId);
      }
    }

    if ("orders" in body && Array.isArray(body.orders)) {
      const oldOrders = (before.orders as unknown as OrderRecord[]) ?? [];
      for (const newOrder of body.orders as OrderRecord[]) {
        const oldOrder = oldOrders.find((o) => o.id === newOrder.id);
        const orderLabel = newOrder.type === "orderTtsWit" ? "Order TTS & WIT" : "Order 8821";

        if (newOrder.assignedSupport && newOrder.assignedSupport !== oldOrder?.assignedSupport) {
          const notif = await prisma.notification.create({
            data: {
              type: "assigned",
              toUserId: newOrder.assignedSupport,
              fromUserId: me.id,
              caseId: id,
              message: `${me.name} đã giao cho bạn ${orderLabel} của hồ sơ ${refLabel}`,
            },
          });
          await broadcastNotification(newOrder.assignedSupport, toNotificationRecord(notif), socketId);
        }

        // Order vừa chuyển sang Done (không tính đã Done từ trước) -> báo cho đúng người
        // đã đặt order đó, bỏ qua nếu tự đặt tự hoàn tất (đúng logic cũ updateOrderStatus).
        if (newOrder.status === "done" && oldOrder?.status !== "done" && newOrder.placedBy && newOrder.placedBy !== me.id) {
          const notif = await prisma.notification.create({
            data: {
              type: "status_change",
              toUserId: newOrder.placedBy,
              fromUserId: me.id,
              caseId: id,
              message: `${me.name} đã hoàn tất ${orderLabel} của hồ sơ ${refLabel}`,
            },
          });
          await broadcastNotification(newOrder.placedBy, toNotificationRecord(notif), socketId);
        }
      }
    }
  }

  if (descriptionRepliesBefore) {
    const oldReplies = (descriptionRepliesBefore.descriptionReplies as unknown as DescriptionReply[]) ?? [];
    const newReplies = row.descriptionReplies as unknown as DescriptionReply[];
    // CHỈ tính là "có reply mới" khi mảng dài hơn thật sự (không suy đoán qua nội dung) —
    // tránh false-positive nếu sau này có tính năng sửa/xoá reply dùng chung field này.
    if (newReplies.length > oldReplies.length) {
      const newlyAdded = newReplies.slice(oldReplies.length);
      const agentId = descriptionRepliesBefore.assignedTo;
      const agent = agentId ? await prisma.user.findUnique({ where: { id: agentId }, select: { teamsWebhookUrl: true } }) : null;
      if (agent?.teamsWebhookUrl) {
        const refName = getFullName({ clients: descriptionRepliesBefore.clients as unknown as [ClientNameEntry, ClientNameEntry] });
        const ssn = primarySsn({ ssn: descriptionRepliesBefore.ssn as unknown as [string | null, string | null] });
        const phone = descriptionRepliesBefore.phone || "—";
        const origin = new URL(request.url).origin;
        const link = `${origin}/dashboard/cases?highlight=${id}`;
        const teamsAttachments = Array.isArray(body.teamsAttachments)
          ? (body.teamsAttachments as { name?: unknown; url?: unknown }[]).filter(
              (a): a is { name: string; url: string } => typeof a.name === "string" && typeof a.url === "string"
            )
          : [];

        for (const reply of newlyAdded) {
          const lines = [
            `📌 Processor ${me.name} vừa thêm ghi chú mới cho hồ sơ ${refName} (SSN: ${ssn ?? "—"}, SĐT: ${phone}):`,
            "",
            `"${reply.text}"`,
          ];
          if (teamsAttachments.length > 0) {
            lines.push("", "📎 Tệp đính kèm:", ...teamsAttachments.map((a) => `- ${a.name}: ${a.url}`));
          }
          lines.push("", `🔗 Xem hồ sơ: ${link}`);
          await postTeamsMessage(agent.teamsWebhookUrl, lines.join("\n"));
        }

        // Xoá blob NGAY sau khi gửi xong — file đính kèm KHÔNG lưu lại trong app (best-effort,
        // không chặn response chính nếu xoá lỗi).
        if (teamsAttachments.length > 0) {
          try {
            await del(teamsAttachments.map((a) => a.url));
          } catch (err) {
            console.error("[teams-webhook] Xoá blob tạm thất bại:", err);
          }
        }
      }
    }
  }

  await broadcastCaseChanged(id, socketId);

  return NextResponse.json({ id: row.id, updatedAt: row.updatedAt.toISOString() });
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/cases/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "deleteRow", me.role)) {
    return NextResponse.json({ error: "Không có quyền xoá hồ sơ" }, { status: 403 });
  }

  const { id } = await ctx.params;
  await prisma.case.delete({ where: { id } });
  await broadcastCaseChanged(id, request.headers.get("x-pusher-socket-id"));

  return NextResponse.json({ ok: true });
}
