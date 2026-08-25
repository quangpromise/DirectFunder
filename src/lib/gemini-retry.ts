/**
 * Retry ngắn cho lỗi 429 (rate limit) của Gemini free tier — thêm 2026-08-27 sau khi gặp lỗi
 * thật trên production ("Không gọi được AI" / "Không so sánh được tài liệu"), log server lộ ra
 * `Error [ApiError]: {...} { status: 429 }` từ `@google/genai`. Free tier giới hạn số request/
 * phút khá thấp — 429 thường chỉ là tạm thời (bùng phát nhiều request cùng lúc), retry sau vài
 * giây thường qua được, không cần user tự bấm gửi lại. Dùng cho `crm-doc-compare.ts` (tính
 * năng "So sánh WIT/1040/TTS" — nút "Trợ lý AI" tự do dùng chung `GEMINI_API_KEY` trước đó đã
 * XOÁ 2026-08-27 sau khi vẫn gặp 429 kéo dài kể cả với retry, nghi ngờ quota ngày đã cạn do 2
 * tính năng cộng dồn request — xem `.claude/skills/crm-tts-wit-compare/SKILL.md`).
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
