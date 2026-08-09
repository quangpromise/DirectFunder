import { CaseRecord } from "./types";

/** Giữ lại tối đa 9 chữ số từ chuỗi nhập vào. */
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, "").slice(0, 9);
}

/** Format 9 chữ số thành xxx-xx-xxxx; trả về chuỗi rút gọn nếu chưa đủ số. */
export function formatSsn(digits: string): string {
  const d = digitsOnly(digits);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

export const SSN_PATTERN = /^\d{3}-\d{2}-\d{4}$/;

export function isValidSsn(value: string): boolean {
  return SSN_PATTERN.test(value);
}

/**
 * Kiểm tra một số SSN đã tồn tại ở bất kỳ hồ sơ/ô nào khác trong hệ thống chưa
 * (bao gồm cả ô còn lại trong cùng hồ sơ). excludeCaseId + excludeSlot dùng để
 * loại trừ chính ô đang chỉnh sửa khỏi việc so khớp.
 */
export function isDuplicateSsn(
  cases: CaseRecord[],
  value: string,
  excludeCaseId: string,
  excludeSlot: 0 | 1
): boolean {
  return cases.some((c) =>
    c.ssn.some((s, idx) => {
      if (c.id === excludeCaseId && idx === excludeSlot) return false;
      return s === value;
    })
  );
}
