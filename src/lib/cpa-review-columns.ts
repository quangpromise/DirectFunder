import { ColumnDef, SelectOption } from "./types";

/**
 * Cấu trúc cột CỐ ĐỊNH cho tab "CPA Review" (độc lập hoàn toàn với Case, xem
 * prisma schema `CpaReviewRecord` + deployment-database-sync.md mục 4.22) — khớp đúng cột
 * A-AH của Google Sheet thật đã khảo sát. KHÔNG cấu hình được qua UI (khác Collecting) vì
 * phải giữ nguyên đúng cấu trúc Sheet để đồng bộ 2 chiều hoạt động đúng.
 */
export const CPA_REVIEW_YEARS = ["2022", "2023", "2024", "2025"] as const;
export type CpaReviewYear = (typeof CPA_REVIEW_YEARS)[number];

/** Năm hiện trên UI bảng "CPA Review" — 2022 CỐ Ý bị ẩn khỏi bảng theo yêu cầu 2026-08-14
 * ("chỉ ẩn các cột 2022... còn 2023, 2024, 2025") nhưng vẫn còn trong CPA_REVIEW_YEARS nên
 * dữ liệu 2022 cũ (nếu có) vẫn đọc/ghi/đồng bộ Sheet bình thường, chỉ không render ra bảng. */
export const CPA_REVIEW_VISIBLE_YEARS = CPA_REVIEW_YEARS.filter((y) => y !== "2022");

export type CpaReviewColumnType = "text" | "phone" | "zipcode" | "date" | "currency" | "select";

export interface CpaReviewColumnDef {
  /** key trong CpaReviewRecord.custom. */
  key: string;
  label: string;
  type: CpaReviewColumnType;
  width: number;
  options?: SelectOption[];
}

// Khớp ĐÚNG danh sách dropdown (data validation ONE_OF_LIST) thật của cột Status mỗi khối
// năm trên Google Sheet — đã đọc trực tiếp qua Sheets API để xác nhận (2026-08-14), KHÔNG
// tự đặt 3 lựa chọn như bản đầu tiên (thiếu 12/15 giá trị thật khiến nhiều dòng import về
// hiện trống/không sửa được).
//
// Màu: đã kiểm tra kỹ trên Sheet thật (conditionalFormats + effectiveFormat.backgroundColor
// của các ô Status) — KHÔNG có conditional formatting nào và nền ô luôn trắng, nên màu chip
// nhiều màu người dùng thấy khi bấm mở dropdown là màu CHIP TỰ ĐỘNG do chính Google Sheets
// gán (tính năng dropdown dạng "chip"), loại màu này không có trong dữ liệu trả về qua API
// nên không đọc/copy chính xác được. Theo lựa chọn của user, dùng ĐÚNG vòng lặp 11 màu mặc
// định Google Sheets tự gán cho chip theo THỨ TỰ xuất hiện trong danh sách dropdown (không
// theo ý nghĩa ngữ cảnh — lặp lại từ đầu vòng khi hết 11 màu ở lựa chọn thứ 12 trở đi).
export const CPA_REVIEW_STATUS_OPTIONS: SelectOption[] = [
  { id: "accepted", label: "Accepted", bg: "rgba(239,68,68,0.15)", color: "#fca5a5" }, // đỏ
  { id: "rejected", label: "Rejected", bg: "rgba(249,115,22,0.15)", color: "#fdba74" }, // cam
  { id: "retry", label: "Retry", bg: "rgba(234,179,8,0.15)", color: "#fde047" }, // vàng
  { id: "pending", label: "Pending", bg: "rgba(34,197,94,0.15)", color: "#86efac" }, // xanh lá
  { id: "paper_filed", label: "Paper filed", bg: "rgba(20,184,166,0.15)", color: "#5eead4" }, // teal
  { id: "irs_recd", label: "IRS Rec'd", bg: "rgba(6,182,212,0.15)", color: "#67e8f9" }, // cyan
  { id: "irs_adjd", label: "IRS Adj'd", bg: "rgba(59,130,246,0.15)", color: "#93c5fd" }, // xanh dương
  { id: "approved", label: "Approved", bg: "rgba(99,102,241,0.15)", color: "#a5b4fc" }, // indigo
  { id: "irs_comp", label: "IRS Comp.", bg: "rgba(168,85,247,0.15)", color: "#d8b4fe" }, // tím
  { id: "tts_refund", label: "TTS Refund", bg: "rgba(236,72,153,0.15)", color: "#f9a8d4" }, // hồng
  { id: "done", label: "Done", bg: "rgba(107,114,128,0.15)", color: "#d1d5db" }, // xám
  // Lặp lại vòng màu từ đây (đã hết 11 màu mặc định)
  { id: "refund_freeze", label: "Refund Freeze", bg: "rgba(239,68,68,0.15)", color: "#fca5a5" }, // đỏ
  { id: "denied", label: "Denied", bg: "rgba(249,115,22,0.15)", color: "#fdba74" }, // cam
  { id: "resubmitted", label: "Resubmitted", bg: "rgba(234,179,8,0.15)", color: "#fde047" }, // vàng
  { id: "collection_fu", label: "Collection FU", bg: "rgba(34,197,94,0.15)", color: "#86efac" }, // xanh lá
];

