/**
 * Retry ngắn cho lỗi 429 (rate limit) của LLM provider bất kỳ — thêm 2026-08-27, đổi tên từ
 * `gemini-retry.ts` (2026-08-27, cùng ngày) sau khi tính năng "So sánh WIT/1040/TTS" đổi hẳn
 * từ Gemini sang **Groq API** (xem `crm-doc-compare.ts` — Gemini free tier chỉ 20 request/NGÀY
 * cho `gemini-3.6-flash`, tính theo Google Cloud Project chứ không phải theo API key, nên tạo
 * key mới trong CÙNG project vẫn dính y hệt quota cũ; đổi hẳn sang Groq — free tier rộng rãi
 * hơn nhiều — thay vì chỉ đổi project). Tên hàm/lỗi giữ TRUNG LẬP theo provider (không còn
 * "Gemini" trong tên) vì giờ chỉ còn 1 nơi dùng (Groq), nhưng thiết kế vẫn provider-agnostic —
 * chỉ cần lỗi ném ra có `status === 429` là retry được, không quan tâm SDK nào.
 */
export class AiRateLimitError extends Error {}

function isRateLimitStatus(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: unknown }).status === 429;
}

/** Gọi `fn()`, tự retry tối đa `retries` lần (mặc định 2, cách nhau tăng dần 1.5s/3s) nếu gặp
 * đúng lỗi 429 — lỗi khác ném ngay, không retry. Hết lượt retry mà vẫn 429 thì ném
 * `AiRateLimitError` (route gọi phía trên bắt riêng để trả thông báo rõ ràng hơn thay vì "lỗi
 * không xác định" chung chung). */
export async function withAiRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 1500): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRateLimitStatus(err)) throw err;
    if (retries <= 0) throw new AiRateLimitError("Đang bị giới hạn tốc độ (rate limit) — thử lại sau ít phút");
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return withAiRetry(fn, retries - 1, delayMs * 2);
  }
}
