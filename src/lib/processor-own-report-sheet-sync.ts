import { google } from "googleapis";
import { prisma } from "./prisma";
import { getOAuthSheetsClient, throwIfGoogleAuthExpired, GoogleAuthExpiredError, ensureRowExists, writeCells, mapSheetsError, type CellWrite } from "./google-sheets";
import { letterFor } from "./cpa-review-sheet-columns";
import { resolveTabNameFromGid, ensureSheetGridSize, SheetNotAccessibleError } from "./cpa-review-sheet-sync";
import { getProcessorReportTasks, recomputeAndPushProcessorReportSummary } from "./processor-report-sheet-sync";
import { daysInMonth, buildReportColumns, buildReportRows, DAY_COL_OFFSET } from "./processor-report-layout";
import type { OwnProcessorReportSheetConfig, OwnProcessorReportSheetConfigMap } from "./types";

/** Sheet RIÊNG của 1 Processor cho bảng cá nhân (task x từng ngày) — layout khớp ĐÚNG template
 * thật Processor tự tạo (xem deployment-database-sync.md mục 4.48, ảnh chụp thật 2026-09-02):
 * cột A-H (nhãn section/task, cột "Total" riêng...) và HEADER (dòng 1, dòng section) đều KHÔNG
 * do app quản lý — app CHỈ đọc/ghi giá trị số ở đúng ô (task, ngày) từ cột I trở đi, dùng
 * `buildReportRows`/`buildReportColumns` (`processor-report-layout.ts`) để tính đúng dòng/cột
 * vật lý (có xen dòng "section header" và cột "tổng tuần" giữa các ngày). Xem
 * `User.ownProcessorReportSheetConfig`.
 *
 * Auth: OAuth2 THEO TỪNG USER (User.googleRefreshToken, dùng CHUNG token với tính năng "Send
 * to Google Sheet" có sẵn — KHÔNG phải Service Account như CPA Review/bảng Leader. Lý do đổi
 * (2026-09-02, sau khi thử Service Account trước đó): Sheet cá nhân của Processor có thể bị
 * khoá chia sẻ (chỉ đúng email chủ sở hữu mới sửa được, tổ chức không cho mời thêm Editor
 * ngoài), nên không thể yêu cầu họ share quyền cho email Service Account. OAuth ghi bằng CHÍNH
 * danh nghĩa tài khoản Google của họ (vốn đã có quyền Editor sẵn trên Sheet của mình) nên
 * không cần bước share nào cả. Chiều Sheet→App (Apps Script) HOÀN TOÀN không đổi — Apps Script
 * luôn chạy dưới quyền chính chủ Sheet, không liên quan gì tới cách App ghi ngược lại. */

const FIRST_DATA_ROW = 2;

export async function getOwnReportSheetConfigMap(userId: string): Promise<OwnProcessorReportSheetConfigMap> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { ownProcessorReportSheetConfig: true } });
  return (user?.ownProcessorReportSheetConfig as unknown as OwnProcessorReportSheetConfigMap | null) ?? {};
}

export async function saveOwnReportSheetConfigMap(userId: string, map: OwnProcessorReportSheetConfigMap): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { ownProcessorReportSheetConfig: map as unknown as object } });
}

/** Dò user + tháng khớp đúng `webhookSecret` — quét TOÀN BỘ user (mỗi user tối đa vài tháng
 * kết nối, số lượng nhỏ nên chấp nhận quét thẳng, không cần index riêng). */
export async function findOwnReportConfigBySecret(
  secret: string
): Promise<{ userId: string; month: string; config: OwnProcessorReportSheetConfig } | null> {
  // Chỉ role processor mới có bảng cá nhân để kết nối — lọc trước ở DB (không lọc theo Json
  // null ở DB, vốn dễ lỗi/khác ngữ nghĩa giữa DB NULL và JSON null trong Prisma), số lượng
  // processor nhỏ nên quét thẳng trong JS chấp nhận được.
  const users = await prisma.user.findMany({
    where: { role: "processor" },
    select: { id: true, ownProcessorReportSheetConfig: true },
  });
  for (const u of users) {
    const map = (u.ownProcessorReportSheetConfig as unknown as OwnProcessorReportSheetConfigMap | null) ?? {};
    for (const [month, config] of Object.entries(map)) {
      if (config?.webhookSecret === secret) return { userId: u.id, month, config };
    }
  }
  return null;
}

/** Chỉ ghi GIÁ TRỊ SỐ hiện có vào đúng ô (task, ngày) — KHÔNG viết header/nhãn/công thức TOTAL
 * nào (những thứ đó thuộc template có sẵn của Processor, ngoài phạm vi app quản lý). Ô có giá
 * trị 0 bỏ qua (giữ nguyên bất kỳ nội dung nào Processor đã có sẵn ở ô đó thay vì ép về 0). */
