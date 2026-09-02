import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { recomputeAndPushProcessorReportSummary } from "@/lib/processor-report-sheet-sync";
import { pushOwnReportCell } from "@/lib/processor-own-report-sheet-sync";
import { isValidMonthKey } from "@/lib/cpa-review-month";
import type { FeaturePermissions } from "@/lib/types";

/** true nếu `me` được phép xem/sửa entries của `targetUserId` — chính mình luôn được, Quản
 * lý/Processor Leader được sửa hộ (vd chỉnh giúp 1 con số nhập nhầm). */
function canAccessUser(me: { id: string; role: string }, targetUserId: string): boolean {
  if (targetUserId === me.id) return true;
  return me.role === "manager" || me.role === "processor_leader";
}

async function requireViewAccess() {
  const me = await requireUser();
  if (!me) return { error: NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 }) } as const;
  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "viewForProcessor", me.role)) {
    return { error: NextResponse.json({ error: "Không có quyền truy cập" }, { status: 403 }) } as const;
  }
  return { me } as const;
}

/** GET ?month=YYYY-MM&userId= — mặc định lấy entries của chính mình, Quản lý/Processor
 * Leader có thể xem hộ 1 Processor khác qua ?userId=. */
export async function GET(request: NextRequest) {
  const auth = await requireViewAccess();
  if ("error" in auth) return auth.error;
  const { me } = auth;

  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!isValidMonthKey(month)) return NextResponse.json({ error: "Tháng không hợp lệ" }, { status: 400 });
  const requestedUserId = request.nextUrl.searchParams.get("userId") ?? me.id;
  const userId = canAccessUser(me, requestedUserId) ? requestedUserId : me.id;

  const entries = await prisma.processorReportEntry.findMany({
    where: { userId, date: { startsWith: month } },
  });
  return NextResponse.json({ entries });
}

/** POST/PATCH — upsert 1 ô (taskId, date). Body: { taskId, date, value?, note?, userId? } —
 * `value`/`note` đều OPTIONAL nhưng cần ÍT NHẤT 1 trong 2 (cho phép sửa riêng ghi chú mà
 * không đụng số liệu, dùng cho popup ghi chú ở task "Others 1"/"Others 2" — thêm 2026-09-02,
 * xem NumberCellWithNote trong for-processor-dialog.tsx). Field nào KHÔNG có trong body giữ
 * nguyên giá trị cũ (không ghi đè về 0/rỗng). */
async function upsertEntry(request: NextRequest) {
  const auth = await requireViewAccess();
  if ("error" in auth) return auth.error;
  const { me } = auth;

  const body = await request.json().catch(() => null);
  const taskId = typeof body?.taskId === "string" ? body.taskId : "";
  const date = typeof body?.date === "string" ? body.date : "";
  const hasValue = body?.value !== undefined;
  const value = hasValue ? Number(body.value) : undefined;
  const hasNote = body?.note !== undefined;
  const note = hasNote ? (typeof body.note === "string" ? body.note : "") : undefined;
  if (
    !taskId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    (hasValue && !Number.isFinite(value)) ||
    (!hasValue && !hasNote)
  ) {
    return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });
  }
  const requestedUserId = typeof body?.userId === "string" ? body.userId : me.id;
  const userId = canAccessUser(me, requestedUserId) ? requestedUserId : me.id;
  const month = date.slice(0, 7);

  const entry = await prisma.processorReportEntry.upsert({
    where: { userId_taskId_date: { userId, taskId, date } },
    create: { userId, taskId, date, value: hasValue ? value! : 0, note: hasNote ? note : null },
    update: { ...(hasValue ? { value } : {}), ...(hasNote ? { note } : {}) },
  });

  // Ghi chú thuần app, không đồng bộ Sheet — chỉ đẩy khi THỰC SỰ đổi value (tránh gọi API
  // Sheets thừa mỗi lần chỉ sửa ghi chú).
  if (hasValue) {
    after(() => recomputeAndPushProcessorReportSummary(userId, taskId, month));
    // Đẩy đúng 1 ô lên Sheet RIÊNG của user đó (nếu đã tự kết nối) — hoàn toàn độc lập với
    // bảng tổng hợp của Leader ở trên, không ảnh hưởng gì tới nhau (thêm 2026-09-02).
    after(() => pushOwnReportCell(userId, month, taskId, date, value!));
  }
  return NextResponse.json({ entry });
}

export const POST = upsertEntry;
export const PATCH = upsertEntry;
