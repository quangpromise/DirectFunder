import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { syncRecordToCpaReviewSheet, deleteRecordRowFromCpaReviewSheet } from "@/lib/cpa-review-sheet-sync";
import { extractChangedYearStatuses, syncCpaReviewStatusToCase } from "@/lib/cpa-review-case-sync";
import { broadcastCpaReviewChanged } from "@/lib/pusher-server";
import { toCpaReviewRecord } from "@/app/api/cpa-review/route";
import type { FeaturePermissions } from "@/lib/types";
import type { Prisma } from "@prisma/client";

const ALLOWED_FIELDS = new Set(["custom", "sortOrder"]);

/** Row đã gán Processor (custom.processorUserId) -> CHỈ đúng tài khoản đó, hoặc role
 * manager/processor_leader (quản lý trực tiếp), mới sửa/xoá được — theo yêu cầu 2026-09-02
 * "chỉ có tài khoản gắn tên Processor mới được sửa xóa ở row đó". Row CHƯA gán ai (rỗng) vẫn
 * mở cho mọi user có quyền vào tab này — chưa có ai để khoá theo. Đây là lớp CHẶN AUTHORITATIVE
 * (client cũng tự disable UI tương ứng ở cpa-review/page.tsx, nhưng chặn thật nằm ở đây). */
function canEditRecord(me: { id: string; role: string }, custom: Record<string, unknown>): boolean {
  const assignedProcessorId = typeof custom.processorUserId === "string" ? custom.processorUserId : "";
  if (!assignedProcessorId) return true;
  if (me.role === "manager" || me.role === "processor_leader") return true;
  return assignedProcessorId === me.id;
}

const ROW_LOCKED_MESSAGE = "Dòng này đã gán cho Processor khác — chỉ đúng Processor đó hoặc Quản lý/Processor Leader mới sửa/xoá được";

/** Không kiểm tra editableBy theo từng key (cột cố định, không admin cấu hình) — mọi user
 * có quyền viewCpaReview đều sửa được mọi ô (đơn giản hoá, đúng tinh thần "tab riêng biệt"
 * yêu cầu 2026-08-14), enforcement chỉ ở mức đã đăng nhập tại server, ẩn/hiện toàn tab ở
 * client theo hasFeature("viewCpaReview") — TRỪ ràng buộc theo Processor đã gán (canEditRecord
 * ở trên, thêm 2026-09-02). */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/cpa-review/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });

  const currentRow = await prisma.cpaReviewRecord.findUnique({ where: { id }, select: { custom: true } });
  if (!currentRow) return NextResponse.json({ error: "Không tìm thấy dòng" }, { status: 404 });
  const currentCustom = (currentRow.custom as Record<string, unknown>) ?? {};
  if (!canEditRecord(me, currentCustom)) {
    return NextResponse.json({ error: ROW_LOCKED_MESSAGE }, { status: 403 });
  }

  const data: Prisma.CpaReviewRecordUpdateInput = {};
  // Status theo năm (key `status_<năm>`) đổi sang Accepted/TTS Refund/Done -> tự đổi
  // refundYearStatus tương ứng của Case khớp SSN (xem cpa-review-case-sync.ts) — chỉ xét
  // field THỰC SỰ có trong request này (incomingCustom), không phải toàn bộ custom đã merge.
  let changedYearStatuses: { year: string; status: string }[] = [];
  let mergedSsn = "";
  for (const [field, value] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(field)) continue;
    if (field === "custom" && value && typeof value === "object") {
      // Merge cộng dồn — cùng cơ chế "custom" của Case/Collecting, tránh ghi đè mất giá
      // trị các cột khác nếu 2 người sửa gần như cùng lúc. Dùng lại currentCustom đã đọc ở
      // trên (không fetch lại lần 2).
      const existingCustom = currentCustom;
      const incomingCustom = value as Record<string, unknown>;
      // "__syncedFrom" — đánh dấu lần ghi này tới từ APP (thêm 2026-08-31), để webhook
      // Sheet→App phân biệt được "app vừa ghi thật" (cần chặn theo nguyên tắc App luôn thắng)
      // với "chính webhook Sheet vừa ghi trước đó vài giây" (KHÔNG chặn — xem isSourcedFromApp
      // trong webhook route.ts).
      const merged: Record<string, unknown> = { ...existingCustom, ...incomingCustom, __syncedFrom: "app" };
      data.custom = merged as Prisma.InputJsonValue;
      changedYearStatuses = extractChangedYearStatuses(incomingCustom);
      mergedSsn = typeof merged.ssn === "string" ? merged.ssn : "";
      continue;
    }
    (data as Record<string, unknown>)[field] = value;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Không có trường hợp lệ để cập nhật" }, { status: 400 });
  }

  const row = await prisma.cpaReviewRecord.update({ where: { id }, data });
  const record = toCpaReviewRecord(row);
  after(() => syncRecordToCpaReviewSheet(record));
  if (changedYearStatuses.length > 0) {
    after(() => syncCpaReviewStatusToCase(mergedSsn, changedYearStatuses));
  }
  await broadcastCpaReviewChanged(record.id, request.headers.get("x-pusher-socket-id"));

  return NextResponse.json({ id: row.id, updatedAt: row.updatedAt.toISOString() });
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/cpa-review/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "deleteCpaReviewRow", me.role)) {
    return NextResponse.json({ error: "Không có quyền xoá dòng" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const existing = await prisma.cpaReviewRecord.findUnique({ where: { id } });
  if (existing && !canEditRecord(me, (existing.custom as Record<string, unknown>) ?? {})) {
    return NextResponse.json({ error: ROW_LOCKED_MESSAGE }, { status: 403 });
  }
  await prisma.cpaReviewRecord.delete({ where: { id } });

  if (existing) {
    after(() => deleteRecordRowFromCpaReviewSheet(toCpaReviewRecord(existing)));
  }
  await broadcastCpaReviewChanged(id, request.headers.get("x-pusher-socket-id"));

  return NextResponse.json({ ok: true });
}
