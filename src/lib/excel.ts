/** `xlsx` (SheetJS) nặng (~1MB chưa nén) nhưng chỉ dùng cho vài hành động bấm thỉnh thoảng
 * (tải mẫu/nhập Excel) — lazy-import thay vì `import * as XLSX from "xlsx"` ở top-level để
 * KHÔNG cộng dồn vào bundle ban đầu của trang Hồ sơ/Order (đã xác nhận qua `next build` thật:
 * trước khi sửa, chunk chứa `xlsx` bị 2 trang này tải ngay cả khi không ai bấm Excel). Cache
 * lại module đã tải (giống pattern `extract-text-browser.ts`) để các lần gọi sau trong cùng
 * phiên không tải lại. */
let xlsxPromise: Promise<typeof import("xlsx")> | null = null;
function loadXlsx(): Promise<typeof import("xlsx")> {
  if (!xlsxPromise) xlsxPromise = import("xlsx");
  return xlsxPromise;
}

/** Thứ tự cột cố định cho cả file mẫu tải xuống lẫn file Excel người dùng tải lên —
 * đổi thứ tự/tên ở đây thì cả 2 chiều (export/import) tự khớp theo nhau. */
export const CASE_TEMPLATE_HEADERS = ["Client Name", "SSN", "Phone", "ZIP"] as const;

export async function downloadCaseTemplate(): Promise<void> {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([[...CASE_TEMPLATE_HEADERS]]);
  ws["!cols"] = CASE_TEMPLATE_HEADERS.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cases");
  XLSX.writeFile(wb, "direct-funder-case-template.xlsx");
}

/** Bản mẫu rút gọn cho tab Order (chỉ nhóm Support thấy) — 5 cột đúng với những gì
 * Support quản lý trên bảng Order, không có Case/Money/Agent/Processor vì Support không
 * phụ trách phân công/tiền. "Format Name" chỉ để tham khảo (tự tính từ Client Name khi
 * hiển thị) — bị bỏ qua khi import, không cần điền. */
export const ORDER_TEMPLATE_HEADERS = ["Client Name", "Phone", "SSN", "Format Name", "Address"] as const;

export async function downloadOrderCaseTemplate(): Promise<void> {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([[...ORDER_TEMPLATE_HEADERS]]);
  ws["!cols"] = ORDER_TEMPLATE_HEADERS.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cases");
  XLSX.writeFile(wb, "direct-funder-order-case-template.xlsx");
}

export interface ParsedCaseRow {
  clientName: string;
  ssn: string;
  phone: string;
  zip: string;
  address: string;
  caseLabel: string;
  money: number;
  agentName: string;
  processorName: string;
  /** Hyperlink gắn trên ô "Client Name" (nếu người dùng chèn link liên kết trong Excel,
   * vd. link Google Drive hồ sơ khách) — null nếu ô không có link. */
  clientLink: string | null;
}

/** Chi tiết 1 dòng bị bỏ qua khi nhập Excel do trùng SSN — dùng để hiển thị rõ trùng với
 * hồ sơ của ai thay vì chỉ báo mỗi số lượng chung chung. `owner` tách 3 trường hợp: đã có
 * người phụ trách (Agent/Processor/người tạo) trên hồ sơ cũ, hồ sơ cũ chưa gán ai, hoặc
 * trùng với 1 dòng KHÁC ngay trong cùng file Excel vừa tải lên (chưa kịp tạo hồ sơ nào nên
 * không có "chủ" để báo). */
export interface DuplicateSsnInfo {
  ssn: string;
  clientName: string;
  owner: { type: "user"; name: string } | { type: "unassigned" } | { type: "sameFile"; rowNumber: number };
}

const MAX_DUPLICATE_SSN_LINES = 10;

/** Ghép danh sách hồ sơ bị bỏ qua do trùng SSN thành các dòng text hiển thị trong popup
 * cảnh báo sau khi nhập Excel (nối vào sau dòng tóm tắt số lượng) — giới hạn số dòng hiện ra
 * để tránh popup quá dài khi file có rất nhiều SSN trùng. */
export function formatDuplicateSsnLines(
  duplicates: DuplicateSsnInfo[],
  t: (key: string, vars?: Record<string, string | number>) => string
): string[] {
  const lines = duplicates.slice(0, MAX_DUPLICATE_SSN_LINES).map((d) => {
    const owner =
      d.owner.type === "user"
        ? d.owner.name
        : d.owner.type === "sameFile"
          ? t("cases.import.duplicateSameFile", { row: d.owner.rowNumber })
          : t("cases.import.duplicateUnassigned");
    return t("cases.import.duplicateLine", { ssn: d.ssn, client: d.clientName, owner });
  });
  const rest = duplicates.length - lines.length;
  if (rest > 0) lines.push(t("cases.import.duplicateMore", { count: rest }));
  return lines;
}

/** Đọc file Excel người dùng tải lên, bỏ qua dòng trống hoàn toàn (không có tên/phone/
 * địa chỉ) — không validate nghiêm ngặt ở đây, dữ liệu thiếu trường nào thì hồ sơ tạo ra
 * chỉ để trống trường đó, người dùng sửa tay lại sau trong bảng như hồ sơ thường.
 *
 * Đọc trực tiếp qua range/địa chỉ ô (thay vì XLSX.utils.sheet_to_json) để vừa lấy được giá
 * trị hiển thị vừa lấy được hyperlink gắn trên ô "Client Name" (cell.l.Target) — sheet_to_json
 * chỉ trả về giá trị text, không giữ lại hyperlink. */
export async function parseCaseExcelFile(file: File): Promise<ParsedCaseRow[]> {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet || !sheet["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);

  const colByHeader: Record<string, number> = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const label = String(sheet[XLSX.utils.encode_cell({ r: range.s.r, c })]?.v ?? "").trim();
    if (label) colByHeader[label] = c;
  }
  const cellAt = (r: number, header: string) => {
    const c = colByHeader[header];
    return c === undefined ? undefined : sheet[XLSX.utils.encode_cell({ r, c })];
  };
  const textAt = (r: number, header: string): string => {
    const v = cellAt(r, header)?.v;
    return v === undefined || v === null ? "" : String(v).trim();
  };

  const result: ParsedCaseRow[] = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const clientName = textAt(r, "Client Name");
    const phone = textAt(r, "Phone");
    const address = textAt(r, "Address");
    const ssn = textAt(r, "SSN");
    if (!clientName && !phone && !address && !ssn) continue;
    result.push({
      clientName,
      ssn,
      phone,
      zip: textAt(r, "ZIP"),
      address,
      caseLabel: textAt(r, "Case"),
      money: Number(textAt(r, "Money").replace(/[^0-9.-]/g, "")) || 0,
      agentName: textAt(r, "Agent"),
      processorName: textAt(r, "Processor"),
      clientLink: cellAt(r, "Client Name")?.l?.Target ?? null,
    });
  }
  return result;
}
