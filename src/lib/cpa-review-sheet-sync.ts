import { google } from "googleapis";
import { prisma } from "./prisma";
import { getServiceAccountSheetsClient, isServiceAccountConfigured } from "./google-service-account";
import { ensureRowExists, writeCells, writeCellNotes, centerAlignRow, leftAlignColumn, mapSheetsError, type CellWrite } from "./google-sheets";
import {
  buildCpaReviewSheetCells,
  buildCpaReviewSheetNotes,
  buildCpaReviewYearTotalCells,
  letterFor,
  sheetChangeToPatch,
} from "./cpa-review-sheet-columns";
import { CPA_REVIEW_YEARS, yearNoteKey, caseStatusOptionsForCrmSource } from "./cpa-review-columns";
import type { ColumnDef, CpaReviewRecord, CpaReviewSheetConfig, CpaReviewSheetConfigMap, SelectOption, User } from "./types";
import type { Prisma } from "@prisma/client";

/** Options hiện tại của cột "CRM Source" (đọc động từ options cột "status" của Case, xem
 * caseStatusOptionsForCrmSource) — module này không có sẵn AppConfig nên tự fetch riêng ở
 * đây, dùng chung cho mọi hướng đồng bộ (import lần đầu/push/resync). */
export async function getCrmSourceOptions(): Promise<SelectOption[]> {
  const appConfig = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const columns = (appConfig?.columns as unknown as ColumnDef[] | undefined) ?? [];
  return caseStatusOptionsForCrmSource(columns);
}

/** sortOrder cho 1 dòng CPA Review MỚI trong đúng tháng — LUÔN nối vào "dòng trống tiếp
 * theo" ở CUỐI bảng (giá trị lớn hơn mọi sortOrder hiện có, ORDER BY sortOrder ASC).
 *
 * ĐÃ THỬ đổi sang lên ĐẦU bảng (2026-08-15, yêu cầu "row 4 sẽ là row đầu tiên để add row hay
 * sent mới") rồi ĐẢO LẠI về đúng bản này TRONG CÙNG NGÀY sau khi phát hiện bug thật: Google
 * Sheet chỉ NỐI THÊM dòng mới vào CUỐI (không thể "chèn lên đầu"), nên nếu app hiển thị dòng
 * mới nhất ở đầu, số "row" trong app (gutter) sẽ KHÔNG còn khớp đúng số dòng thật trên Sheet
 * nữa ngay khi có từ 2 dòng trở lên — case "Dinh Hieu Huynh" thật gặp: dòng tạo SAU (Sheet
 * row 5) hiện ở app thành "row 4" (đầu), dòng tạo TRƯỚC (Sheet row 4) lại hiện thành "row 5",
 * gây cảm giác "sửa 1 dòng làm dòng kia nhảy lên đầu" dù không đụng gì tới dòng còn lại.
 * User xác nhận ưu tiên khớp đúng thứ tự Sheet hơn — dùng chung cho cả nút "Thêm" trong tab
 * CPA Review lẫn nút "Test Sheet" ở bảng Hồ sơ. */
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

/** Dò rule Data Validation (dropdown) của 1 cột trong vài dòng đầu (đủ để bắt được rule áp
 * cho cả cột, kể cả khi ô đầu tiên trống) — trả về đúng danh sách giá trị + CHỮ HOA/THƯỜNG
 * như đã khai báo trong dropdown thật của Sheet, KHÔNG phải giá trị đã gõ vào ô nào (2 nguồn
 * có thể lệch hoa/thường nếu dropdown viết "Toan" nhưng có ô lỡ gõ tay "toan"). */
async function scanColumnDropdownValues(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string,
  columnLetter: string
): Promise<string[]> {
  const probeRows = 30;
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`'${tabName}'!${columnLetter}${SCAN_START_ROW}:${columnLetter}${SCAN_START_ROW + probeRows - 1}`],
    fields: "sheets.data.rowData.values.dataValidation",
  });
  const rows = res.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  for (const row of rows) {
    const rule = row.values?.[0]?.dataValidation;
    if (rule?.condition?.type === "ONE_OF_LIST") {
      return (rule.condition.values ?? [])
        .map((v) => v.userEnteredValue)
        .filter((v): v is string => Boolean(v && v.trim()))
        .map((v) => v.trim());
    }
  }
  return [];
}

