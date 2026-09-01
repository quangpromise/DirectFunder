/** 3 chữ đầu tên tháng hiện tại (tiếng Anh) + 2 số cuối năm hiện tại, vd "Aug26" — dùng
 * làm tên tab tháng trên Google Sheet "2026 RA-EC Client list" (mail CPA lẫn nút "Send"
 * ở cột Status đều phải trỏ đúng cùng 1 tab, nên dùng chung 1 hàm duy nhất).
 *
 * LUÔN tính theo giờ Phoenix (múi giờ nghiệp vụ công ty), KHÔNG dùng giờ hệ điều hành —
 * lỗi thật gặp trên production (sửa 2026-08-30): hàm này gọi ở SERVER (route
 * `send-to-sheet`, `cpa-email-template.ts` — chạy trên Vercel = giờ UTC), nên trước đây
 * `now.toLocaleString()`/`now.getFullYear()` đọc theo giờ UTC thay vì giờ Phoenix. Gần nửa
 * đêm giờ Phoenix (UTC-7, không DST) — vd 17h-24h giờ Phoenix mỗi ngày — UTC đã sang
 * NGÀY/THÁNG MỚI trước đó ~7 tiếng, khiến "Send to Google Sheet"/mail CPA trỏ NHẦM sang tab
 * tháng sau dù "hôm nay" thực tế của công ty vẫn còn thuộc tháng cũ. */
export function buildMonthYear(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", year: "2-digit" }).formatToParts(now);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  return `${month}${year}`;
}
