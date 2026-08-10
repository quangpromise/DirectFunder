import { DateFormat } from "@/lib/types";

/** Định dạng giá trị cột type "date" (luôn lưu ISO "YYYY-MM-DD") để HIỂN THỊ theo cấu
 * hình Admin chọn — không đổi giá trị lưu trữ, chỉ đổi chuỗi hiển thị (readonly text,
 * không áp dụng cho lúc đang edit vì input type="date" bắt buộc dùng ISO). */
export function formatDateValue(value: string, format: DateFormat | undefined): string {
  if (format !== "mdy2") return value;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const [, year, month, day] = m;
  return `${month}/${day}/${year.slice(-2)}`;
}

/** Định dạng riêng cho cột "Date of Birth" khi đẩy lên Google Sheet — LUÔN mm/dd/yyyy (4
 * số năm), không theo GoogleSheetConfig.dateFormat chung (cột đó chỉ có 2 lựa chọn ISO/2-
 * số-năm, DOB cần đủ 4 số năm nên tách hàm riêng thay vì thêm biến thể thứ 3 vào DateFormat). */
export function formatDateOfBirth(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const [, year, month, day] = m;
  return `${month}/${day}/${year}`;
}

/** Ngày hiện tại (giờ server) dạng ISO "YYYY-MM-DD" — dùng làm giá trị gốc cho trường
 * "Ngày gửi" ảo (SEND_DATE_COLUMN_ID) trước khi format theo dateFormat đã chọn. */
export function todayIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
