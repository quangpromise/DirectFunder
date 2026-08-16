import { google } from "googleapis";
import { prisma } from "./prisma";
import { getServiceAccountSheetsClient, isServiceAccountConfigured } from "./google-service-account";
import { ensureRowExists, writeCells, mapSheetsError, type CellWrite } from "./google-sheets";
import { ensureSheetGridSize } from "./cpa-review-sheet-sync";
import { letterFor } from "./cpa-review-sheet-columns";
import { DEFAULT_PROCESSOR_REPORT_TASKS } from "./rbac";
import type { ProcessorReportSheetConfig, ProcessorReportSheetConfigMap, ProcessorReportTaskDef, User } from "./types";

/** Danh sách "task" (hàng) hiện tại — đọc từ AppConfig.processorReportTasks, fallback
 * DEFAULT_PROCESSOR_REPORT_TASKS khi Admin/Processor Leader chưa từng tuỳ chỉnh. */
export async function getProcessorReportTasks(): Promise<ProcessorReportTaskDef[]> {
  const appConfig = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const tasks = appConfig?.processorReportTasks as unknown as ProcessorReportTaskDef[] | null;
  return tasks && tasks.length > 0 ? tasks : DEFAULT_PROCESSOR_REPORT_TASKS;
}

export async function getProcessorReportSheetConfigMap(): Promise<ProcessorReportSheetConfigMap> {
  const appConfig = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  return (appConfig?.processorReportSheetConfig as unknown as ProcessorReportSheetConfigMap | null) ?? {};
}

export async function saveProcessorReportSheetConfigMap(map: ProcessorReportSheetConfigMap): Promise<void> {
  await prisma.appConfig.update({ where: { id: "singleton" }, data: { processorReportSheetConfig: map as unknown as object } });
}

/** Tìm entry (month + config) khớp đúng `webhookSecret` — mỗi tháng 1 secret riêng, giống
 * cơ chế findCpaReviewConfigBySecret. */
export function findProcessorReportConfigBySecret(
  map: ProcessorReportSheetConfigMap,
  secret: string
): { month: string; config: ProcessorReportSheetConfig } | null {
  for (const [month, config] of Object.entries(map)) {
    if (config?.webhookSecret === secret) return { month, config };
  }
  return null;
}

async function getProcessorUsers(): Promise<User[]> {
  const users = await prisma.user.findMany({ where: { role: "processor" }, orderBy: { name: "asc" } });
  return users as unknown as User[];
}

/** Tra tên tab thật từ gid — batchUpdate/values.get cần TÊN tab, không nhận gid trực tiếp. */
export async function resolveTabNameFromGid(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  gid: string
): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" });
  const match = meta.data.sheets?.find((s) => String(s.properties?.sheetId ?? "") === gid);
  if (!match?.properties?.title) throw new Error(`Không tìm thấy tab (gid=${gid}) trên Sheet này.`);
  return match.properties.title;
}

const TOTAL_COL_LABEL = "TOTAL";

/** Bố cục cột: 0 = tên task, 1..N = từng Processor (theo thứ tự users), N+1 = TOTAL. */
function buildColumnPlan(processors: User[]): { userColumnMap: Record<string, number>; totalCol: number } {
  const userColumnMap: Record<string, number> = {};
  processors.forEach((u, i) => {
    userColumnMap[u.id] = i + 1;
  });
  return { userColumnMap, totalCol: processors.length + 1 };
}

/** Ghi TOÀN BỘ layout (header + section header formulas + hàng task) lên Sheet — dùng lúc
 * connect lần đầu và lúc "Đồng bộ lại toàn bộ" (resync). Section header/TOTAL đều là công
 * thức Sheets tự tính (`=SUM(...)`) — app chỉ cần ghi số RAW ở đúng ô (task, processor), Sheet
 * tự cộng dồn, khác cách "App tự tính rồi ghi cả 2 nơi" (đơn giản, tránh lệch số khi đè). */
async function writeProcessorReportLayout(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string,
  gid: string,
  tabName: string,
  tasks: ProcessorReportTaskDef[],
  processors: User[],
  summaryByKey: Map<string, number>
): Promise<{ taskRowMap: Record<string, number>; userColumnMap: Record<string, number> }> {
  const { userColumnMap, totalCol } = buildColumnPlan(processors);
  const lastColLetter = letterFor(totalCol);

  const sections = new Map<string, ProcessorReportTaskDef[]>();
  for (const task of [...tasks].sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order)) {
    const list = sections.get(task.sectionId) ?? [];
    list.push(task);
    sections.set(task.sectionId, list);
  }

  const minRows = 2 + tasks.length + sections.size;
  await ensureSheetGridSize(sheets, sheetId, gid, minRows, totalCol + 1);

  const taskRowMap: Record<string, number> = {};
  let row = 2; // hàng 1 = header
  const headerCells: CellWrite[] = [{ column: "A", value: "Tasks" }];
  processors.forEach((u, i) => headerCells.push({ column: letterFor(i + 1), value: u.name }));
  headerCells.push({ column: lastColLetter, value: TOTAL_COL_LABEL });
  await writeCells(sheets, sheetId, tabName, 1, headerCells);

  for (const [, sectionTasks] of sections) {
    const sectionRow = row;
    row += 1;
    const firstTaskRow = row;
    for (const task of sectionTasks) {
      taskRowMap[task.id] = row;
      const cells: CellWrite[] = [{ column: "A", value: task.label }];
      processors.forEach((u) => {
        const value = summaryByKey.get(`${task.id}:${u.id}`) ?? 0;
        cells.push({ column: letterFor(userColumnMap[u.id]), value });
      });
      cells.push({ column: lastColLetter, value: `=SUM(B${row}:${letterFor(totalCol - 1)}${row})`, isFormula: true });
      await writeCells(sheets, sheetId, tabName, row, cells);
      row += 1;
    }
    const lastTaskRow = row - 1;
    const sectionCells: CellWrite[] = [{ column: "A", value: sectionTasks[0].sectionLabel }];
    processors.forEach((u) => {
      const col = letterFor(userColumnMap[u.id]);
      sectionCells.push({ column: col, value: `=SUM(${col}${firstTaskRow}:${col}${lastTaskRow})`, isFormula: true });
    });
    sectionCells.push({ column: lastColLetter, value: `=SUM(B${sectionRow}:${letterFor(totalCol - 1)}${sectionRow})`, isFormula: true });
    await writeCells(sheets, sheetId, tabName, sectionRow, sectionCells);
  }

  return { taskRowMap, userColumnMap };
}