/** Quét cột Processor (AC) + Agent (AD) — trả về danh sách tên PHÂN BIỆT xuất hiện trong
 * Sheet, dùng để Admin ánh xạ sang User.id qua UI (nameToUserId) sau lần kết nối đầu.
 * Ưu tiên chữ hoa/thường từ chính dropdown (Data Validation) của 2 cột này nếu đọc được —
 * đè lên chữ hoa/thường của giá trị đã dùng trong ô (thêm 2026-08-15, sửa lỗi Processor/
 * Agent bị ghi sai hoa/thường khi đẩy App→Sheet vì trước đó fallback về `username` luôn viết
 * thường). Không đọc được dropdown (vd Sheet không dùng Data Validation) -> vẫn trả về danh
 * sách từ giá trị đã dùng như cũ, không lỗi. */
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
  const names = new Map<string, string>(); // lowercase -> chữ hoa/thường chuẩn dùng để hiển thị/lưu
  for (const range of res.data.valueRanges ?? []) {
    for (const row of range.values ?? []) {
      const name = (row?.[0] ?? "").toString().trim();
      if (name) names.set(name.toLowerCase(), name);
    }
  }

  const [processorOptions, agentOptions] = await Promise.all([
    scanColumnDropdownValues(sheets, spreadsheetId, tabName, colProcessor),
    scanColumnDropdownValues(sheets, spreadsheetId, tabName, colAgent),
  ]);
  for (const opt of [...processorOptions, ...agentOptions]) {
    names.set(opt.toLowerCase(), opt); // ghi đè -> dropdown luôn thắng giá trị đã dùng
  }

  return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
}

const NAME_COLUMN_INDEX = 1; // cột B
const NOTE_COLUMN_INDEX = 27; // cột AB — "Note" (ghi chú tự do, khác icon 📌 ở ô Ngày mỗi năm)

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

  // Ghép SSN đã có sẵn trong THÁNG này (thêm 2026-08-15, cho phép "Đổi link" kết nối lại
  // Sheet khác cho cùng 1 tháng mà KHÔNG tạo trùng lặp dòng) — trước đây hàm này CHỈ chạy
  // đúng 1 lần lúc kết nối lần đầu (tháng luôn trống) nên chưa lộ ra vấn đề gì, nhưng nếu
  // gọi lại khi tháng đã có dữ liệu (reconnect) sẽ tạo mới toàn bộ thay vì cập nhật.
  const existing = await prisma.cpaReviewRecord.findMany({ where: { month }, select: { id: true, custom: true } });
  const existingBySsn = new Map<string, { id: string; custom: Record<string, unknown> }>();
  for (const r of existing) {
    const c = (r.custom as Record<string, unknown>) ?? {};
    if (typeof c.ssn === "string" && c.ssn.trim()) existingBySsn.set(c.ssn.trim(), { id: r.id, custom: c });
  }

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

    const match = existingBySsn.get(ssn);
    if (match) {
      // Sheet thắng (khác "App luôn thắng" của webhook) — đây là hành động Admin CHỦ Ý bấm
      // kết nối/nhập lại từ Sheet, hợp lý để Sheet ghi đè giá trị app đang có cho SSN này.
      const merged = { ...match.custom, ...custom };
      await prisma.cpaReviewRecord.update({ where: { id: match.id }, data: { custom: merged as Prisma.InputJsonValue } });
    } else {
      await prisma.cpaReviewRecord.create({ data: { custom, sortOrder: sortOrder++, month } });
    }
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
    // Chưa từng ánh xạ (Admin chưa gán tên Sheet cho user này) -> dùng `name` (Họ tên gõ tay
    // lúc tạo tài khoản, giữ đúng hoa/thường), KHÔNG dùng `username` (luôn bị hạ hết thành
    // chữ thường, xem workflow-conventions.md — đây chính là nguyên nhân Processor/Agent bị
    // ghi sai hoa/thường lên Sheet, sửa 2026-08-15).
    return mappedName ?? user.name;
  };
}