async function writeOwnReportValues(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string,
  tabName: string,
  month: string,
  rows: ReturnType<typeof buildReportRows>,
  columns: ReturnType<typeof buildReportColumns>,
  entryByKey: Map<string, number>
): Promise<void> {
  const dayColByDate = new Map(columns.filter((c) => c.kind === "day").map((c) => [c.date, c.col]));

  for (let i = 0; i < rows.length; i++) {
    const rowEntry = rows[i];
    if (rowEntry.kind !== "task") continue;
    const row = FIRST_DATA_ROW + i;
    const cells: CellWrite[] = [];
    for (const [date, col] of dayColByDate) {
      const value = entryByKey.get(`${rowEntry.taskId}:${date}`) ?? 0;
      if (value !== 0) cells.push({ column: letterFor(col), value });
    }
    if (cells.length > 0) await writeCells(sheets, sheetId, tabName, row, cells);
  }
}

/** Kích thước tối thiểu tab cần có — nhỏ hơn nhiều so với CPA Review (~30 dòng gồm cả section
 * header x ~31 ngày + cột tổng tuần), nhưng vẫn có thể vượt mặc định 26 cột (Z) nếu tháng đủ 31
 * ngày (cần thêm ~5 cột tuần nữa). */
function minGridFor(rowCount: number, columns: ReturnType<typeof buildReportColumns>): { rows: number; cols: number } {
  const lastCol = columns.length > 0 ? columns[columns.length - 1].col : DAY_COL_OFFSET;
  return { rows: FIRST_DATA_ROW + rowCount, cols: lastCol + 1 };
}

/** `refreshToken` LUÔN do nơi gọi (route) tự kiểm tra/truyền vào — route trả 428
 * "GOOGLE_NOT_CONNECTED" ngay nếu user chưa từng kết nối Google, KHÔNG đi qua exception ở
 * đây (giữ đúng ý nghĩa GoogleAuthExpiredError = "đã từng kết nối nhưng token hết hạn/bị thu
 * hồi", khác "chưa từng kết nối" — cùng phân biệt với send-to-sheet route). */
export async function connectOwnReportSheet(
  userId: string,
  month: string,
  sheetId: string,
  gid: string,
  webhookSecret: string,
  refreshToken: string
): Promise<OwnProcessorReportSheetConfig> {
  const sheets = getOAuthSheetsClient(refreshToken);
  try {
    const tabName = await resolveTabNameFromGid(sheets, sheetId, gid);
    const [tasks, entries] = await Promise.all([
      getProcessorReportTasks(),
      prisma.processorReportEntry.findMany({ where: { userId, date: { startsWith: month } } }),
    ]);
    const rows = buildReportRows(tasks);
    const columns = buildReportColumns(month);
    const grid = minGridFor(rows.length, columns);
    await ensureSheetGridSize(sheets, sheetId, gid, grid.rows, grid.cols);
    const entryByKey = new Map(entries.map((e) => [`${e.taskId}:${e.date}`, e.value]));
    await writeOwnReportValues(sheets, sheetId, tabName, month, rows, columns, entryByKey);

    return { sheetId, gid, tabName, webhookSecret, connectedAt: new Date().toISOString() };
  } catch (err) {
    throwIfGoogleAuthExpired(err);
    throw err;
  }
}

export async function resyncOwnReportSheet(userId: string, month: string, refreshToken: string): Promise<void> {
  const map = await getOwnReportSheetConfigMap(userId);
  const config = map[month];
  if (!config?.sheetId) throw new Error("Chưa kết nối Sheet cho tháng này");

  const sheets = getOAuthSheetsClient(refreshToken);
  try {
    const [tasks, entries] = await Promise.all([
      getProcessorReportTasks(),
      prisma.processorReportEntry.findMany({ where: { userId, date: { startsWith: month } } }),
    ]);
    const rows = buildReportRows(tasks);
    const columns = buildReportColumns(month);
    const grid = minGridFor(rows.length, columns);
    await ensureSheetGridSize(sheets, config.sheetId, config.gid, grid.rows, grid.cols);
    const entryByKey = new Map(entries.map((e) => [`${e.taskId}:${e.date}`, e.value]));
    await writeOwnReportValues(sheets, config.sheetId, config.tabName, month, rows, columns, entryByKey);
  } catch (err) {
    throwIfGoogleAuthExpired(err);
    throw err;
  }
}

