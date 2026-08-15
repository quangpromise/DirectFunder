import {
  CPA_REVIEW_COLUMNS,
  CPA_REVIEW_SHEET_COLUMN_MAP,
  CPA_REVIEW_STATUS_OPTIONS,
  CPA_REVIEW_YEARS,
  CPA_REVIEW_KEY_TO_SHEET_COLUMN,
  yearEfileDateKey,
  yearNoteKey,
} from "./cpa-review-columns";
import { CellWrite, NoteWrite } from "./google-sheets";
import { columnIndexToLetter } from "./spreadsheet-letters";
import { formatDateValue } from "./date-format";
import type { CpaReviewRecord, SelectOption } from "./types";

export function letterFor(index: number): string {
  return columnIndexToLetter(index);
}

/** Toàn bộ chỉ số cột (0-33, A-AH) app có ghi/đọc — dùng để xoá sạch 1 dòng khi record bị
 * xoá (giới hạn phạm vi, không đụng cột nào ngoài danh sách này). */
export const CPA_REVIEW_MANAGED_COLUMN_INDEXES: number[] = Object.keys(CPA_REVIEW_SHEET_COLUMN_MAP).map(Number);

const COLUMN_BY_KEY = new Map(CPA_REVIEW_COLUMNS.map((c) => [c.key, c]));

/** Xây danh sách cell cần ghi cho 1 dòng — ghi TOÀN BỘ A-AH mỗi lần (đơn giản/chắc chắn
 * đúng, đánh đổi hiệu năng nhỏ chấp nhận được, cùng lựa chọn với thiết kế trước). Tên
 * Processor/Agent lấy qua `resolveUserName` (tra theo `custom.processorUserId`/
 * `custom.agentUserId`, ưu tiên tên đã ánh xạ ngược trong Sheet nếu có). */
