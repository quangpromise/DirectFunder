import { NextRequest, NextResponse } from "next/server";
import { findOwnReportConfigBySecret, applyOwnReportSheetCells } from "@/lib/processor-own-report-sheet-sync";
import { broadcastProcessorReportChanged } from "@/lib/pusher-server";

/**
 * Webhook nhận thay đổi TỪ Sheet RIÊNG của 1 Processor (Apps Script `onOwnReportEdit`) —
 * public route (Apps Script không có session cookie), xác thực bằng `secret` sinh ngẫu nhiên
 * lúc kết nối, mỗi (user, tháng) 1 secret riêng — route tự dò xem secret khớp user/tháng nào
 * (xem findOwnReportConfigBySecret), Apps Script không cần gửi kèm userId/tháng.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const secret = typeof body?.secret === "string" ? body.secret : "";
  if (!secret) return NextResponse.json({ error: "Thiếu secret" }, { status: 400 });

  const found = await findOwnReportConfigBySecret(secret);
  if (!found) return NextResponse.json({ error: "Secret không hợp lệ" }, { status: 404 });

  const rawCells = Array.isArray(body?.cells) ? body.cells : [];
  const cells = rawCells
    .map((c: unknown) => {
      const obj = c as { row?: unknown; col?: unknown; rawValue?: unknown };
      const row = typeof obj.row === "number" ? obj.row : Number(obj.row);
      const col = typeof obj.col === "number" ? obj.col : Number(obj.col);
      const rawValue = typeof obj.rawValue === "string" ? obj.rawValue : "";
      return Number.isFinite(row) && Number.isFinite(col) ? { row, col, rawValue } : null;
    })
    .filter((c: unknown): c is { row: number; col: number; rawValue: string } => c !== null);

  if (cells.length === 0) return NextResponse.json({ ok: true, applied: 0 });

  const applied = await applyOwnReportSheetCells(found.userId, found.month, cells);
  // Webhook không có Pusher socket của trình duyệt nào để loại trừ -> socketId = null (mọi
  // trình duyệt đang mở popup "For Processor" đều tự refetch, kể cả chủ nhân Sheet vừa sửa).
  if (applied > 0) await broadcastProcessorReportChanged(null);
  return NextResponse.json({ ok: true, applied });
}
