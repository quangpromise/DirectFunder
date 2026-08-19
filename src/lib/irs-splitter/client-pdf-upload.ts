// Helper dùng chung ở CLIENT (browser) cho tab "Tách thư" trong Notice Splitter -- upload
// file PDF lên Vercel Blob + gọi API xử lý, kèm timeout/lỗi rõ ràng thay vì để trình duyệt
// treo vô thời hạn (xem deployment-database-sync.md mục 4.31 cho bối cảnh đầy đủ: giới hạn
// ~4.5MB thân request của Vercel Serverless Function, gotcha treo vô thời hạn khi hàm bị
// Vercel cắt kết nối, và việc tách riêng % tiến trình upload khỏi trạng thái xử lý ở server).

import { upload } from "@vercel/blob/client";

// Route xử lý (analyze/split/compress) đã tự trả lỗi sớm hơn ở ~50s (xem PROCESSING_TIMEOUT_MS
// phía server) -- timeout phía client đặt ở 55s chỉ là lưới an toàn cuối cùng cho trường hợp
// kết nối bị treo/reset hoàn toàn (không nhận được response nào).
export const CLIENT_FETCH_TIMEOUT_MS = 55_000;

// Ngưỡng riêng cho bước UPLOAD lên Vercel Blob -- không bị ràng buộc bởi `maxDuration` của
// route xử lý (route đó chỉ chạy SAU khi upload xong), nên có thể rộng hơn nhiều. Vẫn cần 1
// ngưỡng hữu hạn để không treo tuyệt đối vô thời hạn nếu kết nối thật sự chết giữa chừng.
export const UPLOAD_TIMEOUT_MS = 5 * 60_000;

// Vercel giới hạn CỨNG dung lượng request body của Serverless Function (~4.5MB) -- vì vậy
// file KHÔNG gửi thẳng qua route handler nữa, mà upload thẳng lên Vercel Blob (né hoàn toàn
// giới hạn đó). Ngưỡng dưới đây chỉ còn là chặn hợp lý phía UI (tránh file quá khổ khiến
// bước xử lý vượt `maxDuration=60` của route), không còn là giới hạn kỹ thuật bắt buộc.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Đọc lỗi từ 1 Response không OK — ưu tiên JSON `{error}` do route handler của app trả về,
 * nhưng fallback an toàn khi response không phải JSON (vd trang lỗi 413 thuần text do chính
 * Vercel platform trả về TRƯỚC route handler). */
export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return (data?.error as string | undefined) || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Upload 1 file PDF THẲNG lên Vercel Blob từ trình duyệt (không qua route handler của app)
 * -- né giới hạn ~4.5MB thân request của Vercel Serverless Function. Ném lại `DOMException`
 * `AbortError` nếu quá `UPLOAD_TIMEOUT_MS` -- caller tự dịch message theo ngôn ngữ hiện tại
 * (hàm này không có quyền truy cập `useT()`). */
export async function uploadPdfToBlob(file: File, onProgress: (percentage: number) => void): Promise<{ url: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    return await upload(file.name, file, {
      access: "public",
      handleUploadUrl: "/api/irs-splitter/blob-upload",
      onUploadProgress: ({ percentage }) => onProgress(percentage),
      abortSignal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
