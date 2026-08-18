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
 * -- dùng chung giữa route `analyze`, `split`, và `compress-chunk`.
 *
 * Tự retry (3 lần, 300ms/800ms) trước khi báo lỗi -- route `compress-chunk` (nén PDF theo
 * TỪNG TRANG, xem `pdf-compress-panel.tsx`) gọi hàm này RẤT NHIỀU LẦN cho CÙNG 1 blobUrl
 * trong 1 lượt nén (mỗi request tự tải lại toàn bộ file gốc dù chỉ cần render 1 trang, vì mỗi
 * lần gọi là 1 serverless invocation độc lập, không chia sẻ được bytes đã tải giữa các lần) --
 * gặp thật production (2026-08-19): file 10MB/10-50 trang, hàng chục lần tải lặp lại trong
 * vài giây làm lộ ra lỗi mạng/rate-limit thoáng qua ở 1 lần tải cụ thể, trước đây không có
 * retry nên fail cả lượt nén dù chỉ 1/nhiều chục lần tải bị trục trặc. */
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
