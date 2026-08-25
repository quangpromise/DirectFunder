/**
 * Retry ngắn cho lỗi 429 (rate limit) của Gemini free tier — thêm 2026-08-27 sau khi gặp lỗi
 * thật trên production ("Không gọi được AI" / "Không so sánh được tài liệu"), log server lộ ra
 * `Error [ApiError]: {...} { status: 429 }` từ `@google/genai`. Free tier giới hạn số request/
 * phút khá thấp — 429 thường chỉ là tạm thời (bùng phát nhiều request cùng lúc), retry sau vài
 * giây thường qua được, không cần user tự bấm gửi lại. Dùng chung cho cả `crm-doc-compare.ts`
 * lẫn `gemini-general-chat.ts` (2 tính năng Gemini độc lập trong app, chỉ chia sẻ đúng đoạn
 * logic retry vô hại này, không chia sẻ client/config).
 */
export class GeminiRateLimitError extends Error {}

function isGeminiRateLimitStatus(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: unknown }).status === 429;
}

/** Gọi `fn()`, tự retry tối đa `retries` lần (mặc định 2, cách nhau tăng dần 1.5s/3s) nếu gặp
 * đúng lỗi 429 — lỗi khác ném ngay, không retry. Hết lượt retry mà vẫn 429 thì ném
 * `GeminiRateLimitError` (route gọi phía trên bắt riêng để trả thông báo rõ ràng hơn thay vì
 * "lỗi không xác định" chung chung). */
export async function withGeminiRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 1500): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isGeminiRateLimitStatus(err)) throw err;
    if (retries <= 0) throw new GeminiRateLimitError("Gemini đang bị giới hạn tốc độ (free tier) — thử lại sau ít phút");
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return withGeminiRetry(fn, retries - 1, delayMs * 2);
  }
}