/** Đẩy đúng 1 ô (task, ngày) lên Sheet riêng của user — dùng mỗi khi 1 ProcessorReportEntry
 * được lưu (xem after() trong POST/PATCH /api/processor-report/entries). Bỏ qua im lặng nếu
 * chưa kết nối Google/tháng chưa kết nối Sheet/task hoặc ngày không xác định được vị trí trên
 * Sheet — không throw, không chặn response chính (cùng nguyên tắc best-effort với
 * pushProcessorReportCell của bảng Leader). Token hết hạn/bị thu hồi -> tự xoá
 * googleRefreshToken (giống send-to-sheet route) để lần kết nối/gửi tiếp theo phát hiện đúng
 * "chưa kết nối" thay vì thử lại token đã chết. */
export async function pushOwnReportCell(userId: string, month: string, taskId: string, date: string, value: number): Promise<void> {
  try {
    const map = await getOwnReportSheetConfigMap(userId);
    const config = map[month];
    if (!config?.sheetId) return;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { googleRefreshToken: true } });
    if (!user?.googleRefreshToken) return;

    const tasks = await getProcessorReportTasks();
    const rows = buildReportRows(tasks);
    const rowIndex = rows.findIndex((r) => r.kind === "task" && r.taskId === taskId);
    if (rowIndex < 0) return;
    const columns = buildReportColumns(month);
    const colEntry = columns.find((c) => c.kind === "day" && c.date === date);
    if (!colEntry) return;
    const row = FIRST_DATA_ROW + rowIndex;

    const sheets = getOAuthSheetsClient(user.googleRefreshToken);
    await ensureRowExists(sheets, config.sheetId, config.tabName, row);
    await writeCells(sheets, config.sheetId, config.tabName, row, [{ column: letterFor(colEntry.col), value }]);
  } catch (err) {
    if (err instanceof GoogleAuthExpiredError) {
      await prisma.user.update({ where: { id: userId }, data: { googleRefreshToken: null } }).catch(() => {});
    }
    console.error("pushOwnReportCell thất bại (bỏ qua, không ảnh hưởng response chính):", err);
  }
}

/** Xử lý 1 lô ô đã sửa từ Sheet (webhook) — mỗi phần tử { row, col, rawValue }. Dòng khớp
 * `buildReportRows` (bỏ qua dòng section-header/dòng ngoài phạm vi), cột khớp
 * `buildReportColumns` (bỏ qua cột tổng tuần/cột ngoài phạm vi tháng) — layout cố định nên xác
 * định (task, ngày) TRỰC TIẾP qua vị trí, không cần dò business key như CPA Review. "App luôn
 * thắng": bỏ qua nếu entry vừa được app ghi trong vòng grace window (tránh vòng lặp App ghi ->
 * đẩy Sheet -> Sheet echo -> webhook ghi lại -> đẩy Sheet... — cùng nguyên tắc CPA Review, xem
 * deployment-database-sync.md mục 4.22). Trả về số ô đã áp dụng thành công. */
const APP_WINS_GRACE_MS = 5000;

export async function applyOwnReportSheetCells(
  userId: string,
  month: string,
  cells: Array<{ row: number; col: number; rawValue: string }>
): Promise<number> {
  const tasks = await getProcessorReportTasks();
  const rows = buildReportRows(tasks);
  const columns = buildReportColumns(month);
  const dateByCol = new Map(columns.filter((c) => c.kind === "day").map((c) => [c.col, c.date]));
  let applied = 0;

  for (const cell of cells) {
    if (cell.row < FIRST_DATA_ROW) continue;
    const rowEntry = rows[cell.row - FIRST_DATA_ROW];
    if (!rowEntry || rowEntry.kind !== "task") continue; // dòng section-header hoặc ngoài phạm vi -> bỏ qua
    const date = dateByCol.get(cell.col);
    if (!date) continue; // cột tổng tuần hoặc ngoài phạm vi tháng -> bỏ qua

    const raw = cell.rawValue.trim();
    const value = raw === "" ? 0 : Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;

    const taskId = rowEntry.taskId;
    const existing = await prisma.processorReportEntry.findUnique({
      where: { userId_taskId_date: { userId, taskId, date } },
    });
    if (existing && Date.now() - existing.updatedAt.getTime() < APP_WINS_GRACE_MS) continue;

    await prisma.processorReportEntry.upsert({
      where: { userId_taskId_date: { userId, taskId, date } },
      create: { userId, taskId, date, value },
      update: { value },
    });
    await recomputeAndPushProcessorReportSummary(userId, taskId, month);
    applied += 1;
  }
  return applied;
}

export { daysInMonth, DAY_COL_OFFSET, SheetNotAccessibleError, mapSheetsError };
