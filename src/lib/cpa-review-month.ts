/** Khoá tháng "YYYY-MM" dùng làm key của `CpaReviewRecord.month` +
 * `AppConfig.cpaReviewSheetConfig[monthKey]` — mỗi tháng 1 bảng dữ liệu/kết nối Sheet riêng
 * (thêm 2026-08-14, yêu cầu "chọn tháng nào sẽ ra bảng của tháng đó"). */

import { toPhoenixDateStr } from "@/lib/report-period";

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** LUÔN tính theo giờ Phoenix (múi giờ nghiệp vụ công ty), KHÔNG dùng giờ hệ điều hành —
 * lỗi thật gặp trên production (thêm 2026-08-30): hàm này gọi cả ở SERVER (route
 * `test-cpa-review-sheet`, chạy trên Vercel = giờ UTC) lẫn client. Gần nửa đêm giờ Phoenix
 * (UTC-7, không có DST) — vd 17h-24h giờ Phoenix mỗi ngày — UTC đã sang NGÀY/THÁNG MỚI
 * trước đó ~7 tiếng, khiến "Test Sheet" tạo dòng CPA Review vào SAI tháng (tháng sau) dù
 * "hôm nay" thực tế của công ty vẫn còn thuộc tháng cũ — đúng triệu chứng người dùng báo
 * ("hệ thống vẫn tháng 8 nhưng đã sent đến row tháng 9"). Cùng cách khắc phục đã dùng cho
 * `todayIsoDate()` (date-format.ts). */
export function currentMonthKey(): string {
  return toPhoenixDateStr(new Date()).slice(0, 7);
}

export function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function isValidMonthKey(key: string): boolean {
  return MONTH_KEY_RE.test(key);
}

export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return toMonthKey(date);
}

const VI_MONTH_LABEL = (key: string): string => {
  const [y, m] = key.split("-");
  return `Tháng ${Number(m)}, ${y}`;
};

export function monthKeyLabel(key: string): string {
  return VI_MONTH_LABEL(key);
}