export function buildCpaReviewSheetCells(
  record: CpaReviewRecord,
  resolveUserName: (userId: string | null) => string,
  /** Options hiện tại của cột "CRM Source" (lấy động từ cột Status của Case, xem
   * caseStatusOptionsForCrmSource trong cpa-review-columns.ts) — cần truyền vào vì đây là
   * MODULE THUẦN không tự fetch DB, nơi gọi (cpa-review-sheet-sync.ts) chịu trách nhiệm đọc
   * AppConfig.columns rồi truyền xuống. */
  crmSourceOptions: SelectOption[]
): CellWrite[] {
  const cells: CellWrite[] = [];
  const custom = record.custom;

  for (const [indexStr, key] of Object.entries(CPA_REVIEW_SHEET_COLUMN_MAP)) {
    const index = Number(indexStr);
    if (key === "processorUserId") {
      cells.push({ column: letterFor(index), value: resolveUserName((custom.processorUserId as string) ?? null) });
      continue;
    }
    if (key === "agentUserId") {
      cells.push({ column: letterFor(index), value: resolveUserName((custom.agentUserId as string) ?? null) });
      continue;
    }
    const value = custom[key];
    if (value === null || value === undefined || value === "") continue;
    // Tên khách hàng trên Sheet thật có link tới hồ sơ gốc (tax.agentc3.com) ở CHÍNH ô Name
    // (thêm 2026-08-14, đọc được qua `custom.nameLink` lúc import/webhook) — ghi lại bằng
    // công thức HYPERLINK thay vì text thường để KHÔNG xoá mất link mỗi lần app đẩy lại
    // dòng (mọi lần push trước đây đều ghi text thường, xoá sạch link Admin/Agent đã gắn).
    if (key === "name" && typeof custom.nameLink === "string" && custom.nameLink.trim()) {
      const url = custom.nameLink.trim().replace(/"/g, '""');
      const label = String(value).replace(/"/g, '""');
      cells.push({ column: letterFor(index), value: `=HYPERLINK("${url}","${label}")`, isFormula: true });
      continue;
    }
    const col = COLUMN_BY_KEY.get(key);
    if (col?.type === "select") {
      const options = key === "crmSource" ? crmSourceOptions : (col.options ?? []);
      const opt = options.find((o) => o.id === value);
      cells.push({ column: letterFor(index), value: opt?.label ?? String(value) });
      continue;
    }
    // Cột kiểu ngày lưu ISO "YYYY-MM-DD" trong custom — ghi thẳng ISO lên Sheet trước đây
    // không khớp định dạng mm/dd/yy đang dùng ở mọi nơi khác (app + các dòng có sẵn trên
    // chính Sheet này), gây lệch định dạng giữa app và Sheet (báo cáo thật 2026-08-15).
    if (col?.type === "date" && typeof value === "string") {
      cells.push({ column: letterFor(index), value: formatDateValue(value, "mdy2") });
      continue;
    }
    if (typeof value === "number") {
      cells.push({ column: letterFor(index), value });
      continue;
    }
    cells.push({ column: letterFor(index), value: String(value) });
  }

  return cells;
}

/** Chỉ số cột 0-based ô "Ngày" (efile date) mỗi năm — Note gắn vào ĐÚNG ô này (Sheet thật
 * không có cột riêng nào cho ghi chú, xem deployment-database-sync.md mục 4.22 phần Note).
 * Dùng chung cho cả 2 chiều: App→Sheet (buildCpaReviewSheetNotes) và sinh Apps Script quét
 * Note định kỳ (yearNoteColumnsForAppsScript trong /api/config/cpa-review-sheet/route.ts). */
export function yearNoteColumnIndex(year: string): number {
  return CPA_REVIEW_KEY_TO_SHEET_COLUMN[yearEfileDateKey(year)];
}

/** Danh sách Note cần ghi/xoá lên Sheet cho 1 record — 1 phần tử mỗi năm (kể cả rỗng, để
 * XOÁ note cũ nếu người dùng vừa xoá ghi chú trong app). Thêm 2026-08-14, yêu cầu "insert
 * note trên phần mềm... phải đồng bộ 2 chiều". */
export function buildCpaReviewSheetNotes(record: CpaReviewRecord): NoteWrite[] {
  const custom = record.custom;
  return CPA_REVIEW_YEARS.map((year) => ({
    columnIndex: yearNoteColumnIndex(year),
    note: typeof custom[yearNoteKey(year)] === "string" ? (custom[yearNoteKey(year)] as string) : "",
  }));
}

/** 1 thay đổi đọc được từ webhook Apps Script (Sheet -> App). */
export interface SheetCellChange {
  columnIndex: number;
  rawValue: string;
}

/** "MM/DD/YY", "MM/DD/YYYY" hoặc ISO "YYYY-MM-DD" -> ISO. null nếu không parse được/rỗng.
 * KHÔNG neo `$` cuối regex (khác bản đầu) — Apps Script onEdit's `e.value` cho 1 ô định dạng
 * ngày đôi khi kèm theo giờ ("8/15/2026 0:00:00") tuỳ định dạng số của ô, trước đây bị coi là
 * "không parse được" và ÂM THẦM bỏ qua toàn bộ thay đổi (không có lỗi nào hiện ra) — đây là
 * nguyên nhân thật gây ra báo cáo "đổi ngày trên Sheet nhưng app không cập nhật" (2026-08-15). */
function parseSheetDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // (\d{4}|\d{2}) — thử khớp 4 chữ số TRƯỚC (không phải \d{2} trước như trước đây): thiếu
  // `$` neo cuối (để còn cho phép có giờ theo sau) nghĩa là \d{2} sẽ khớp "20" trong "2026"
  // rồi dừng ngay (không backtrack) nếu đặt trước, ra sai năm "2020" thay vì "2026".
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/.exec(trimmed);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // Chuỗi SỐ THUẦN (không có "/" hay "-") — Apps Script's `e.value` đôi khi trả về SERIAL
  // NUMBER thô của Google Sheets (số ngày kể từ 30/12/1899) thay vì chuỗi ngày đã định dạng,
  // gặp thật khi ô vừa được tính lại qua công thức/paste thay vì gõ tay trực tiếp (bug thật
  // gặp production 2026-08-15: "efileDate_2025" bị lưu thành "46250-01-01" — `new Date("46250")`
  // bị JS hiểu nhầm thành năm 46250 thay vì convert serial number, đúng ra là 16/08/2026).
  // PHẢI xử lý TRƯỚC fallback `new Date(trimmed)` bên dưới vì đó chính là nguồn gây lỗi.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
      const da = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${mo}-${da}`;
    }
    return null;
  }
  // Fallback cuối: chuỗi dạng Date.toString() ("Sat Aug 15 2026 00:00:00 GMT+0700 (...)"),
  // Apps Script trả đúng dạng này khi ô có định dạng số không phải "Date" thuần. Lấy
  // ngày/tháng/năm theo giờ LOCAL (không dùng UTC) để tránh lệch 1 ngày qua múi giờ.
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }
  return null;
}

function parseSheetAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Diễn giải 1 thay đổi từ Sheet thành { key, value } ghi vào `custom` — null nếu cột
 * không quản lý (ngoài A-AH) hoặc giá trị không parse được (bỏ qua, không ghi rác). Cột
 * Processor/Agent trả `key` là `processorUserId`/`agentUserId`, value là USER ID đã tra
 * qua `nameToUserId` (null nếu tên trong Sheet chưa được Admin ánh xạ — bỏ qua). */
export function sheetChangeToPatch(
  change: SheetCellChange,
  nameToUserId: Record<string, string>,
  /** Cùng crmSourceOptions động ở buildCpaReviewSheetCells — dùng để khớp NGƯỢC nhãn Sheet
   * gửi lên (Sheet→App) về đúng id hiện tại của cột Status. */
  crmSourceOptions: SelectOption[]
): { key: string; value: string | number } | null {
  const key = CPA_REVIEW_SHEET_COLUMN_MAP[change.columnIndex];
  if (!key) return null;
  const raw = change.rawValue.trim();

  // Ô vừa bị XOÁ TRẮNG trên Sheet — trước đây mọi nhánh bên dưới coi "" là "không parse
  // được" -> trả null -> webhook bỏ qua toàn bộ thay đổi, khiến xoá Status (hay Processor/
  // Agent/ngày/số tiền) trên Sheet KHÔNG BAO GIỜ đồng bộ xuống app (bug thật gặp production
  // 2026-08-16, "để trống Status trên Sheet nhưng CPA Review vẫn giữ nguyên"). Tách rõ 2
  // trường hợp: rỗng = Ý ĐỊNH xoá (luôn áp dụng), có giá trị nhưng không khớp được gì mới là
  // "không parse được" (giữ nguyên hành vi bỏ qua + log cảnh báo cũ).
  if (!raw) {
    if (key === "processorUserId" || key === "agentUserId") return { key, value: "" };
    const col = COLUMN_BY_KEY.get(key);
    if (col?.type === "currency") return { key, value: 0 };
    return { key, value: "" };
  }

  if (key === "processorUserId" || key === "agentUserId") {
    const userId = nameToUserId[raw];
    if (!userId) return null;
    return { key, value: userId };
  }

  const col = COLUMN_BY_KEY.get(key);
  if (col?.type === "date") {
    const iso = parseSheetDate(raw);
    return iso ? { key, value: iso } : null;
  }
  if (col?.type === "currency") {
    const amount = parseSheetAmount(raw);
    return amount === null ? null : { key, value: amount };
  }
  if (col?.type === "select") {
    const options = key.startsWith("status_") ? CPA_REVIEW_STATUS_OPTIONS : crmSourceOptions;
    const opt = options.find((o) => o.label.toLowerCase() === raw.toLowerCase());
    return opt ? { key, value: opt.id } : null;
  }
  return { key, value: raw };
}
