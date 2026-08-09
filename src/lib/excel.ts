import * as XLSX from "xlsx";

/** Thứ tự cột cố định cho cả file mẫu tải xuống lẫn file Excel người dùng tải lên —
 * đổi thứ tự/tên ở đây thì cả 2 chiều (export/import) tự khớp theo nhau. */
export const CASE_TEMPLATE_HEADERS = [
  "Client Name",
  "SSN",
  "Phone",
  "ZIP",
  "Address",
  "Case",
  "Money",
  "Agent",
  "Processor",
] as const;

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
}

function cellText(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return v === undefined || v === null ? "" : String(v).trim();
}

/** Đọc file Excel người dùng tải lên, bỏ qua dòng trống hoàn toàn (không có tên/phone/
 * địa chỉ) — không validate nghiêm ngặt ở đây, dữ liệu thiếu trường nào thì hồ sơ tạo ra
 * chỉ để trống trường đó, người dùng sửa tay lại sau trong bảng như hồ sơ thường. */
export async function parseCaseExcelFile(file: File): Promise<ParsedCaseRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows
    .map((r) => ({
      clientName: cellText(r, "Client Name"),
      ssn: cellText(r, "SSN"),
      phone: cellText(r, "Phone"),
      zip: cellText(r, "ZIP"),
      address: cellText(r, "Address"),
      caseLabel: cellText(r, "Case"),
      money: Number(cellText(r, "Money").replace(/[^0-9.-]/g, "")) || 0,
      agentName: cellText(r, "Agent"),
      processorName: cellText(r, "Processor"),
    }))
    .filter((r) => r.clientName || r.phone || r.address || r.ssn);
}
