import { RefundYearStatus } from "./types";
import { REFUND_YEARS } from "./refund";

/** Năm có refund > 0 nhưng chưa từng chọn trạng thái -> mặc định "Pre-processing" (chưa
 * bắt đầu xử lý), khác "processing" (đang xử lý dở) — theo yêu cầu 2026-08-11. */
export const DEFAULT_REFUND_YEAR_STATUS: RefundYearStatus = "preProcessing";

/** Nhãn tiếng Anh cố định (giống quy ước CHECK_INITIAL_ITEMS) — dùng cho Edit History,
 * KHÔNG dùng cho UI hiển thị (UI dùng key i18n status.pre_processing/processing/pending/
 * cpa_review đã có sẵn cho cột Status chính, để đồng bộ chữ Việt/Anh, xem
 * CaseRefundStatusButton). */
export const REFUND_STATUS_LABEL: Record<RefundYearStatus, string> = {
  preProcessing: "Pre-processing",
  processing: "Processing",
  pending: "Pending",
  cpaReview: "CPA Review",
};

/** Màu badge riêng cho tri-state này (không dùng chung màu Order Status) — Pre-processing
 * dùng xanh dương giống option "pre_processing" ở cột Status chính (đồng bộ ý nghĩa);
 * Pending cố ý chọn đỏ để khớp ý nghĩa với hiệu ứng nhấp nháy đỏ của nút mắt khi có năm
 * Pending. */
export const REFUND_STATUS_COLOR: Record<RefundYearStatus, { bg: string; color: string }> = {
  preProcessing: { bg: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  processing: { bg: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  pending: { bg: "rgba(239,68,68,0.15)", color: "#fca5a5" },
  cpaReview: { bg: "rgba(168,85,247,0.15)", color: "#d8b4fe" },
};

export const REFUND_STATUS_OPTIONS: RefundYearStatus[] = ["preProcessing", "processing", "pending", "cpaReview"];

export interface RefundYearRow {
  year: string;
  amount: number;
  status: RefundYearStatus;
}

/** Danh sách năm có refund > 0 kèm số tiền + trạng thái hiện tại (mặc định "preProcessing"
 * nếu chưa từng chọn), sắp theo thứ tự năm tăng dần — dùng cho popup nút mắt. */
export function refundYearRows(
  refunds: Record<string, number>,
  refundYearStatus: Record<string, RefundYearStatus>
): RefundYearRow[] {
  return REFUND_YEARS.filter((year) => (refunds[year] ?? 0) > 0).map((year) => ({
    year,
    amount: refunds[year],
    status: refundYearStatus[year] ?? DEFAULT_REFUND_YEAR_STATUS,
  }));
}

/** true nếu có ít nhất 1 năm refund > 0 đang ở trạng thái "Pending" — nút mắt nhấp nháy
 * đỏ khi true, xanh lá đứng yên khi false (xem CaseRefundStatusButton). */
export function hasPendingRefundYear(
  refunds: Record<string, number>,
  refundYearStatus: Record<string, RefundYearStatus>
): boolean {
  return refundYearRows(refunds, refundYearStatus).some((r) => r.status === "pending");
}
