import { CaseRecord, CollectingReportManualFields } from "./types";
import { getAllClientNames } from "./client-name";
import { todayIsoDate } from "./date-format";

function joinPair(a: string | null | undefined, b: string | null | undefined): string {
  return [a, b].filter((v): v is string => Boolean(v && v.trim())).join(" ");
}

/**
 * Dựng `CollectingRecord.custom` từ 1 hồ sơ (Case) + 1 năm refund cụ thể + các trường nhập
 * tay ở popup "Send Collecting Report" (thêm 2026-08-16, đặt trước mỗi năm trong popup
 * "Refund by years" — nút mắt cạnh cột Case, `CaseRefundStatusButton`). Trường suy ra được
 * trực tiếp từ Case: Agent 1/Agent 2 nhận tên hiển thị (đã resolve từ userId ở route gọi
 * hàm này, vì cột Collecting kiểu text tự do, không tham chiếu userId như CPA Review), ACCT
 * lấy từ `Case.accountantSupport` (popup "Edit Hồ sơ"), "Qual. Amount" lấy đúng số refund
 * của NĂM được gửi (không phải tổng mọi năm). Các trường còn lại (Program, Tax Offset,
 * Approved amt, Upfront fee, Total Collected, Pmt method, Note, Tip, Receipt/Check #,
 * Receipt/Check Amt.) do người dùng tự nhập ở popup, KHÔNG suy ra được từ Case — thuộc quy
 * trình riêng của team Collecting.
 */
export function buildCollectingCustomFromCase(
  c: CaseRecord,
  year: string,
  agentName: string,
  agentName2: string,
  manual: CollectingReportManualFields
): Record<string, string | number | boolean | null> {
  const custom: Record<string, string | number | boolean | null> = {
    date1: todayIsoDate(),
    name: getAllClientNames(c),
    phone: joinPair(c.phone, c.phone2),
    year1: year,
    qualAmount: c.refunds?.[year] ?? 0,
    // Cột "taxOffset" kiểu text tự do — lưu thẳng "X" khi Yes, để bảng Collecting hiển thị
    // đúng dấu X mà không cần đổi type cột hay logic render riêng.
    taxOffset: manual.taxOffset ? "X" : "",
  };
  if (agentName) custom.agent1 = agentName;
  if (agentName2) custom.agent2 = agentName2;
  if (c.accountantSupport && c.accountantSupport.trim()) custom.acct = c.accountantSupport.trim();
  if (manual.program) custom.program = manual.program;
  if (manual.approvedAmt !== null) custom.approvedAmt = manual.approvedAmt;
  if (manual.upfrontFees !== null) custom.upfrontFees = manual.upfrontFees;
  if (manual.totalCollected !== null) custom.totalCollected = manual.totalCollected;
  if (manual.pmtMethod) custom.pmtMethod = manual.pmtMethod;
  if (manual.note.trim()) custom.note = manual.note.trim();
  if (manual.tips !== null) custom.tips = manual.tips;
  if (manual.receiptCheckNo.trim()) custom.receiptCheckNo = manual.receiptCheckNo.trim();
  if (manual.receiptCheckAmt !== null) custom.receiptCheckAmt = manual.receiptCheckAmt;
  return custom;
}
