import { google } from "googleapis";
import { prisma } from "./prisma";
import { getOAuthSheetsClient, throwIfGoogleAuthExpired, GoogleAuthExpiredError, ensureRowExists, writeCells, mapSheetsError, type CellWrite } from "./google-sheets";
import { letterFor } from "./cpa-review-sheet-columns";
import { resolveTabNameFromGid, ensureSheetGridSize, SheetNotAccessibleError } from "./cpa-review-sheet-sync";
import { getProcessorReportTasks, recomputeAndPushProcessorReportSummary } from "./processor-report-sheet-sync";
import type { OwnProcessorReportSheetConfig, OwnProcessorReportSheetConfigMap, ProcessorReportTaskDef } from "./types";

/** Sheet RIÊNG của 1 Processor cho bảng cá nhân (task x từng ngày), layout CỐ ĐỊNH (không cần
 * rowIndex/taskRowMap dò như CPA Review/bảng Leader): dòng = 2 + thứ tự task, cột = ngày
 * trong tháng (cột B = ngày 1). Header (dòng 1) = "Tasks" + số ngày. Xem
 * User.ownProcessorReportSheetConfig.
 *
 * Auth: OAuth2 THEO TỪNG USER (User.googleRefreshToken, dùng CHUNG token với tính năng "Send
 * to Google Sheet" có sẵn — KHÔNG phải Service Account như CPA Review/bảng Leader. Lý do đổi
 * (2026-09-02, sau khi thử Service Account trước đó): Sheet cá nhân của Processor có thể bị
 * khoá chia sẻ (chỉ đúng email chủ sở hữu mới sửa được, tổ chức không cho mời thêm Editor
 * ngoài), nên không thể yêu cầu họ share quyền cho email Service Account. OAuth ghi bằng CHÍNH
 * danh nghĩa tài khoản Google của họ (vốn đã có quyền Editor sẵn trên Sheet của mình) nên
 * không cần bước share nào cả. Chiều Sheet→App (Apps Script) HOÀN TOÀN không đổi — Apps Script
 * luôn chạy dưới quyền chính chủ Sheet, không liên quan gì tới cách App ghi ngược lại. */

const HEADER_ROW = 1;
const FIRST_DATA_ROW = 2;
const TASK_LABEL_COL = 0; // cột A
/** Cột B..H (0-based index 1-7) KHÔNG do app quản lý — theo yêu cầu người dùng
 * (2026-09-02), Sheet cá nhân của Processor có sẵn các cột khác ở khu vực đó (template
 * riêng của họ, ngoài phạm vi app) — app CHỈ đọc/ghi cột ngày bắt đầu từ cột I (0-based
 * index 8) trở đi. Cột ngày d (1-based) -> spreadsheet column index = DAY_COL_OFFSET + d. */
export const DAY_COL_OFFSET = 7;

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

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

/** Ghi TOÀN BỘ layout (header ngày + nhãn task + giá trị hiện có) — dùng lúc connect/resync. */
async function writeOwnReportLayout(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string,
  tabName: string,
  month: string,
  tasks: ProcessorReportTaskDef[],
  entryByKey: Map<string, number>
): Promise<void> {
  const days = daysInMonth(month);
  const orderedTasks = [...tasks].sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order);
  const firstDayCol = DAY_COL_OFFSET + 1;
  const lastDayCol = DAY_COL_OFFSET + days;
  const totalCol = lastDayCol + 1;

  const headerCells: CellWrite[] = [{ column: letterFor(TASK_LABEL_COL), value: "Tasks" }];
  for (let d = 1; d <= days; d++) headerCells.push({ column: letterFor(DAY_COL_OFFSET + d), value: d });
  headerCells.push({ column: letterFor(totalCol), value: "TOTAL" });
  await writeCells(sheets, sheetId, tabName, HEADER_ROW, headerCells);

  for (let i = 0; i < orderedTasks.length; i++) {
    const task = orderedTasks[i];
    const row = FIRST_DATA_ROW + i;
    const cells: CellWrite[] = [{ column: letterFor(TASK_LABEL_COL), value: task.label }];
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      const value = entryByKey.get(`${task.id}:${date}`) ?? 0;
      if (value !== 0) cells.push({ column: letterFor(DAY_COL_OFFSET + d), value });
    }
    cells.push({
      column: letterFor(totalCol),
      value: `=SUM(${letterFor(firstDayCol)}${row}:${letterFor(lastDayCol)}${row})`,
      isFormula: true,
    });
    await writeCells(sheets, sheetId, tabName, row, cells);
  }
}

/** Kích thước tối thiểu tab cần có — nhỏ hơn nhiều so với CPA Review (chỉ ~25-30 task x
 * 31 ngày), nhưng vẫn có thể vượt mặc định 26 cột (Z) nếu tháng đủ 31 ngày (cần tới cột AF). */