function yearEfileDateKey(year: string): string {
  return `efileDate_${year}`;
}
function yearStatusKey(year: string): string {
  return `status_${year}`;
}
function yearAmountKey(year: string): string {
  return `amount_${year}`;
}
/** Cột P của mỗi khối năm trên Sheet thật (offset+3, header rỗng) — ô nhập tay thật (không
 * phải công thức, đã xác nhận qua khảo sát trực tiếp Sheet: giá trị userEnteredValue rỗng,
 * không có formulaValue), Sheet cộng cột này vào "Số tiền" (offset+2) ra tổng ở cột Q. */
function yearAdjustmentKey(year: string): string {
  return `adjustment_${year}`;
}
/** Ghi chú riêng gắn vào ô "Ngày" (efile date) mỗi năm — CHỈ tồn tại trong app, KHÔNG nằm
 * trong CPA_REVIEW_SHEET_COLUMN_MAP (Sheet thật không có chỗ cho ghi chú này), thêm
 * 2026-08-14 theo yêu cầu "cột ngày mỗi năm cho phép insert note và highlight". */
function yearNoteKey(year: string): string {
  return `dateNote_${year}`;
}
export { yearEfileDateKey, yearStatusKey, yearAmountKey, yearAdjustmentKey, yearNoteKey };

/** Danh sách đầy đủ cột theo ĐÚNG thứ tự cột A-AH của Sheet (dùng để render header + map
 * chỉ số cột Sheet, xem CPA_REVIEW_SHEET_COLUMN_MAP bên dưới). */
export const CPA_REVIEW_COLUMNS: CpaReviewColumnDef[] = [
  { key: "intakeDate", label: "Intake Date", type: "date", width: 110 },
  { key: "name", label: "Name", type: "text", width: 180 },
  { key: "phone", label: "Phone", type: "phone", width: 128 },
  { key: "ssn", label: "SSN", type: "text", width: 100 },
  // type "text" (không phải "date") — dữ liệu thật trên Sheet đôi khi có 2 ngày sinh cách
  // nhau bằng dấu cách trong CÙNG 1 ô (vd hồ sơ khai chung 2 người), input type=date của
  // trình duyệt không thể chứa giá trị dạng đó. Hiển thị vẫn định dạng MM/DD/YY qua prop
  // dateFormat của EditableCell (xem cpa-review/page.tsx), chỉ khác là lưu dạng text tự do
  // để không bị mất dữ liệu khi đồng bộ 2 chiều (thêm 2026-08-14).
  { key: "dob", label: "DOB", type: "text", width: 110 },
  { key: "zipcode", label: "Zip", type: "zipcode", width: 86 },
  ...CPA_REVIEW_YEARS.flatMap((year): CpaReviewColumnDef[] => [
    { key: yearEfileDateKey(year), label: `${year} Ngày`, type: "date", width: 110 },
    { key: yearStatusKey(year), label: `${year} Status`, type: "select", width: 110, options: CPA_REVIEW_STATUS_OPTIONS },
    { key: yearAmountKey(year), label: `${year} Số tiền`, type: "currency", width: 100 },
    // Cột P thật trên Sheet (offset+3) — xem yearAdjustmentKey ở trên. Cột Q (offset+4,
    // "Tổng") CỐ Ý không có mặt ở đây: đó là ô công thức `=O+P` trên Sheet thật, app tự
    // tính lại y hệt ở UI (page.tsx) thay vì lưu/đồng bộ, để không bao giờ ghi đè công thức.
    { key: yearAdjustmentKey(year), label: `${year} Other Refund`, type: "currency", width: 100 },
  ]),
  { key: "note", label: "Note", type: "text", width: 200 },
  // processor/agent xử lý riêng ở UI (AssignMenu, tham chiếu User.id) — không liệt kê ở
  // đây vì không dùng EditableCell chung như các cột khác.
  // KHÔNG có `options` cố định (khác các cột select khác) — theo yêu cầu 2026-08-14, danh
  // sách lựa chọn LUÔN lấy động theo đúng options hiện tại của cột "Status" trên bảng Hồ sơ
  // chính (Case), tự động có thêm/bớt/đổi tên khi Admin sửa cột Status đó, không lưu bản
  // sao riêng ở đây. Xem caseStatusOptionsForCrmSource() bên dưới + cpa-review/page.tsx.
  { key: "crmSource", label: "CRM Source", type: "select", width: 110 },
  { key: "fcDate", label: "FC Date", type: "date", width: 110 },
  { key: "processingDate", label: "Processing Date", type: "date", width: 130 },
  { key: "elDate", label: "EL Date", type: "date", width: 110 },
];

