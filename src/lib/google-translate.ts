/**
 * Nút "Dịch" trong header (Languages icon) — dịch văn bản tự do người dùng tự gõ/dán, KHÔNG
 * gắn với hồ sơ/dữ liệu nào (thêm 2026-08-24). Dùng Google Cloud Translation API v2 (REST đơn
 * giản, xác thực bằng API key, KHÁC Service Account đang dùng cho Google Sheets sync — không
 * cần OAuth/JWT vì đây chỉ là 1 lệnh gọi dịch văn bản, không cần quyền truy cập tài nguyên
 * nào của user).
 */

export class GoogleTranslateConfigError extends Error {
  constructor() {
    super("Chưa cấu hình GOOGLE_TRANSLATE_API_KEY");
    this.name = "GoogleTranslateConfigError";
  }
}

export class GoogleTranslateApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleTranslateApiError";
  }
}

export interface TranslateResult {
  translatedText: string;
  detectedSourceLanguage?: string;
}

export async function translateText(
  text: string,
  target: string,
  source?: string,
): Promise<TranslateResult> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) throw new GoogleTranslateConfigError();

  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      target,
      ...(source ? { source } : {}),
      format: "text",
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.data?.translations?.[0]) {
    const message = json?.error?.message ?? `Google Translate API lỗi (HTTP ${res.status})`;
    throw new GoogleTranslateApiError(message);
  }

  const translation = json.data.translations[0];
  return {
    translatedText: translation.translatedText as string,
    detectedSourceLanguage: translation.detectedSourceLanguage as string | undefined,
  };
}

// Danh sách ngôn ngữ thường dùng cho dropdown — không cần gọi API "languages.list" (thêm 1
// round-trip không cần thiết cho 1 danh sách gần như cố định).
export const TRANSLATE_LANGUAGES: { code: string; label: string }[] = [
  { code: "vi", label: "Tiếng Việt" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "zh", label: "中文 (Chinese)" },
  { code: "fr", label: "Français" },
  { code: "ja", label: "日本語 (Japanese)" },
  { code: "ko", label: "한국어 (Korean)" },
  { code: "de", label: "Deutsch" },
  { code: "ru", label: "Русский" },
  { code: "pt", label: "Português" },
  { code: "th", label: "ภาษาไทย (Thai)" },
  { code: "tl", label: "Filipino" },
];
