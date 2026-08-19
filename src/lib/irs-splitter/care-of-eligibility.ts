// File thuần logic, KHÔNG import pdfjs-dist/pdf-lib -- an toàn để dùng cả ở client component
// (notice-splitter-panel.tsx) lẫn server route/lib, không kéo theo dependency nặng nào.

/**
 * Chỉ các loại thư này mới được coi là "gửi qua văn phòng" (hasCareOf / hậu tố " Not Update
 * CRM" khi đặt tên file) -- theo yêu cầu nghiệp vụ 2026-08-18: batch quét gồm nhiều loại thư
 * IRS khác nhau, nhưng chỉ nhóm cụ thể này thật sự cần theo dõi kiểu gửi (qua văn phòng RA
 * Solutions Corporation, 1650 Zanker Rd Ste 230, hay thẳng khách hàng) để cập nhật CRM.
 * Các loại thư khác dù có tín hiệu "%"/"C/O" trước địa chỉ văn phòng vẫn KHÔNG được tính là
 * care-of -- xem `detectRecords()` (áp dụng lúc quét tự động) và `notice-splitter-panel.tsx`
 * (khoá checkbox trong bảng soát/sửa nếu người dùng gõ tay 1 loại thư ngoài danh sách này).
 */
const CARE_OF_ELIGIBLE_NOTICE_TYPES = new Set(["CP89", "CP289", "CP521", "CP523", "CP01E", "CP14", "CP14D", "2273C", "2840C", "4458C"]);

/** So khớp không phân biệt hoa/thường, khoảng trắng thừa, và tiền tố "LTR" (dòng thư dạng
 * "Letter ####C" có thể được `detectRecords()` chuẩn hoá thành "LTR####C") -- không phụ
 * thuộc đúng 1 định dạng đầu ra cụ thể của bước nhận diện tự động. */
export function isCareOfEligibleNoticeType(noticeType: string | null | undefined): boolean {
  if (!noticeType) return false;
  const key = noticeType.trim().toUpperCase().replace(/\s+/g, "").replace(/^LTR/, "");
  return CARE_OF_ELIGIBLE_NOTICE_TYPES.has(key);
}