/** Map chỉ số cột Sheet (0-indexed, A=0..AH=33) -> key trong custom — dùng cho đồng bộ 2
 * chiều (App<->Sheet). Cột G (index 6, "Client Zipcode") và cột phụ tính SUM trong mỗi
 * khối năm (offset 3/4) CỐ Ý không có mặt ở đây — không đồng bộ (đã xác nhận với user). */
export const CPA_REVIEW_SHEET_COLUMN_MAP: Record<number, string> = {
  0: "intakeDate",
  1: "name",
  2: "phone",
  3: "ssn",
  4: "dob",
  5: "zipcode",
  27: "note",
  28: "processorUserId",
  29: "agentUserId",
  30: "crmSource",
  31: "fcDate",
  32: "processingDate",
  33: "elDate",
};
const YEAR_BLOCK_START = 7;
const YEAR_BLOCK_SIZE = 5;
CPA_REVIEW_YEARS.forEach((year, i) => {
  const base = YEAR_BLOCK_START + i * YEAR_BLOCK_SIZE;
  CPA_REVIEW_SHEET_COLUMN_MAP[base] = yearEfileDateKey(year);
  CPA_REVIEW_SHEET_COLUMN_MAP[base + 1] = yearStatusKey(year);
  CPA_REVIEW_SHEET_COLUMN_MAP[base + 2] = yearAmountKey(year);
  CPA_REVIEW_SHEET_COLUMN_MAP[base + 3] = yearAdjustmentKey(year);
  // base+4 (cột Q, "Tổng") CỐ Ý không map ở đây — công thức Sheet, không tham gia đọc/ghi 2
  // chiều qua CPA_REVIEW_SHEET_COLUMN_MAP như các cột khác. Vẫn cần biết CHỈ SỐ CỘT này riêng
  // (yearTotalColumnIndex bên dưới) cho 1 trường hợp hẹp: ghi trực tiếp giá trị Tổng vào ô
  // này khi thêm DÒNG MỚI (ô chắc chắn còn trống, chưa có công thức nào để ghi đè) — thêm
  // 2026-08-16, yêu cầu "ô tổng... nếu chưa set công thức thì sẽ lấy theo công thức tab CPA
  // Review... gắn trực tiếp số đang có ở tổng vào Google sheet".
});

/** Chỉ số cột 0-based (A=0) của ô "Tổng" (công thức `=Số tiền+Other Refund` trên Sheet thật)
 * mỗi năm — xem giải thích ở trên. */
export function yearTotalColumnIndex(year: string): number {
  const i = CPA_REVIEW_YEARS.indexOf(year as CpaReviewYear);
  return YEAR_BLOCK_START + i * YEAR_BLOCK_SIZE + 4;
}

/** Chiều ngược lại (key -> chỉ số cột Sheet) — dùng khi đẩy App->Sheet. */
export const CPA_REVIEW_KEY_TO_SHEET_COLUMN: Record<string, number> = Object.fromEntries(
  Object.entries(CPA_REVIEW_SHEET_COLUMN_MAP).map(([idx, key]) => [key, Number(idx)])
);

/** Options cho dropdown cột "CRM Source" — LUÔN lấy động từ chính danh sách options hiện
 * tại của cột "Status" trên bảng Hồ sơ chính (Case), thay vì 1 danh sách riêng cố định
 * (thêm 2026-08-14, yêu cầu "lấy theo dropbox của Status ngoài màn hình hồ sơ, khi nào màn
 * hình hồ sơ có thêm trường gì thì CRM đều có thêm trường đó"). Không có `columns`/không
 * tìm thấy cột "status" -> trả mảng rỗng (dropdown hiện trống, không lỗi). Dùng chung cho
 * cả UI (cpa-review/page.tsx) lẫn đồng bộ 2 chiều (cpa-review-sheet-sync.ts/webhook route). */
export function caseStatusOptionsForCrmSource(columns: ColumnDef[]): SelectOption[] {
  return columns.find((c) => c.id === "status")?.options ?? [];
}
