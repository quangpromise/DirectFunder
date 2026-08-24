import { CaseRecord } from "./types";
import { yearAmountKey } from "./cpa-review-columns";
import { getAllClientNames } from "./client-name";
import { todayIsoDate } from "./date-format";

/** Nối 2 giá trị (Phone/SSN/DOB — mỗi hồ sơ có tối đa 2 dòng Taxpayer/Spouse) bằng 1
 * khoảng trắng, bỏ qua giá trị rỗng — khớp đúng quy ước lưu trữ đã dùng cho dữ liệu nhập
 * từ Google Sheet (tab "CPA Review" tách hiển thị thành nhiều dòng bằng `breakOnSpace`,
 * xem cpa-review/page.tsx), KHÔNG dùng "\n" trực tiếp. */
function joinPair(a: string | null | undefined, b: string | null | undefined): string {
  return [a, b].filter((v): v is string => Boolean(v && v.trim())).join(" ");
}

/**
 * Dựng `CpaReviewRecord.custom` từ 1 hồ sơ (Case) đang có trên bảng Hồ sơ — dùng cho nút
 * "Test Sheet" cạnh Status (thêm 2026-08-14), hoạt động tương tự nút "Send row to Google
 * Sheet" cũ (kể cả popup chọn năm) nhưng gửi sang tab "CPA Review" độc lập thay vì Sheet cá
 * nhân. Chỉ điền đúng các trường đã xác nhận với user — Status/Ngày E-file mỗi năm CỐ Ý bỏ
 * trống (không nằm trong yêu cầu). `reviewYears` = danh sách năm đã chọn ở popup — CHỈ những
 * năm này mới có số tiền, năm không chọn bỏ trống (không phải 0) để phân biệt "chưa xét năm
 * đó" với "refund năm đó = 0". `note` (thêm 2026-08-15) — ô nhập tay tự do ở popup chọn năm,
 * đổ thẳng vào cột "Note" của dòng CPA Review vừa tạo — bỏ trống nếu không gõ gì. `crmSource`
 * (thêm 2026-08-16) — dropdown chọn 1 option của cột Status (cùng nguồn dữ liệu với dropdown
 * CRM Source sẵn có trong tab CPA Review), trước đó luôn để trống. `fcDate`/`processingDate`/
 * `elDate` (thêm 2026-08-24) — 3 ô ngày ở popup "Test Sheet", MẶC ĐỊNH lấy từ đúng field cùng
 * tên đã lưu trên Case (điền qua popup "Edit Hồ sơ") nếu có, nhưng người dùng sửa được ngay
 * trong popup trước khi gửi — giá trị người dùng gõ (nếu có) LUÔN ưu tiên hơn giá trị đã lưu
 * trên Case.
 */
export function buildCpaReviewCustomFromCase(
  c: CaseRecord,
  reviewYears: string[],
  note?: string,
  crmSource?: string,
  fcDate?: string,
  processingDate?: string,
  elDate?: string
): Record<string, string | number | boolean | null> {
  const custom: Record<string, string | number | boolean | null> = {
    intakeDate: todayIsoDate(),
    name: getAllClientNames(c),
    phone: joinPair(c.phone, c.phone2),
    ssn: joinPair(c.ssn[0], c.ssn[1]),
    dob: joinPair(c.dateOfBirth[0], c.dateOfBirth[1]),
    zipcode: c.zipcode,
    // Agent chỉ lấy slot 1 (assignedTo) — KHÔNG kèm assignedTo2, theo đúng yêu cầu.
    processorUserId: c.assignedProcessor,
    agentUserId: c.assignedTo,
    fcDate: fcDate?.trim() || c.fcDate || "NA",
    processingDate: processingDate?.trim() || c.processingDate || "NA",
    elDate: elDate?.trim() || c.elDate || "NA",
  };
  if (c.clientLink) custom.nameLink = c.clientLink;
  if (note && note.trim()) custom.note = note.trim();
  // id của SelectOption trong cột Status — chọn ở popup "Test Sheet" (thêm 2026-08-16),
  // trước đó luôn để trống (xem lịch sử ở đầu file).
  if (crmSource && crmSource.trim()) custom.crmSource = crmSource.trim();
  for (const year of reviewYears) {
    custom[yearAmountKey(year)] = c.refunds?.[year] ?? 0;
  }
  return custom;
}
