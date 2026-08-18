/** Lỗi rõ nghĩa khi không tải được file PDF từ Vercel Blob (URL hết hạn/đã bị xoá/sai) --
 * route gọi hàm này bắt riêng lỗi này để trả đúng message cho client thay vì lỗi chung
 * chung "không đọc được file PDF". */
export class BlobFetchError extends Error {}

/** Tải bytes của 1 file đã upload lên Vercel Blob (client upload thẳng lên Blob, né giới
 * hạn ~4.5MB thân request của Serverless Function -- xem `/api/irs-splitter/blob-upload`)
 * -- dùng chung giữa route `analyze` và `split`. */
export async function fetchBlobPdfBytes(blobUrl: unknown): Promise<Uint8Array> {
  if (typeof blobUrl !== "string" || !blobUrl) {
    throw new BlobFetchError("Thiếu blobUrl");
  }
  const res = await fetch(blobUrl);
  if (!res.ok) {
    throw new BlobFetchError("Không tải được file từ storage tạm (link có thể đã hết hạn) -- vui lòng chọn lại file.");
  }
  return new Uint8Array(await res.arrayBuffer());
}
