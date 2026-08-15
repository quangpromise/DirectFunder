import { google } from "googleapis";
import { prisma } from "./prisma";
import { getServiceAccountSheetsClient, isServiceAccountConfigured } from "./google-service-account";
import { ensureRowExists, writeCells, writeCellNotes, mapSheetsError, type CellWrite } from "./google-sheets";
import {
  buildCpaReviewSheetCells,
  buildCpaReviewSheetNotes,
  yearNoteColumnIndex,
  letterFor,
  sheetChangeToPatch,
  CPA_REVIEW_MANAGED_COLUMN_INDEXES,
} from "./cpa-review-sheet-columns";
import { CPA_REVIEW_YEARS, yearNoteKey, caseStatusOptionsForCrmSource } from "./cpa-review-columns";
import type { ColumnDef, CpaReviewRecord, CpaReviewSheetConfig, CpaReviewSheetConfigMap, SelectOption, User } from "./types";

/** Options hiện tại của cột "CRM Source" (đọc động từ options cột "status" của Case, xem
 * caseStatusOptionsForCrmSource) — module này không có sẵn AppConfig nên tự fetch riêng ở
 * đây, dùng chung cho mọi hướng đồng bộ (import lần đầu/push/resync). */
export async function getCrmSourceOptions(): Promise<SelectOption[]> {
  const appConfig = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const columns = (appConfig?.columns as unknown as ColumnDef[] | undefined) ?? [];
  return caseStatusOptionsForCrmSource(columns);
}

/** sortOrder cho 1 dòng CPA Review MỚI trong đúng tháng — LUÔN nối vào "dòng trống tiếp
 * theo" ở CUỐI bảng (giá trị lớn hơn mọi sortOrder hiện có, ORDER BY sortOrder ASC) thay vì
 * lên đầu như hành vi mặc định ở Cases/Collecting (thêm 2026-08-14, yêu cầu "chèn vào row
 * trống tiếp theo, không chèn lên đầu") — dùng chung cho cả nút "Thêm" trong tab CPA Review
 * lẫn nút "Test Sheet" ở bảng Hồ sơ. */
export async function nextAppendCpaReviewSortOrder(month: string): Promise<number> {
  const agg = await prisma.cpaReviewRecord.aggregate({ where: { month }, _max: { sortOrder: true } });
  return (agg._max.sortOrder ?? 0) + 1;
}

const SSN_COLUMN_INDEX = 3; // cột D
const SCAN_START_ROW = 4; // hàng 1-3 là header/tổng, dữ liệu bắt đầu hàng 4 (xác nhận qua khảo sát thật)
const SCAN_ROW_LIMIT = 3000;
const FULL_ROW_LAST_COL = 33; // AH

export class SheetNotAccessibleError extends Error {}

/** Đọc map cấu hình đồng bộ (Record<monthKey, CpaReviewSheetConfig>) từ AppConfig — mỗi
 * tháng 1 kết nối Sheet riêng (thêm 2026-08-14, xem deployment-database-sync.md mục 4.22). */
export async function getCpaReviewSheetConfigMap(): Promise<CpaReviewSheetConfigMap> {
  const appConfig = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  return (appConfig?.cpaReviewSheetConfig as unknown as CpaReviewSheetConfigMap | null) ?? {};
}

export async function saveCpaReviewSheetConfigMap(map: CpaReviewSheetConfigMap): Promise<void> {
  await prisma.appConfig.update({ where: { id: "singleton" }, data: { cpaReviewSheetConfig: map as unknown as object } });
}

/** Tìm entry (month + config) trong map khớp đúng `webhookSecret` — dùng ở webhook vì
 * payload từ Apps Script chỉ có secret (mỗi tháng 1 secret riêng, không cần gửi kèm month). */
export function findCpaReviewConfigBySecret(
  map: CpaReviewSheetConfigMap,
  secret: string
): { month: string; config: CpaReviewSheetConfig } | null {
  for (const [month, config] of Object.entries(map)) {
    if (config?.webhookSecret === secret) return { month, config };
  }
  return null;
}

/** Tra tên tab thật từ gid — batchUpdate/values.get cần TÊN tab, không nhận gid trực tiếp. */
export async function resolveTabNameFromGid(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  gid: string
): Promise<string> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const match = meta.data.sheets?.find((s) => String(s.properties?.sheetId ?? "") === gid);
  if (!match?.properties?.title) {
    throw new SheetNotAccessibleError(`Không tìm thấy tab (gid=${gid}) trên Sheet này.`);
  }
  return match.properties.title;
}

