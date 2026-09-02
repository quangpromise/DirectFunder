import type { ProcessorReportTaskDef } from "./types";

/** Cột A-H (0-based index 0-7) trên Sheet CÁ NHÂN của Processor KHÔNG do app quản lý — template
 * thật của Processor (xem deployment-database-sync.md mục 4.48, ảnh chụp thật 2026-09-02) đã tự
 * dùng vùng này cho việc khác (số thứ tự section ở cột B, nhãn task ở cột C, cột "Total" riêng ở
 * cột G...). App CHỈ đọc/ghi cột ngày bắt đầu từ cột I (0-based index 8) trở đi — không viết bất
 * cứ gì (kể cả header ngày/nhãn) vào vùng A-H, chỉ đồng bộ giá trị số ở đúng ô (task, ngày). */
export const DAY_COL_OFFSET = 7;

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Danh sách ngày trong tháng kèm chỉ số tuần (tuần THỨ HAI-CHỦ NHẬT, kiểu ISO) — DÙNG CHUNG
 * giữa UI (`ProcessorSelfReportGrid`) và Sheet sync, đảm bảo cách xen kẽ cột NGÀY/TUẦN khớp
 * CHÍNH XÁC giữa app và Google Sheet thật của Processor. Đổi từ "Chủ nhật-Thứ 7" sang "Thứ
 * Hai-Chủ nhật" (2026-09-02, sau khi đối chiếu ảnh chụp template thật: tuần 1 tháng 9/2026 —
 * ngày 1 rơi vào Thứ Ba — gồm ĐỦ 6 ngày (01-06/09, kết thúc Chủ nhật) trước cột "W1", không
 * phải 5 ngày như quy ước Chủ nhật-Thứ 7 cũ sẽ cho ra). */
export function buildMonthDays(month: string): { date: string; day: number; weekIndex: number }[] {
  const [y, m] = month.split("-").map(Number);
  const total = daysInMonth(month);
  const firstWeekdaySunBased = new Date(y, m - 1, 1).getDay(); // 0 = Chủ nhật (JS getDay() gốc)
  const firstWeekday = (firstWeekdaySunBased + 6) % 7; // quy đổi về 0 = Thứ Hai
  const days: { date: string; day: number; weekIndex: number }[] = [];
  for (let day = 1; day <= total; day++) {
    const weekIndex = Math.floor((day - 1 + firstWeekday) / 7) + 1;
    days.push({ date: `${month}-${String(day).padStart(2, "0")}`, day, weekIndex });
  }
  return days;
}

export interface ReportDayColumn {
  kind: "day";
  date: string;
  /** Cột spreadsheet 0-based (A=0). */
  col: number;
}
export interface ReportWeekColumn {
  kind: "week";
  weekIndex: number;
  col: number;
}
export type ReportColumnEntry = ReportDayColumn | ReportWeekColumn;

/** Cột spreadsheet (0-based) cho từng NGÀY/cột TỔNG TUẦN trong tháng, bắt đầu từ cột I
 * (`DAY_COL_OFFSET + 1`) — xen kẽ hết 1 tuần thì có 1 cột tổng tuần, giống hệt thứ tự cột
 * `ProcessorSelfReportGrid` hiển thị trong app (xem `columns` trong `for-processor-dialog.tsx`).
 * Khớp đúng với template thật: I..N = 6 ngày đầu tháng, O = "W1", P..V = 7 ngày tuần 2, W =
 * "W2", ... (số ngày mỗi tuần phụ thuộc thứ của ngày 1 đầu tháng, tính lại mỗi tháng). */
export function buildReportColumns(month: string): ReportColumnEntry[] {
  const days = buildMonthDays(month);
  const weekIndexes = Array.from(new Set(days.map((d) => d.weekIndex)));
  const entries: ReportColumnEntry[] = [];
  let col = DAY_COL_OFFSET + 1;
  for (const w of weekIndexes) {
    for (const d of days.filter((x) => x.weekIndex === w)) {
      entries.push({ kind: "day", date: d.date, col });
      col += 1;
    }
    entries.push({ kind: "week", weekIndex: w, col });
    col += 1;
  }
  return entries;
}

export interface ReportHeaderRow {
  kind: "header";
  sectionId: string;
}
export interface ReportTaskRow {
  kind: "task";
  taskId: string;
}
export type ReportRowEntry = ReportHeaderRow | ReportTaskRow;

/** Danh sách DÒNG theo đúng thứ tự trên template thật của Processor: 1 dòng "section header"
 * (không sửa được, không map tới taskId nào) rồi lần lượt các dòng task của section đó, lặp lại
 * cho từng section theo `sectionOrder` (xem deployment-database-sync.md mục 4.48, bổ sung
 * 2026-09-02 sau khi phát hiện template thật có dòng section-header xen giữa các nhóm task mà
 * thiết kế ban đầu — chỉ "FIRST_DATA_ROW + task index" phẳng — bỏ sót, gây lệch dòng). Dòng vật
 * lý trên Sheet = `FIRST_DATA_ROW (2) + index` trong mảng trả về. */
export function buildReportRows(tasks: ProcessorReportTaskDef[]): ReportRowEntry[] {
  const sorted = [...tasks].sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order);
  const entries: ReportRowEntry[] = [];
  let currentSection: string | null = null;
  for (const task of sorted) {
    if (task.sectionId !== currentSection) {
      entries.push({ kind: "header", sectionId: task.sectionId });
      currentSection = task.sectionId;
    }
    entries.push({ kind: "task", taskId: task.id });
  }
  return entries;
}
