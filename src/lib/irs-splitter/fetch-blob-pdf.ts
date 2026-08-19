/** Lỗi rõ nghĩa khi không tải được file PDF từ Vercel Blob (URL hết hạn/đã bị xoá/sai) --
 * route gọi hàm này bắt riêng lỗi này để trả đúng message cho client thay vì lỗi chung
 * chung "không đọc được file PDF". */
export class BlobFetchError extends Error {}

const FETCH_RETRY_ATTEMPTS = 3;
const FETCH_RETRY_DELAYS_MS = [300, 800];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tải bytes của 1 file đã upload lên Vercel Blob (client upload thẳng lên Blob, né giới
 * hạn ~4.5MB thân request của Serverless Function -- xem `/api/irs-splitter/blob-upload`)
 * -- dùng chung giữa route `analyze` và `split` (tab "Tách thư").
 *
 * Tự retry (3 lần, 300ms/800ms) trước khi báo lỗi -- phòng lỗi mạng/rate-limit thoáng qua ở
 * Vercel Blob thay vì fail ngay ở lần thử đầu tiên. */
export async function fetchBlobPdfBytes(blobUrl: unknown): Promise<Uint8Array> {
  if (typeof blobUrl !== "string" || !blobUrl) {
    throw new BlobFetchError("Thiếu blobUrl");
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < FETCH_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(FETCH_RETRY_DELAYS_MS[attempt - 1]);
    try {
      const res = await fetch(blobUrl);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  console.error("[fetchBlobPdfBytes] thất bại sau", FETCH_RETRY_ATTEMPTS, "lần thử", lastError);
  throw new BlobFetchError("Không tải được file từ storage tạm (link có thể đã hết hạn) -- vui lòng chọn lại file.");
}