function recordSsn(record: CpaReviewRecord): string | null {
  const ssn = record.custom.ssn;
  return typeof ssn === "string" && ssn.trim() ? ssn.trim() : null;
}

/** Quét lại toàn bộ cột SSN (cột D) trên Sheet để XÂY LẠI `rowIndex` (key = record.id) từ
 * đầu — dùng sau khi 1 hoặc nhiều dòng bị xoá TRỰC TIẾP trên Sheet (Sheet→App, xem webhook).
 * Tín hiệu xoá từ Apps Script chỉ cho biết "SSN nào không còn nữa", không biết CHÍNH XÁC bao
 * nhiêu dòng đã dịch chuyển (có thể xoá nhiều dòng cùng lúc) — quét lại từ đầu đơn giản và
 * chắc chắn đúng hơn nhiều so với cố tính toán dịch chuyển tăng dần cho từng trường hợp. */
export async function rebuildCpaReviewRowIndex(
  sheets: ReturnType<typeof google.sheets>,
  sheetConfig: CpaReviewSheetConfig,
  month: string
): Promise<Record<string, number>> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetConfig.sheetId,
    range: `'${sheetConfig.tabName}'!${letterFor(SSN_COLUMN_INDEX)}${SCAN_START_ROW}:${letterFor(SSN_COLUMN_INDEX)}${SCAN_START_ROW + SCAN_ROW_LIMIT - 1}`,
  });
  const rows = res.data.values ?? [];
  // HÀNG ĐỢI theo SSN (KHÔNG phải 1-1) — nhiều CpaReviewRecord có thể CÙNG 1 SSN (nút "Test
  // Sheet" gửi nhiều lần, mỗi lần 1 năm khác nhau, KHÔNG gộp — xem pushRecordToSheet). Map
  // cũ (1 SSN -> 1 record.id) khiến bản ghi thứ 2 trở đi của cùng SSN không bao giờ khớp được
  // dòng nào -> không phát hiện được lúc bị xoá (bug thật gặp production 2026-08-15, case
  // "Dinh Hieu Huynh"). Khớp THEO THỨ TỰ xuất hiện: dòng Sheet đầu tiên có SSN X khớp bản ghi
  // CŨ NHẤT (createdAt) còn SSN X chưa được khớp, dòng thứ 2 khớp bản ghi kế tiếp, v.v. — xác
  // định (deterministic), đủ dùng vì các bản ghi cùng SSN không phân biệt được gì khác ngoài
  // thứ tự tạo.
  const records = await prisma.cpaReviewRecord.findMany({
    where: { month },
    select: { id: true, custom: true },
    orderBy: { createdAt: "asc" },
  });
  const bySsn = new Map<string, string[]>();
  for (const r of records) {
    const custom = r.custom as Record<string, unknown>;
    if (typeof custom.ssn !== "string" || !custom.ssn.trim()) continue;
    const ssn = custom.ssn.trim();
    const queue = bySsn.get(ssn) ?? [];
    queue.push(r.id);
    bySsn.set(ssn, queue);
  }

  const nextRowIndex: Record<string, number> = {};
  rows.forEach((row, i) => {
    const ssn = (row[0] ?? "").toString().trim().split("\n")[0]?.trim();
    if (!ssn) return;
    const recordId = bySsn.get(ssn)?.shift();
    if (recordId) nextRowIndex[recordId] = SCAN_START_ROW + i;
  });
  return nextRowIndex;
}