/** Đảm bảo tab đủ lớn để chứa layout A-AH x 3000+ dòng — Sheet MỚI tạo (hoặc tab trống)
 * mặc định chỉ 1000 dòng x 26 cột (Z), trong khi mọi range quét/ghi của tính năng này dùng
 * tới cột AH (34) và dòng 3003 — Google Sheets API TỪ CHỐI thẳng bất kỳ range nào vượt quá
 * kích thước grid khai báo của tab (lỗi "exceeds grid limits"), khác với range nằm trong
 * grid nhưng không có dữ liệu (vẫn trả về rỗng bình thường). Gặp thật 2026-08-15 khi kết
 * nối 1 tab mới ("Sheet31", chưa từng resize). CHỈ tăng kích thước (rowCount/columnCount),
 * không bao giờ giảm — không đụng/mất dữ liệu hiện có trên Sheet. */
export async function ensureSheetGridSize(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  gid: string,
  minRows: number,
  minCols: number
): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,gridProperties)",
  });
  const match = meta.data.sheets?.find((s) => String(s.properties?.sheetId ?? "") === gid);
  const grid = match?.properties?.gridProperties;
  const currentRows = grid?.rowCount ?? 1000;
  const currentCols = grid?.columnCount ?? 26;
  if (currentRows >= minRows && currentCols >= minCols) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: Number(gid),
              gridProperties: {
                rowCount: Math.max(currentRows, minRows),
                columnCount: Math.max(currentCols, minCols),
              },
            },
            fields: "gridProperties.rowCount,gridProperties.columnCount",
          },
        },
      ],
    },
  });
}

/** Kích thước tối thiểu tab cần có cho layout CPA Review — dùng chung cho connect/resync. */
export const CPA_REVIEW_MIN_GRID = {
  rows: SCAN_START_ROW + SCAN_ROW_LIMIT - 1,
  cols: FULL_ROW_LAST_COL + 1,
} as const;

/** Quét cột Processor (AC) + Agent (AD) — trả về danh sách tên PHÂN BIỆT xuất hiện trong
 * Sheet, dùng để Admin ánh xạ sang User.id qua UI (nameToUserId) sau lần kết nối đầu. */
export async function scanDistinctNames(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string
): Promise<string[]> {
  const colProcessor = letterFor(28);
  const colAgent = letterFor(29);
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [
      `'${tabName}'!${colProcessor}${SCAN_START_ROW}:${colProcessor}${SCAN_START_ROW + SCAN_ROW_LIMIT - 1}`,
      `'${tabName}'!${colAgent}${SCAN_START_ROW}:${colAgent}${SCAN_START_ROW + SCAN_ROW_LIMIT - 1}`,
    ],
  });
  const names = new Set<string>();
  for (const range of res.data.valueRanges ?? []) {
    for (const row of range.values ?? []) {
      const name = (row?.[0] ?? "").toString().trim();
      if (name) names.add(name);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

const NAME_COLUMN_INDEX = 1; // cột B

/** Đọc link đính kèm ô Name (cột B) cho từng dòng trong phạm vi quét — Sheets API chỉ trả
 * hyperlink qua `spreadsheets.get` (không có ở `values.get` dùng để đọc giá trị thường),
 * nên cần 1 lệnh riêng. Trả về map "số dòng thật trên Sheet" -> URL (bỏ qua dòng không có
 * link). Thêm 2026-08-14 — Sheet thật gắn link tới hồ sơ gốc (tax.agentc3.com) ở cột này. */
async function fetchNameHyperlinks(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string,
  rowCount: number
): Promise<Map<number, string>> {
  const col = letterFor(NAME_COLUMN_INDEX);
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`'${tabName}'!${col}${SCAN_START_ROW}:${col}${SCAN_START_ROW + rowCount - 1}`],
    fields: "sheets.data.rowData.values(hyperlink)",
  });
  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  const links = new Map<number, string>();
  rowData.forEach((r, i) => {
    const link = r.values?.[0]?.hyperlink;
    if (link) links.set(SCAN_START_ROW + i, link);
  });
  return links;
}

/** Đọc toàn bộ dòng có SSN (cột D) trong phạm vi A-AH, tạo MỚI 1 `CpaReviewRecord` cho mỗi
 * dòng, gắn vào đúng `month` đang kết nối (bảng độc lập, không có Case sẵn để đối chiếu —
 * xem deployment-database-sync.md mục 4.22, "không liên kết bất cứ gì"). Trả về rowIndex
 * (SSN -> số dòng) để lưu cache. Tên Processor/Agent trong Sheet CHƯA map được (nameToUserId
 * rỗng lúc kết nối lần đầu) nên bị bỏ qua, Admin điền tay hoặc ánh xạ tên rồi bấm "Đồng bộ
 * lại toàn bộ" sau. */
