import { NextRequest, NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { cleanupOldHistory } from "@/lib/history-cleanup";
import { cleanupOldGeminiUsageLogs } from "@/lib/gemini-usage";

export const runtime = "nodejs";
export const maxDuration = 60;

// File tải lên tab "Notice Splitter"/"Nén PDF" bình thường sống RẤT ngắn (bị xoá ngay sau
// khi xử lý xong, xem deployment-database-sync.md mục 4.31) -- 2 giờ đã rất rộng rãi so với
// thời gian xử lý thật (thường dưới vài phút), chỉ mồ côi khi người dùng bỏ dở/gặp lỗi giữa
// chừng (đóng tab, mất mạng, timeout...).
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Vercel Cron (xem vercel.json, chạy 1 LẦN/NGÀY lúc 12:00 UTC) — dọn các file mồ côi trên
 * Vercel Blob (upload dở dang do lỗi/đóng tab giữa chừng ở tab "Notice Splitter"/"Nén PDF",
 * KHÔNG bao giờ được xoá vì thao tác chưa bao giờ hoàn tất để chạm tới bước `del()` best-effort
 * trong code chính -- xem `.claude/rules/deployment-database-sync.md` mục 4.31). Vercel Blob
 * KHÔNG có TTL/tự xoá -- phải tự dọn bằng code.
 *
 * Lịch ban đầu (2026-08-18) đặt mỗi GIỜ (`0 * * * *`) nhưng gói Hobby CHỈ cho phép cron chạy
 * tối đa 1 lần/ngày -- mọi deployment kể từ lúc thêm cron giờ đó đều bị Vercel CHẶN NGAY Ở
 * BƯỚC VALIDATE (không phải build lỗi, không hiện trong danh sách Deployments như thường lệ,
 * chỉ báo qua email "Deployment failed... Hobby accounts are limited to daily cron jobs") --
 * đổi về 1 lần/ngày (2026-08-19) để deploy lại được bình thường. File mồ côi giờ có thể tồn
 * tại tới ~24h+2h trước khi bị dọn thay vì tối đa ~3h trước đây -- chấp nhận được vì đây chỉ
 * là dọn rác, không ảnh hưởng chức năng chính.
 *
 * Xác thực bằng CRON_SECRET (cùng cơ chế `cron/ringcentral-renew`) — KHÔNG dùng
 * session/requireUser() vì Vercel Cron không đăng nhập.
 *
 * Cũng piggyback dọn lịch sử sửa/xoá hồ sơ quá 30 ngày (xem `src/lib/history-cleanup.ts`) VÀ
 * dọn log usage Gemini quá 2 ngày (xem `src/lib/gemini-usage.ts`, dùng cho bảng "Rate Limit"
 * trong popup "Get Files") ở đây — cùng lý do "không đăng ký thêm Cron Job riêng" như các
 * piggyback khác trong repo, các việc độc lập nhau, lỗi bên nào không chặn bên kia.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let historyCleanup: { deletedEdits: number; deletedDeletions: number } | { error: string };
  try {
    historyCleanup = await cleanupOldHistory();
  } catch (err) {
    console.error("[cron blob-cleanup] dọn lịch sử thất bại:", err);
    historyCleanup = { error: "Dọn lịch sử quá 30 ngày thất bại." };
  }

  let geminiUsageCleanup: { deletedRows: number } | { error: string };
  try {
    geminiUsageCleanup = { deletedRows: await cleanupOldGeminiUsageLogs() };
  } catch (err) {
    console.error("[cron blob-cleanup] dọn log usage Gemini thất bại:", err);
    geminiUsageCleanup = { error: "Dọn log usage Gemini quá 2 ngày thất bại." };
  }

  const cutoff = Date.now() - MAX_AGE_MS;
  let deletedCount = 0;
  let scannedCount = 0;

  try {
    let cursor: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const page = await list({ cursor, limit: 1000 });
      scannedCount += page.blobs.length;
      const stale = page.blobs.filter((b) => b.uploadedAt.getTime() < cutoff);
      if (stale.length > 0) {
        await del(stale.map((b) => b.url));
        deletedCount += stale.length;
      }
      hasMore = page.hasMore;
      cursor = page.cursor;
    }

    return NextResponse.json({ ok: true, scannedCount, deletedCount, historyCleanup, geminiUsageCleanup });
  } catch (err) {
    console.error("[cron blob-cleanup]", err);
    return NextResponse.json(
      { ok: false, error: "Dọn dẹp Blob thất bại.", historyCleanup, geminiUsageCleanup },
      { status: 502 }
    );
  }
}