/** Ghi 1 dòng vào đúng vị trí trong Sheet CPA Review — tự tra rowIndex cache, append dòng
 * mới nếu chưa có. Trả về thông tin cache cần lưu lại nếu có gì thay đổi (dòng mới, hoặc
 * vừa tự chuyển từ cache kiểu cũ sang kiểu mới — xem giải thích dưới), null nếu không cần
 * ghi lại config (đã đúng cache từ trước, hoặc không có gì để đẩy).
 *
 * **Cache theo `record.id`, KHÔNG theo SSN** (đổi 2026-08-15) — bản đầu cache theo SSN, giả
 * định ngầm "1 SSN = 1 dòng/tháng" (đúng với Sheet gốc lúc import lần đầu, SSN vốn không
 * trùng). Giả định đó bị PHÁ VỠ bởi nút "Test Sheet": theo yêu cầu, gửi hồ sơ nhiều lần với
 * năm khác nhau phải tạo NHIỀU CpaReviewRecord riêng biệt cùng SSN (không gộp) — cache theo
 * SSN khiến các dòng này tranh nhau đúng 1 dòng Sheet, ghi đè lẫn nhau (bug thật gặp
 * production, case "Dinh Hieu Huynh"). `config.rowIndex[ssn]` (kiểu cache CŨ) vẫn được đọc
 * làm fallback TỰ CHUYỂN ĐỔI 1 lần cho các dòng import cũ chưa từng cache theo id — nhận
 * đúng dòng cũ thay vì append nhầm 1 dòng mới trùng lặp cho dòng vốn đã tồn tại. */
