/** Lỗi rõ nghĩa khi xử lý vượt quá thời gian cho phép -- route bắt riêng lỗi này để trả về
 * 1 response JSON sạch (thay vì để Vercel tự cắt kết nối ngang xương ở mốc `maxDuration`,
 * khiến trình duyệt cứ chờ vô thời hạn vì không nhận được response nào cả -- đây chính là
 * nguyên nhân bug "đứng yên mãi ở Analyzing..." gặp thật trên production 2026-08-18 với file
 * 48MB, xem `.claude/rules/deployment-database-sync.md` mục 4.31). */
export class ProcessingTimeoutError extends Error {}

/** Đua 1 Promise xử lý với 1 timer nội bộ, NGẮN HƠN `maxDuration` của route (route đang đặt
 * 60s trên gói Vercel Hobby -- mốc CỨNG không nâng được bằng code) -- để chủ động trả lỗi rõ
 * ràng TRƯỚC khi Vercel cắt kết nối. Không thật sự dừng được code đang chạy (JS đơn luồng),
 * chỉ đua ở các điểm `await` (giữa từng trang PDF) -- đủ để bắt các file quá lớn/quá nhiều
 * trang mà không đủ để cắt 1 tác vụ đồng bộ dài bất thường trong 1 trang đơn lẻ. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProcessingTimeoutError(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