/** Kết nối Sheet mới cho 1 tháng — ghi toàn bộ layout với số liệu hiện có, lưu lại
 * taskRowMap/userColumnMap để các lần đẩy sau chỉ cần ghi đúng 1 ô. */
export async function connectProcessorReportSheet(
  sheetId: string,
  gid: string,
  month: string,
  connectedByUserId: string,
  webhookSecret: string
): Promise<ProcessorReportSheetConfig> {
  const sheets = getServiceAccountSheetsClient();
  const tabName = await resolveTabNameFromGid(sheets, sheetId, gid);
  const [tasks, processors, summaries] = await Promise.all([
    getProcessorReportTasks(),
    getProcessorUsers(),
    prisma.processorReportMonthlySummary.findMany({ where: { month } }),
  ]);
  const summaryByKey = new Map(summaries.map((s) => [`${s.taskId}:${s.userId}`, s.value]));

  const { taskRowMap, userColumnMap } = await writeProcessorReportLayout(sheets, sheetId, gid, tabName, tasks, processors, summaryByKey);

  return { sheetId, gid, tabName, taskRowMap, userColumnMap, webhookSecret, connectedAt: new Date().toISOString(), connectedByUserId };
}

/** Đẩy lại TOÀN BỘ layout + số liệu tháng đó — dùng cho nút "Đồng bộ lại toàn bộ" (vd sau khi
 * thêm/xoá task, hoặc có Processor mới cần thêm cột). */
export async function resyncProcessorReportSheet(month: string): Promise<number> {
  const map = await getProcessorReportSheetConfigMap();
  const config = map[month];
  if (!config?.sheetId) throw new Error("Chưa kết nối Sheet cho tháng này");

  const sheets = getServiceAccountSheetsClient();
  const [tasks, processors, summaries] = await Promise.all([
    getProcessorReportTasks(),
    getProcessorUsers(),
    prisma.processorReportMonthlySummary.findMany({ where: { month } }),
  ]);
  const summaryByKey = new Map(summaries.map((s) => [`${s.taskId}:${s.userId}`, s.value]));

  const { taskRowMap, userColumnMap } = await writeProcessorReportLayout(
    sheets,
    config.sheetId,
    config.gid,
    config.tabName,
    tasks,
    processors,
    summaryByKey
  );
  await saveProcessorReportSheetConfigMap({ ...map, [month]: { ...config, taskRowMap, userColumnMap } });
  return summaries.length;
}

/** Đẩy đúng 1 ô (task, processor) lên Sheet — dùng mỗi khi ProcessorReportMonthlySummary của
 * ô đó được tính lại (xem recomputeAndPushProcessorReportSummary). Bỏ qua im lặng nếu tháng
 * chưa kết nối Sheet, hoặc task/user chưa có mặt trong taskRowMap/userColumnMap (vd Processor
 * mới chưa từng "Đồng bộ lại toàn bộ") — không throw, không chặn response chính.
 */
export async function pushProcessorReportCell(month: string, taskId: string, userId: string, value: number): Promise<void> {
  if (!isServiceAccountConfigured()) return;
  try {
    const map = await getProcessorReportSheetConfigMap();
    const config = map[month];
    if (!config?.sheetId) return;
    const row = config.taskRowMap[taskId];
    const col = config.userColumnMap[userId];
    if (!row || col === undefined) return;

    const sheets = getServiceAccountSheetsClient();
    await ensureRowExists(sheets, config.sheetId, config.tabName, row);
    await writeCells(sheets, config.sheetId, config.tabName, row, [{ column: letterFor(col), value }]);
  } catch (err) {
    console.error("pushProcessorReportCell thất bại (bỏ qua, không ảnh hưởng response chính):", err);
  }
}

/** Tính lại đúng 1 ô cache (tháng, task, user) từ ProcessorReportEntry thật, rồi đẩy lên
 * Sheet nếu tháng đó đã kết nối — gọi từ `after()` mỗi khi 1 entry được lưu. */
export async function recomputeAndPushProcessorReportSummary(userId: string, taskId: string, month: string): Promise<void> {
  const agg = await prisma.processorReportEntry.aggregate({
    where: { userId, taskId, date: { startsWith: month } },
    _sum: { value: true },
  });
  const value = agg._sum.value ?? 0;
  await prisma.processorReportMonthlySummary.upsert({
    where: { month_taskId_userId: { month, taskId, userId } },
    create: { month, taskId, userId, value },
    update: { value },
  });
  await pushProcessorReportCell(month, taskId, userId, value);
}

export { mapSheetsError };