async function pushRecordToSheet(
  record: CpaReviewRecord,
  config: CpaReviewSheetConfig,
  users: User[],
  ssn: string,
  crmSourceOptions: SelectOption[]
): Promise<{ cacheKey: string; row: number; removeLegacyKey?: string } | null> {
  const sheets = getServiceAccountSheetsClient();
  const resolveUserName = buildUserNameResolver(users, config.nameToUserId);
  const cells = buildCpaReviewSheetCells(record, resolveUserName, crmSourceOptions);
  const notes = buildCpaReviewSheetNotes(record);
  // Vẫn tiếp tục nếu record đã TỪNG chạm tới ghi chú năm nào (kể cả vừa xoá về rỗng) — trước
  // đây bỏ qua sớm khi cells rỗng khiến ghi chú không bao giờ được đẩy lên Sheet nếu người
  // dùng CHỈ sửa ghi chú mà không đụng ô nào khác, thêm 2026-08-14.
  const noteTouched = CPA_REVIEW_YEARS.some((year) => yearNoteKey(year) in record.custom);
  if (cells.length === 0 && !noteTouched) return null;

  let targetRow = config.rowIndex[record.id];
  let appendedRow: number | undefined;
  let removeLegacyKey: string | undefined;
  if (!targetRow) {
    const legacyRow = config.rowIndex[ssn];
    if (legacyRow !== undefined) {
      targetRow = legacyRow;
      removeLegacyKey = ssn;
    } else {
      const occupied = Object.values(config.rowIndex);
      targetRow = occupied.length > 0 ? Math.max(...occupied) + 1 : SCAN_START_ROW;
      appendedRow = targetRow;
    }
  }
  // KHÔNG tự set/ghi đè Data Validation (dropdown) của Status/CRM Source ở đây — Admin đã tự
  // thiết lập dropdown sẵn cho toàn bộ cột ngay từ lúc dựng Sheet gốc (đã xác nhận qua kiểm
  // tra trực tiếp API, kể cả những dòng chưa từng có dữ liệu), app chỉ đọc/ghi GIÁ TRỊ, không
  // đụng gì tới cấu hình dropdown Admin đã set (yêu cầu 2026-08-15).
  await ensureRowExists(sheets, config.sheetId, config.tabName, targetRow);
  const cellsWithSsn: CellWrite[] = [...cells, { column: letterFor(SSN_COLUMN_INDEX), value: ssn }];
  // Ghi đè ô "Tổng" mỗi năm (=Số tiền+Other Refund) bằng giá trị THẬT tự tính — ÁP DỤNG CHO
  // MỌI DÒNG (kể cả dòng có sẵn, không chỉ dòng mới như bản trước), theo yêu cầu rõ ràng
  // 2026-08-16 ("ghi đè công thức Tổng... đến google sheet") — ĐẢO LẠI nguyên tắc "không tự
  // ghi đè công thức Sheet" đã áp dụng cho riêng ô này trước đó. Ghi giá trị số RAW (không
  // phải công thức `=O+P`) nên sẽ xoá mất công thức cũ ở ô đó nếu có — đúng như user yêu cầu.
  const cellsToWrite = [...cellsWithSsn, ...buildCpaReviewYearTotalCells(record)];
  await writeCells(sheets, config.sheetId, config.tabName, targetRow, cellsToWrite);
  // Căn giữa cả dòng vẫn CHỈ áp dụng cho dòng MỚI — dòng có sẵn có thể đã được Admin tự định
  // dạng riêng, không đụng tới.
  if (appendedRow !== undefined) {
    await centerAlignRow(sheets, config.sheetId, Number(config.gid), targetRow, FULL_ROW_LAST_COL);
  }
  // Cột Name luôn căn TRÁI (yêu cầu 2026-08-31) — ghi đè lại NGAY SAU `centerAlignRow` (chỉ
  // chạy cho dòng mới) VÀ cho cả dòng có sẵn (dòng cũ có thể đã bị căn giữa từ trước khi có
  // yêu cầu này), nên gọi ở đây, ngoài nhánh `if (appendedRow !== undefined)`. Cột Note cũng
  // căn TRÁI theo cùng yêu cầu (thêm 2026-09-03) — cùng lý do, áp dụng cho MỌI lần ghi (dòng
  // mới lẫn dòng có sẵn), không riêng dòng mới.
  await leftAlignColumn(sheets, config.sheetId, Number(config.gid), targetRow, NAME_COLUMN_INDEX);
  await leftAlignColumn(sheets, config.sheetId, Number(config.gid), targetRow, NOTE_COLUMN_INDEX);
  // Chỉ tốn thêm 1 lệnh batchUpdate ghi Note khi thật sự có liên quan tới ghi chú (record có
  // Note hoặc lần lưu này đụng tới field ghi chú) — tránh gọi API thừa mỗi lần sửa 1 ô KHÔNG
  // liên quan gì tới Note (vd chỉ đổi Status).
  if (noteTouched || notes.some((n) => n.note)) {
    await writeCellNotes(sheets, config.sheetId, config.tabName, targetRow, notes);
  }
  if (appendedRow === undefined && removeLegacyKey === undefined) return null;
  return { cacheKey: record.id, row: targetRow, removeLegacyKey };
}

/** Tra ngược `rowIndex` (key -> số dòng) để tìm key (thường là `record.id`, có thể vẫn là
 * SSN kiểu cache cũ) đang trỏ tới đúng số dòng Sheet đã cho — dùng ở chiều Sheet→App
 * (webhook) để biết CHÍNH XÁC dòng nào trong nhiều dòng CÙNG SSN vừa được sửa (thêm
 * 2026-08-15, xem giải thích ở pushRecordToSheet). Trả về `undefined` nếu dòng đó chưa
 * từng được cache (dòng mới gõ tay trực tiếp trên Sheet, chưa có CpaReviewRecord nào). */
export function findRowIndexKeyByRow(rowIndex: Record<string, number>, row: number): string | undefined {
  return Object.entries(rowIndex).find(([, r]) => r === row)?.[0];
}

/** Áp kết quả `pushRecordToSheet` vào 1 bản `rowIndex` — dùng chung cho mọi nơi gọi
 * `pushRecordToSheet` để tránh lặp lại logic merge/xoá legacy key. */