export async function importSheetRows(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string,
  month: string
): Promise<{ rowIndex: Record<string, number>; imported: number }> {
  const lastCol = letterFor(FULL_ROW_LAST_COL);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A${SCAN_START_ROW}:${lastCol}${SCAN_START_ROW + SCAN_ROW_LIMIT - 1}`,
  });
  const rows = res.data.values ?? [];
  const nameLinks = await fetchNameHyperlinks(sheets, spreadsheetId, tabName, rows.length);
  const crmSourceOptions = await getCrmSourceOptions();
  const rowIndex: Record<string, number> = {};
  let imported = 0;
  let sortOrder = -Date.now();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const ssn = (row[SSN_COLUMN_INDEX] ?? "").toString().trim().split("\n")[0]?.trim();
    if (!ssn) continue;

    const custom: Record<string, string | number> = {};
    row.forEach((rawCell, columnIndex) => {
      const rawValue = (rawCell ?? "").toString();
      if (!rawValue.trim()) return;
      const patch = sheetChangeToPatch({ columnIndex, rawValue }, {}, crmSourceOptions);
      if (patch) custom[patch.key] = patch.value;
    });
    custom.ssn = ssn;
    const nameLink = nameLinks.get(SCAN_START_ROW + i);
    if (nameLink) custom.nameLink = nameLink;

    await prisma.cpaReviewRecord.create({ data: { custom, sortOrder: sortOrder++, month } });
    rowIndex[ssn] = SCAN_START_ROW + i;
    imported++;
  }

  return { rowIndex, imported };
}

function buildUserNameResolver(users: User[], nameToUserId: Record<string, string>) {
  const byId = new Map(users.map((u) => [u.id, u]));
  return (userId: string | null): string => {
    if (!userId) return "";
    const user = byId.get(userId);
    if (!user) return "";
    const mappedName = Object.entries(nameToUserId).find(([, uid]) => uid === userId)?.[0];
    return mappedName ?? user.username ?? user.name;
  };
}

function recordSsn(record: CpaReviewRecord): string | null {
  const ssn = record.custom.ssn;
  return typeof ssn === "string" && ssn.trim() ? ssn.trim() : null;
}

/** Ghi 1 dòng vào đúng vị trí trong Sheet CPA Review — tự tra rowIndex cache, append dòng
 * mới nếu chưa có (record mới hoặc SSN mới đổi). Trả về rowIndex MỚI nếu có append (nơi
 * gọi cần lưu lại AppConfig.cpaReviewSheetConfig[month].rowIndex). */
async function pushRecordToSheet(
  record: CpaReviewRecord,
  config: CpaReviewSheetConfig,
  users: User[],
  ssn: string,
  crmSourceOptions: SelectOption[]
): Promise<{ appendedRow?: number } | null> {
  const sheets = getServiceAccountSheetsClient();
  const resolveUserName = buildUserNameResolver(users, config.nameToUserId);
  const cells = buildCpaReviewSheetCells(record, resolveUserName, crmSourceOptions);
  const notes = buildCpaReviewSheetNotes(record);
  // Vẫn tiếp tục nếu record đã TỪNG chạm tới ghi chú năm nào (kể cả vừa xoá về rỗng) — trước
  // đây bỏ qua sớm khi cells rỗng khiến ghi chú không bao giờ được đẩy lên Sheet nếu người
  // dùng CHỈ sửa ghi chú mà không đụng ô nào khác, thêm 2026-08-14.
  const noteTouched = CPA_REVIEW_YEARS.some((year) => yearNoteKey(year) in record.custom);
  if (cells.length === 0 && !noteTouched) return null;

  let targetRow = config.rowIndex[ssn];
  let appendedRow: number | undefined;
  if (!targetRow) {
    const occupied = Object.values(config.rowIndex);
    targetRow = occupied.length > 0 ? Math.max(...occupied) + 1 : SCAN_START_ROW;
    appendedRow = targetRow;
  }
  await ensureRowExists(sheets, config.sheetId, config.tabName, targetRow);
  const cellsWithSsn: CellWrite[] = [...cells, { column: letterFor(SSN_COLUMN_INDEX), value: ssn }];
  await writeCells(sheets, config.sheetId, config.tabName, targetRow, cellsWithSsn);
  // Chỉ tốn thêm 1 lệnh batchUpdate ghi Note khi thật sự có liên quan tới ghi chú (record có
  // Note hoặc lần lưu này đụng tới field ghi chú) — tránh gọi API thừa mỗi lần sửa 1 ô KHÔNG
  // liên quan gì tới Note (vd chỉ đổi Status).
  if (noteTouched || notes.some((n) => n.note)) {
    await writeCellNotes(sheets, config.sheetId, config.tabName, targetRow, notes);
  }
  return appendedRow ? { appendedRow: targetRow } : null;
}

/** Đẩy 1 record lên Sheet CPA Review đúng THÁNG của record đó (nếu tháng đó đã kết nối) —
 * gọi từ `after()` trong POST/PATCH /api/cpa-review* để KHÔNG chặn response chính. Lỗi chỉ
 * log, không throw ra ngoài (không ảnh hưởng response đã trả về). */
export async function syncRecordToCpaReviewSheet(record: CpaReviewRecord): Promise<void> {
  if (!isServiceAccountConfigured()) return;
  const ssn = recordSsn(record);
  if (!ssn) return;

  try {
    const map = await getCpaReviewSheetConfigMap();
    const sheetConfig = map[record.month];
    if (!sheetConfig?.sheetId) return;

    const users = (await prisma.user.findMany()) as unknown as User[];
    const crmSourceOptions = await getCrmSourceOptions();
    const result = await pushRecordToSheet(record, sheetConfig, users, ssn, crmSourceOptions);
    if (result?.appendedRow) {
      await saveCpaReviewSheetConfigMap({
        ...map,
        [record.month]: { ...sheetConfig, rowIndex: { ...sheetConfig.rowIndex, [ssn]: result.appendedRow } },
      });
    }
  } catch (err) {
    console.error("syncRecordToCpaReviewSheet thất bại (bỏ qua, không ảnh hưởng response chính):", err);
  }
}

/** Xoá giá trị dòng tương ứng khi 1 record bị xoá trong app. */
export async function clearRecordFromCpaReviewSheet(record: CpaReviewRecord): Promise<void> {
  if (!isServiceAccountConfigured()) return;
  const ssn = recordSsn(record);
  if (!ssn) return;

  try {
    const map = await getCpaReviewSheetConfigMap();
    const sheetConfig = map[record.month];
    if (!sheetConfig?.sheetId) return;
    const targetRow = sheetConfig.rowIndex[ssn];
    if (!targetRow) return;
    const sheets = getServiceAccountSheetsClient();
    const cells: CellWrite[] = CPA_REVIEW_MANAGED_COLUMN_INDEXES.map((index) => ({ column: letterFor(index), value: "" }));
    await writeCells(sheets, sheetConfig.sheetId, sheetConfig.tabName, targetRow, cells);
    const notes = CPA_REVIEW_YEARS.map((year) => ({ columnIndex: yearNoteColumnIndex(year), note: "" }));
    await writeCellNotes(sheets, sheetConfig.sheetId, sheetConfig.tabName, targetRow, notes);
  } catch (err) {
    console.error("clearRecordFromCpaReviewSheet thất bại (bỏ qua, không ảnh hưởng response chính):", err);
  }
}

/** Đẩy lại TOÀN BỘ record của 1 THÁNG lên đúng Sheet tháng đó — dùng cho nút "Đồng bộ lại
 * toàn bộ" (mỗi tháng resync riêng, không đụng tháng khác). */
export async function resyncAllRecordsToSheet(month: string): Promise<number> {
  const map = await getCpaReviewSheetConfigMap();
  const sheetConfig = map[month];
  if (!sheetConfig?.sheetId) throw new Error("Chưa kết nối Sheet CPA Review cho tháng này");

  // Cùng lý do ở connect (xem ensureSheetGridSize) — Sheet có thể đã bị Admin/người dùng
  // vô tình thu nhỏ tab lại sau khi kết nối, phòng hờ trước khi ghi hàng loạt.
  const sheets = getServiceAccountSheetsClient();
  await ensureSheetGridSize(sheets, sheetConfig.sheetId, sheetConfig.gid, CPA_REVIEW_MIN_GRID.rows, CPA_REVIEW_MIN_GRID.cols);

  const users = (await prisma.user.findMany()) as unknown as User[];
  const rows = await prisma.cpaReviewRecord.findMany({ where: { month } });
  const crmSourceOptions = await getCrmSourceOptions();

  let current = sheetConfig;
  let pushed = 0;
  for (const row of rows) {
    const record: CpaReviewRecord = {
      id: row.id,
      month: row.month,
      custom: row.custom as CpaReviewRecord["custom"],
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    const ssn = recordSsn(record);
    if (!ssn) continue;
    const result = await pushRecordToSheet(record, current, users, ssn, crmSourceOptions);
    pushed++;
    if (result?.appendedRow) {
      current = { ...current, rowIndex: { ...current.rowIndex, [ssn]: result.appendedRow } };
    }
  }
  if (current !== sheetConfig) {
    await saveCpaReviewSheetConfigMap({ ...map, [month]: current });
  }
  return pushed;
}

export { mapSheetsError };
