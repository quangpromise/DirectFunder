import { RefundYearStatus, SelectOption } from "./types";
import { REFUND_YEARS } from "./refund";

/** Năm có refund > 0 nhưng chưa từng chọn trạng thái -> mặc định "Pre-processing" (chưa
 * bắt đầu xử lý), khác "processing" (đang xử lý dở) — theo yêu cầu 2026-08-11. Id này phải
 * khớp 1 id trong AppConfig.refundYearStatusOptions (xem DEFAULT_REFUND_YEAR_STATUS_OPTIONS
 * trong rbac.ts) — nếu Quản lý lỡ xoá option "preProcessing", findRefundStatusOption bên
 * dưới vẫn tự dựng badge fallback thay vì crash. */
export const DEFAULT_REFUND_YEAR_STATUS: RefundYearStatus = "preProcessing";

/** Option xám trung tính dùng khi 1 status id không còn khớp option nào trong danh sách
 * hiện tại (Quản lý đã xoá/đổi id) — tránh crash thay vì throw hay ẩn badge. */
const FALLBACK_OPTION: SelectOption = {
  id: "__unknown",
  label: "—",
  bg: "rgba(148,163,184,0.15)",
  color: "#cbd5e1",
};

/** Tra SelectOption (label/màu) theo status id từ danh sách hiện tại (AppConfig.refundYearStatusOptions,
 * Quản lý cấu hình được qua CaseRefundStatusButton) — dùng chung cho badge tĩnh, dropdown,
 * và Edit History. */
export function findRefundStatusOption(options: SelectOption[], statusId: string): SelectOption {
  return options.find((o) => o.id === statusId) ?? { ...FALLBACK_OPTION, id: statusId, label: statusId };
}

export interface RefundYearRow {
  year: string;
  amount: number;
  status: RefundYearStatus;
}

/** Danh sách năm có refund > 0 kèm số tiền + trạng thái hiện tại (mặc định "preProcessing"
 * nếu chưa từng chọn), sắp theo thứ tự năm tăng dần — dùng cho popup nút mắt. */
export function refundYearRows(
  refunds: Record<string, number> | undefined,
  refundYearStatus: Record<string, RefundYearStatus> | undefined
): RefundYearRow[] {
  // `?? {}`/`?.` — case cache cũ (localStorage từ trước khi 2 field này tồn tại) hoặc dữ
  // liệu server chưa migrate xong có thể khiến 2 tham số này thực sự `undefined` dù type
  // khai báo không cho phép (type chỉ đúng lúc biên dịch, không đảm bảo đúng lúc chạy với dữ
  // liệu cũ) — đã từng gây crash "Cannot read properties of undefined (reading '2023')"
  // trên production, xem migration ladder version 27 trong app-store.ts.
  const safeRefunds = refunds ?? {};
  const safeStatus = refundYearStatus ?? {};
  return REFUND_YEARS.filter((year) => (safeRefunds[year] ?? 0) > 0).map((year) => ({
    year,
    amount: safeRefunds[year],
    status: safeStatus[year] ?? DEFAULT_REFUND_YEAR_STATUS,
  }));
}

/** true nếu có ít nhất 1 năm refund > 0 đang ở trạng thái "Pending" — nút mắt nhấp nháy
 * đỏ khi true, xanh lá đứng yên khi false (xem CaseRefundStatusButton). Id "pending" là id
 * đặc biệt cố định trong code (KHÔNG xoá được qua UI quản lý options), không phụ thuộc label
 * Quản lý đặt tên gì. */
export function hasPendingRefundYear(
  refunds: Record<string, number>,
  refundYearStatus: Record<string, RefundYearStatus>
): boolean {
  return refundYearRows(refunds, refundYearStatus).some((r) => r.status === "pending");
}
