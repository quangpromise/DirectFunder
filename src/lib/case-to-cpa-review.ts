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
 * nhân. Chỉ điền đúng các trường đã xác nhận với user — Note/Status/Ngày E-file mỗi năm CỐ
 * Ý bỏ trống (không nằm trong yêu cầu), CRM Source luôn để trống. `reviewYears` = danh sách
 * năm đã chọn ở popup — CHỈ những năm này mới có số tiền, năm không chọn bỏ trống (không
 * phải 0) để phân biệt "chưa xét năm đó" với "refund năm đó = 0". `note` (thêm 2026-08-15) —
 * ô nhập tay tự do ở popup chọn năm, đổ thẳng vào cột "Note" của dòng CPA Review vừa tạo —
 * bỏ trống nếu không gõ gì.
 */
export function buildCpaReviewCustomFromCase(
  c: CaseRecord,
  reviewYears: string[],
  note?: string
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
    fcDate: c.fcDate ?? "NA",
    processingDate: c.processingDate ?? "NA",
    elDate: c.elDate ?? "NA",
  };
  if (c.clientLink) custom.nameLink = c.clientLink;
  if (note && note.trim()) custom.note = note.trim();
  for (const year of reviewYears) {
    custom[yearAmountKey(year)] = c.refunds?.[year] ?? 0;
  }
  return custom;
}
