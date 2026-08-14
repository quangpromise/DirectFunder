/** Khoá tháng "YYYY-MM" dùng làm key của `CpaReviewRecord.month` +
 * `AppConfig.cpaReviewSheetConfig[monthKey]` — mỗi tháng 1 bảng dữ liệu/kết nối Sheet riêng
 * (thêm 2026-08-14, yêu cầu "chọn tháng nào sẽ ra bảng của tháng đó"). */

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function currentMonthKey(): string {
  return toMonthKey(new Date());
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
