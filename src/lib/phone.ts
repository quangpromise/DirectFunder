/** Chuẩn hoá số điện thoại US (lưu trong Case.phone/phone2 dạng 10 số thô, không dấu, xem
 * mock-data.ts) sang E.164 để gọi RingCentral API / khớp SmsMessage.counterpartNumber. Trả
 * về null nếu không đủ 10-11 số hợp lệ (tránh gọi API RingCentral với số rác). */
export function toE164US(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 7 && raw.trim().startsWith("+")) return `+${digits}`;
  return null;
}
