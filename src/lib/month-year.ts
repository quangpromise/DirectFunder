/** 3 chữ đầu tên tháng hiện tại (tiếng Anh) + 2 số cuối năm hiện tại, vd "Aug26" — dùng
 * làm tên tab tháng trên Google Sheet "2026 RA-EC Client list" (mail CPA lẫn nút "Send"
 * ở cột Status đều phải trỏ đúng cùng 1 tab, nên dùng chung 1 hàm duy nhất). */
export function buildMonthYear(now: Date): string {
  const month = now.toLocaleString("en-US", { month: "short" });
  const year = String(now.getFullYear()).slice(-2);
  return `${month}${year}`;
}
