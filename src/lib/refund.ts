/** 4 năm cố định hiện có ô nhập Refund trong popup "Edit Hồ sơ" (ClientProfileDialog). */
export const REFUND_YEARS = ["2022", "2023", "2024", "2025"] as const;
export type RefundYear = (typeof REFUND_YEARS)[number];

/** money = tổng mọi giá trị trong refunds; caseCount = số năm có giá trị > 0 (hiển thị ở
 * cột "Case", thay cho mã hồ sơ nhập tay trước đây — xem rbac.ts). Dùng chung cả ở
 * client (xem trước trong dialog) lẫn server (route client-profile tự tính, không tin
 * giá trị money/caseLabel client gửi lên). */
export function computeRefundSummary(refunds: Record<string, number>): { money: number; caseCount: number } {
  let money = 0;
  let caseCount = 0;
  for (const year of REFUND_YEARS) {
    const value = refunds[year];
    if (typeof value === "number" && value > 0) {
      money += value;
      caseCount += 1;
    }
  }
  return { money, caseCount };
}
