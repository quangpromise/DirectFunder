/**
 * Status nào cho phép "Send row to Google Sheet"/"Send mail to CPA"/"Test Sheet" — DENYLIST
 * (2026-08-13, yêu cầu "trừ các status X, tất cả status khác đều thấy nút"): mọi status ĐỀU
 * hợp lệ trừ nhóm liệt kê dưới đây (giai đoạn đầu xử lý hồ sơ, chưa tới lúc gửi CPA/Google
 * Sheet) — bao gồm cả status TÙY CHỈNH Admin thêm sau này. id các status tùy chỉnh dạng
 * "opt-xxxxx" random KHÁC NHAU giữa các environment nên phải so khớp theo LABEL (không thể
 * hardcode id) — chuẩn hoá cả 2 vế (lowercase, bỏ ký tự không phải chữ/số, bỏ "s" cuối) để
 * khớp được dù Admin gõ "Missing Doc"/"Missing Docs", "On-Hold"/"Onhold"...
 *
 * DÙNG CHUNG cả CLIENT (ẩn/hiện nút, xem cases/page.tsx) lẫn SERVER (chặn gửi thật nếu status
 * hiện tại không hợp lệ) — MỘT NGUỒN LOGIC DUY NHẤT. Trước 2026-08-16, route
 * send-to-sheet/route.ts còn hard-code check `status !== "cpa_review"` từ thiết kế allowlist
 * cũ, không theo kịp denylist mới này — hậu quả: nút Send/"Mark as sent" vẫn hiện đúng trên
 * UI cho mọi status khác "cpa_review", nhưng bấm vào LUÔN báo lỗi 400 (production, hồ sơ
 * "Van Do Dung Nguyen" đang ở status tuỳ chỉnh khác "cpa_review" là ví dụ thật gặp phải).
 */
export function normalizeStatusLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/s$/, "");
}

export const EXCLUDED_SEND_BUTTONS_STATUS_LABELS = new Set(
  ["Pre-processing", "Processing", "Missing Doc", "Cancelled", "Onhold", "Disqualified", "Duplicate"].map(
    normalizeStatusLabel
  )
);

export function canShowSendButtonsForStatusLabel(label: string): boolean {
  return !EXCLUDED_SEND_BUTTONS_STATUS_LABELS.has(normalizeStatusLabel(label));
}
