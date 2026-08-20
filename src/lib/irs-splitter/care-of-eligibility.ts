// File thuần logic, KHÔNG import pdfjs-dist/pdf-lib -- an toàn để dùng cả ở client component
// (notice-splitter-panel.tsx) lẫn server route/lib, không kéo theo dependency nặng nào.

/**
 * Danh sách MẶC ĐỊNH các loại thư được coi là "gửi qua văn phòng" (hasCareOf / hậu tố
 * " Not Update CRM" khi đặt tên file) -- dùng khi Admin chưa từng tự cấu hình qua UI (xem
 * AppConfig.careOfEligibleNoticeTypes, quản lý qua NoticeSplitterCareOfManager trong
 * notice-splitter-panel.tsx). Theo yêu cầu nghiệp vụ 2026-08-18: batch quét gồm nhiều loại
 * thư IRS khác nhau, nhưng chỉ nhóm cụ thể này thật sự cần theo dõi kiểu gửi (qua văn phòng
 * RA Solutions Corporation, 1650 Zanker Rd Ste 230, hay thẳng khách hàng) để cập nhật CRM.
 */
export const DEFAULT_CARE_OF_ELIGIBLE_NOTICE_TYPES: string[] = [
  "CP89",
  "CP289",
  "CP521",
  "CP523",
  "CP01E",
  "CP14",
  "CP14D",
  "2273C",
  "2840C",
  "4458C",
];

function normalizeNoticeTypeKey(noticeType: string): string {
  return noticeType.trim().toUpperCase().replace(/\s+/g, "").replace(/^LTR/, "");
}

/**
 * So khớp không phân biệt hoa/thường, khoảng trắng thừa, và tiền tố "LTR" (dòng thư dạng
 * "Letter ####C" có thể được `detectRecords()` chuẩn hoá thành "LTR####C") -- không phụ
 * thuộc đúng 1 định dạng đầu ra cụ thể của bước nhận diện tự động.
 *
 * `eligibleTypes` PHẢI truyền tường minh (không có default ngầm) -- danh sách này giờ cấu
 * hình được qua UI (AppConfig.careOfEligibleNoticeTypes), truyền ngầm 1 danh sách cứng ở đây
 * sẽ khiến 1 số lời gọi âm thầm dùng danh sách CŨ trong khi nơi khác đã theo danh sách Admin
 * vừa sửa -- xem detectRecords() (DetectOptions.careOfEligibleNoticeTypes) và
 * notice-splitter-panel.tsx cho nơi đọc danh sách hiện tại từ store.
 */
export function isCareOfEligibleNoticeType(noticeType: string | null | undefined, eligibleTypes: string[]): boolean {
  if (!noticeType) return false;
  const key = normalizeNoticeTypeKey(noticeType);
  return eligibleTypes.some((t) => normalizeNoticeTypeKey(t) === key);
}
