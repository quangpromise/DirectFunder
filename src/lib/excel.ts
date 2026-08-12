import * as XLSX from "xlsx";

/** Thứ tự cột cố định cho cả file mẫu tải xuống lẫn file Excel người dùng tải lên —
 * đổi thứ tự/tên ở đây thì cả 2 chiều (export/import) tự khớp theo nhau. */
export const CASE_TEMPLATE_HEADERS = ["Client Name", "SSN", "Phone", "ZIP"] as const;

export function downloadCaseTemplate(): void {
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

export function downloadOrderCaseTemplate(): void {
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

/** Đọc file Excel người dùng tải lên, bỏ qua dòng trống hoàn toàn (không có tên/phone/
 * địa chỉ) — không validate nghiêm ngặt ở đây, dữ liệu thiếu trường nào thì hồ sơ tạo ra
 * chỉ để trống trường đó, người dùng sửa tay lại sau trong bảng như hồ sơ thường.
 *
 * Đọc trực tiếp qua range/địa chỉ ô (thay vì XLSX.utils.sheet_to_json) để vừa lấy được giá
 * trị hiển thị vừa lấy được hyperlink gắn trên ô "Client Name" (cell.l.Target) — sheet_to_json
 * chỉ trả về giá trị text, không giữ lại hyperlink. */
export async function parseCaseExcelFile(file: File): Promise<ParsedCaseRow[]> {
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