function applyRowIndexResult(
  rowIndex: Record<string, number>,
  result: { cacheKey: string; row: number; removeLegacyKey?: string } | null
): Record<string, number> {
  if (!result) return rowIndex;
  const next = { ...rowIndex, [result.cacheKey]: result.row };
  if (result.removeLegacyKey) delete next[result.removeLegacyKey];
  return next;
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
    if (result) {
      await saveCpaReviewSheetConfigMap({
        ...map,
        [record.month]: { ...sheetConfig, rowIndex: applyRowIndexResult(sheetConfig.rowIndex, result) },
      });
    }
  } catch (err) {
    console.error("syncRecordToCpaReviewSheet thất bại (bỏ qua, không ảnh hưởng response chính):", err);
  }
}

/** Xoá THẬT dòng tương ứng trên Sheet khi 1 record bị xoá trong app (thêm 2026-08-15, thay
 * cho hành vi cũ chỉ xoá giá trị/để lại dòng trống — yêu cầu "nên delete luôn row đó, không
 * phải xóa dữ liệu") — dùng `deleteDimension` để xoá hẳn dòng, các dòng phía dưới tự dịch
 * lên 1. QUAN TRỌNG: sau khi dòng thật sự dịch chuyển trên Sheet, MỌI entry khác trong
 * `rowIndex` có số dòng LỚN HƠN dòng vừa xoá đều phải giảm đi 1 để khớp lại vị trí thật —
 * nếu bỏ sót bước này, mọi dòng phía dưới dòng vừa xoá sẽ bị ghi/đọc NHẦM sang dòng kế bên
 * (lệch 1 dòng) ở lần đồng bộ tiếp theo. */
export async function deleteRecordRowFromCpaReviewSheet(record: CpaReviewRecord): Promise<void> {
  if (!isServiceAccountConfigured()) return;
  // SSN giờ KHÔNG còn bắt buộc (thêm 2026-08-31, xem mục 4.47 deployment-database-sync.md) —
  // record hợp lệ có thể chỉ có Name/Phone/... không có SSN. Trước đây hàm này `return` sớm
  // nếu thiếu SSN (bug thật gặp production: "xoá trên phần mềm vẫn chưa xoá trên Sheet"), dù
  // `rowIndex[record.id]` (định danh CHÍNH theo số dòng, không phụ thuộc SSN) vẫn đủ để xoá
  // đúng dòng. SSN giờ chỉ còn dùng làm fallback tra cứu khi CHƯA từng cache theo id.
  const ssn = recordSsn(record);

  try {
    const map = await getCpaReviewSheetConfigMap();
    const sheetConfig = map[record.month];
    if (!sheetConfig?.sheetId) return;
    const targetRow = sheetConfig.rowIndex[record.id] ?? (ssn ? sheetConfig.rowIndex[ssn] : undefined);
    if (!targetRow) return;
    const sheets = getServiceAccountSheetsClient();

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetConfig.sheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: Number(sheetConfig.gid),
                dimension: "ROWS",
                startIndex: targetRow - 1, // 0-based, inclusive
                endIndex: targetRow, // 0-based, exclusive
              },
            },
          },
        ],
      },
    });

    // Xoá entry của record vừa xoá, đồng thời dịch lại (-1) mọi entry có row > targetRow —
    // khớp đúng việc các dòng phía dưới đã tự dịch lên sau deleteDimension.
    const nextRowIndex: Record<string, number> = {};
    for (const [key, row] of Object.entries(sheetConfig.rowIndex)) {
      if (key === record.id || key === ssn) continue;
      nextRowIndex[key] = row > targetRow ? row - 1 : row;
    }
    await saveCpaReviewSheetConfigMap({ ...map, [record.month]: { ...sheetConfig, rowIndex: nextRowIndex } });
  } catch (err) {
    console.error("deleteRecordRowFromCpaReviewSheet thất bại (bỏ qua, không ảnh hưởng response chính):", err);
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
    if (result) {
      current = { ...current, rowIndex: applyRowIndexResult(current.rowIndex, result) };
    }
  }
  if (current !== sheetConfig) {
    await saveCpaReviewSheetConfigMap({ ...map, [month]: current });
  }
  return pushed;
}

export { mapSheetsError };