function minGridFor(taskCount: number, days: number): { rows: number; cols: number } {
  return { rows: FIRST_DATA_ROW + taskCount, cols: DAY_COL_OFFSET + days + 2 };
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
    const grid = minGridFor(tasks.length, daysInMonth(month));
    await ensureSheetGridSize(sheets, sheetId, gid, grid.rows, grid.cols);
    const entryByKey = new Map(entries.map((e) => [`${e.taskId}:${e.date}`, e.value]));
    await writeOwnReportLayout(sheets, sheetId, tabName, month, tasks, entryByKey);

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
    const grid = minGridFor(tasks.length, daysInMonth(month));
    await ensureSheetGridSize(sheets, config.sheetId, config.gid, grid.rows, grid.cols);
    const entryByKey = new Map(entries.map((e) => [`${e.taskId}:${e.date}`, e.value]));
    await writeOwnReportLayout(sheets, config.sheetId, config.tabName, month, tasks, entryByKey);
  } catch (err) {
    throwIfGoogleAuthExpired(err);
    throw err;
  }
}

/** Đẩy đúng 1 ô (task, ngày) lên Sheet riêng của user — dùng mỗi khi 1 ProcessorReportEntry
 * được lưu (xem after() trong POST/PATCH /api/processor-report/entries). Bỏ qua im lặng nếu
 * chưa kết nối Google/tháng chưa kết nối Sheet/task không còn tồn tại — không throw, không
 * chặn response chính (cùng nguyên tắc best-effort với pushProcessorReportCell của bảng
 * Leader). Token hết hạn/bị thu hồi -> tự xoá googleRefreshToken (giống send-to-sheet route)
 * để lần kết nối/gửi tiếp theo phát hiện đúng "chưa kết nối" thay vì thử lại token đã chết. */
export async function pushOwnReportCell(userId: string, month: string, taskId: string, date: string, value: number): Promise<void> {
  try {
    const map = await getOwnReportSheetConfigMap(userId);
    const config = map[month];
    if (!config?.sheetId) return;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { googleRefreshToken: true } });
    if (!user?.googleRefreshToken) return;
    const tasks = await getProcessorReportTasks();
    const orderedTasks = [...tasks].sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order);
    const taskIndex = orderedTasks.findIndex((t) => t.id === taskId);
    if (taskIndex < 0) return;
    const day = Number(date.slice(8, 10));
    if (!Number.isFinite(day) || day < 1) return;
    const row = FIRST_DATA_ROW + taskIndex;

    const sheets = getOAuthSheetsClient(user.googleRefreshToken);
    await ensureRowExists(sheets, config.sheetId, config.tabName, row);
    await writeCells(sheets, config.sheetId, config.tabName, row, [{ column: letterFor(DAY_COL_OFFSET + day), value }]);
  } catch (err) {
    if (err instanceof GoogleAuthExpiredError) {
      await prisma.user.update({ where: { id: userId }, data: { googleRefreshToken: null } }).catch(() => {});
    }
    console.error("pushOwnReportCell thất bại (bỏ qua, không ảnh hưởng response chính):", err);
  }
}

/** Xử lý 1 lô ô đã sửa từ Sheet (webhook) — mỗi phần tử { row, col, rawValue }, row/col LUÔN
 * xác định được (task, ngày) TRỰC TIẾP qua vị trí (không cần dò business key như CPA Review)
 * vì layout cố định. "App luôn thắng": bỏ qua nếu entry vừa được app ghi trong vòng grace
 * window (tránh vòng lặp App ghi -> đẩy Sheet -> Sheet echo -> webhook ghi lại -> đẩy Sheet...
 * — cùng nguyên tắc CPA Review, xem deployment-database-sync.md mục 4.22). Trả về số ô đã áp
 * dụng thành công. */
const APP_WINS_GRACE_MS = 5000;

export async function applyOwnReportSheetCells(
  userId: string,
  month: string,
  cells: Array<{ row: number; col: number; rawValue: string }>
): Promise<number> {
  const tasks = await getProcessorReportTasks();
  const orderedTasks = [...tasks].sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order);
  const days = daysInMonth(month);
  let applied = 0;

  for (const cell of cells) {
    const day = cell.col - DAY_COL_OFFSET;
    if (cell.row < FIRST_DATA_ROW || day < 1 || day > days) continue;
    const task = orderedTasks[cell.row - FIRST_DATA_ROW];
    if (!task) continue;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const raw = cell.rawValue.trim();
    const value = raw === "" ? 0 : Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;

    const existing = await prisma.processorReportEntry.findUnique({
      where: { userId_taskId_date: { userId, taskId: task.id, date } },
    });
    if (existing && Date.now() - existing.updatedAt.getTime() < APP_WINS_GRACE_MS) continue;

    await prisma.processorReportEntry.upsert({
      where: { userId_taskId_date: { userId, taskId: task.id, date } },
      create: { userId, taskId: task.id, date, value },
      update: { value },
    });
    await recomputeAndPushProcessorReportSummary(userId, task.id, month);
    applied += 1;
  }
  return applied;
}

export { SheetNotAccessibleError, mapSheetsError };
