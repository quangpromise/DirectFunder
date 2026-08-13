import { CheckInitialValue } from "./types";

/** id cột cố định cho "Check Initial" trong DEFAULT_COLUMNS (rbac.ts) — không phải cột
 * tuỳ chỉnh Admin tự thêm được (type "checklist" không nằm trong TYPE_OPTIONS của
 * AddColumnDialog), giống cách "order" là 1 cột hệ thống cố định. */
export const CHECK_INITIAL_COLUMN_ID = "checkInitial";

/** 5 mục checkbox cố định của "Check Initial" — nhãn để nguyên tiếng Anh, giống quy ước
 * label cột mặc định khác trong DEFAULT_COLUMNS (Status/Client Name/SSN...). Dùng chung
 * cho cả ô nhập (CheckInitialCell) lẫn lúc tóm tắt giá trị (Edit History, Google Sheet).
 * Thứ tự trong mảng = thứ tự hiển thị từ trên xuống khi tất cả đều hiện (xem quy tắc ẩn/
 * hiện theo elBefore0716/elAfter0716 trong CheckInitialCell). */
export const CHECK_INITIAL_ITEMS: { key: keyof CheckInitialValue; label: string }[] = [
  { key: "elBefore0716", label: "EL before 07/16" },
  { key: "elAfter0716", label: "EL after 07/16" },
  { key: "securityCheck", label: "Security Check" },
  { key: "agentGuaranteesSc", label: "Agent guarantees SC" },
  { key: "bankInfo", label: "Bank Information" },
];

export const EMPTY_CHECK_INITIAL: CheckInitialValue = {
  elBefore0716: false,
  elAfter0716: false,
  securityCheck: false,
  agentGuaranteesSc: false,
  bankInfo: false,
  backTaxOwed: null,
};

/** Tóm tắt giá trị thành chuỗi "EL, Bank Information" (chỉ liệt kê mục đã tick) — dùng cho
 * Edit History và khi Admin lỡ chọn cột này để đẩy lên Google Sheet (giá trị gốc là object,
 * không hiển thị được trực tiếp). Rỗng nếu chưa tick mục nào/chưa có giá trị. "Back Tax
 * Owed" (thêm 2026-08-13) không nằm trong CHECK_INITIAL_ITEMS (không phải boolean đơn
 * giản) nên tóm tắt riêng, nối thêm vào cuối. */
export function summarizeCheckInitial(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const v = value as Partial<CheckInitialValue>;
  const parts = CHECK_INITIAL_ITEMS.filter((item) => v[item.key]).map((item) => item.label);
  if (v.backTaxOwed === "yes") parts.push("Back Tax Owed (Yes)");
  else if (v.backTaxOwed === "no") parts.push("Back Tax Owed (No)");
  else if (v.backTaxOwed === "collected") parts.push("Back Tax Owed (Collected)");
  return parts.join(", ");
}
