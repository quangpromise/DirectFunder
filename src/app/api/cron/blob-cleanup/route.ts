import { NextRequest, NextResponse } from "next/server";
import { list, del } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 60;

// File tải lên tab "Notice Splitter"/"Nén PDF" bình thường sống RẤT ngắn (bị xoá ngay sau
// khi xử lý xong, xem deployment-database-sync.md mục 4.31) -- 2 giờ đã rất rộng rãi so với
// thời gian xử lý thật (thường dưới vài phút), chỉ mồ côi khi người dùng bỏ dở/gặp lỗi giữa
// chừng (đóng tab, mất mạng, timeout...).
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Vercel Cron (xem vercel.json, chạy mỗi giờ) — dọn các file mồ côi trên Vercel Blob (upload
 * dở dang do lỗi/đóng tab giữa chừng ở tab "Notice Splitter"/"Nén PDF", KHÔNG bao giờ được
 * xoá vì thao tác chưa bao giờ hoàn tất để chạm tới bước `del()` best-effort trong code chính
 * -- xem `.claude/rules/deployment-database-sync.md` mục 4.31). Vercel Blob KHÔNG có TTL/tự
 * xoá -- phải tự dọn bằng code.
 *
 * Xác thực bằng CRON_SECRET (cùng cơ chế `cron/ringcentral-renew`) — KHÔNG dùng
 * session/requireUser() vì Vercel Cron không đăng nhập.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    return NextResponse.json({ ok: true, scannedCount, deletedCount });
  } catch (err) {
    console.error("[cron blob-cleanup]", err);
    return NextResponse.json({ ok: false, error: "Dọn dẹp Blob thất bại." }, { status: 502 });
  }
}
