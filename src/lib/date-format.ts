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

function isoIfValidDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Dùng UTC + so lại từng phần để loại ngày không tồn tại (vd 02/30) — Date tự "tràn"
  // sang tháng sau thay vì báo lỗi, so sánh ngược lại phát hiện được trường hợp này.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Diễn giải text dán (paste) vào ô Date of Birth thành ISO "YYYY-MM-DD" để gán cho input
 * type="date" — input gốc CHỈ chấp nhận paste đúng định dạng ISO theo từng segment (rất dễ
 * gõ/dán sai từ Excel/nguồn khác dùng mm/dd/yyyy), nên cần tự parse thêm các định dạng phổ
 * biến: "mm/dd/yyyy", "mm-dd-yyyy" (Mỹ, ngày trước/tháng sau theo đúng cách hệ thống này
 * hiển thị DOB ở nơi khác — xem formatDateOfBirth) và "yyyy-mm-dd" (ISO, giữ nguyên nếu đã
 * đúng). Trả về null nếu không nhận diện được/ngày không hợp lệ — chỗ gọi tự bỏ qua, giữ
 * nguyên hành vi paste mặc định của trình duyệt. */
export function parseDobPaste(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (m) return isoIfValidDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (m) return isoIfValidDate(Number(m[3]), Number(m[1]), Number(m[2]));

  return null;
}

/** Ngày hiện tại (giờ server) dạng ISO "YYYY-MM-DD" — dùng làm giá trị gốc cho trường
 * "Ngày gửi" ảo (SEND_DATE_COLUMN_ID) trước khi format theo dateFormat đã chọn. */
export function todayIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
