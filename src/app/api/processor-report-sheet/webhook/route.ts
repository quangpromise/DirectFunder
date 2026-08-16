import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getProcessorReportSheetConfigMap, findProcessorReportConfigBySecret } from "@/lib/processor-report-sheet-sync";

/** Khoảng thời gian "app vừa sửa ô này" tính là còn mới — nếu Sheet báo thay đổi tới trong
 * lúc ô đã được app cập nhật gần đây hơn khoảng này, coi đó là đụng độ với chính lần app vừa
 * đẩy đi và bỏ qua (App luôn thắng, cùng nguyên tắc CPA Review). */
const APP_WINS_GRACE_MS = 5000;

function isRecentlyUpdatedByApp(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() < APP_WINS_GRACE_MS;
}

/**
 * Webhook nhận thay đổi TỪ Google Sheet (Apps Script `onProcessorReportEdit`) cho bảng tổng
 * hợp Processor Leader — public route, xác thực bằng `secret` riêng theo tháng. Hàng/cột đều
 * đã biết trước (taskRowMap/userColumnMap lưu lúc connect/resync) — chỉ ghi đè
 * ProcessorReportMonthlySummary.value nếu row/col khớp đúng 1 ô (task, processor) đã cache,
 * KHÔNG tự tạo record/cột mới cho ô lạ (khác CPA Review — ở đây hàng/cột không phải business
 * key tự do). LƯU Ý ngữ nghĩa: giá trị sửa tay này là số TÍNH RA (không phải bản ghi gốc),
 * sẽ bị ghi đè lại ngay khi chính Processor đó sửa thêm 1 entry của đúng task/tháng này —
 * xem deployment-database-sync.md.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const secret = typeof body?.secret === "string" ? body.secret : "";
  if (!secret) return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });

  const configMap = await getProcessorReportSheetConfigMap();
  const found = findProcessorReportConfigBySecret(configMap, secret);
  if (!found) return NextResponse.json({ error: "Secret không hợp lệ" }, { status: 401 });
  const { month, config } = found;

  const row = typeof body?.row === "number" ? body.row : Number(body?.row);
  const col = typeof body?.col === "number" ? body.col : Number(body?.col);
  const rawValue = typeof body?.value === "string" ? body.value : "";
  if (!Number.isFinite(row) || !Number.isFinite(col)) {
    return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });
  }

  const taskId = Object.entries(config.taskRowMap).find(([, r]) => r === row)?.[0];
  const userId = Object.entries(config.userColumnMap).find(([, c]) => c === col)?.[0];
  if (!taskId || !userId) {
    return NextResponse.json({ ok: true, skipped: "row_or_col_not_mapped" });
  }

  const parsed = Number(rawValue.replace(/[^0-9.-]/g, ""));
  const value = Number.isFinite(parsed) ? Math.round(parsed) : 0;

  const existing = await prisma.processorReportMonthlySummary.findUnique({
    where: { month_taskId_userId: { month, taskId, userId } },
  });
  if (existing && isRecentlyUpdatedByApp(existing.updatedAt)) {
    return NextResponse.json({ ok: true, skipped: "app_wins_recent_update" });
  }

  await prisma.processorReportMonthlySummary.upsert({
    where: { month_taskId_userId: { month, taskId, userId } },
    create: { month, taskId, userId, value },
    update: { value },
  });

  return NextResponse.json({ ok: true });
}
