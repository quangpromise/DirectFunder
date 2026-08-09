/** Helper dùng chung cho mọi Dashboard báo cáo (Hồ sơ, Order) — tính khoảng ngày theo
 * giờ Phoenix (múi giờ nghiệp vụ của công ty) cho 4 chế độ xem: Hôm nay/Tháng/Năm/Tùy
 * chỉnh, và khoảng SO SÁNH liền trước (để tính % tăng trưởng kiểu MoM/YoY). */

export type ReportPeriod = "today" | "month" | "year" | "custom";

/** Dạng "yyyy-mm-dd" theo giờ Phoenix — khớp value <input type="date">. */
export function toPhoenixDateStr(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "yyyy-mm" hiện tại theo giờ Phoenix — khớp value <input type="month">. */
export function currentPhoenixMonth(): string {
  return toPhoenixDateStr(new Date()).slice(0, 7);
}

export function currentPhoenixYear(): number {
  return Number(toPhoenixDateStr(new Date()).slice(0, 4));
}

/** Số ngày trong tháng (yyyy-mm), không phụ thuộc múi giờ trình duyệt. */
function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

export function monthRange(yyyyMm: string): { start: string; end: string } {
  const [y, m] = yyyyMm.split("-").map(Number);
  const last = daysInMonth(y, m);
  return { start: `${yyyyMm}-01`, end: `${yyyyMm}-${String(last).padStart(2, "0")}` };
}

export function yearRange(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function previousMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Khoảng liền trước của cùng độ dài (tính bằng ngày) ngay trước "start" — dùng cho chế
 * độ Hôm nay (so với hôm qua) và Tùy chỉnh (so với khoảng liền trước cùng số ngày). */
function precedingRangeOfSameLength(start: string, end: string): { start: string; end: string } {
  const startD = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  const days = Math.round((endD.getTime() - startD.getTime()) / 86400000) + 1;
  const prevEndD = new Date(startD.getTime() - 86400000);
  const prevStartD = new Date(prevEndD.getTime() - (days - 1) * 86400000);
  return { start: prevStartD.toISOString().slice(0, 10), end: prevEndD.toISOString().slice(0, 10) };
}

/** Tính khoảng hiện tại + khoảng so sánh liền trước, dùng chung cho mọi Dashboard. */
export function resolveReportRange(opts: {
  period: ReportPeriod;
  month: string; // "yyyy-mm", dùng khi period === "month"
  year: number; // dùng khi period === "year"
  customFrom: string;
  customTo: string;
}): { start: string; end: string; prevStart: string; prevEnd: string } {
  const { period, month, year, customFrom, customTo } = opts;
  if (period === "today") {
    const today = toPhoenixDateStr(new Date());
    const prev = precedingRangeOfSameLength(today, today);
    return { start: today, end: today, prevStart: prev.start, prevEnd: prev.end };
  }
  if (period === "month") {
    const { start, end } = monthRange(month);
    const prev = monthRange(previousMonth(month));
    return { start, end, prevStart: prev.start, prevEnd: prev.end };
  }
  if (period === "year") {
    const { start, end } = yearRange(year);
    const prev = yearRange(year - 1);
    return { start, end, prevStart: prev.start, prevEnd: prev.end };
  }
  // custom: người dùng có thể chọn "Từ ngày" trễ hơn "Đến ngày" — tự hoán đổi lại.
  const [start, end] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
  const prev = precedingRangeOfSameLength(start, end);
  return { start, end, prevStart: prev.start, prevEnd: prev.end };
}

/** % tăng trưởng so với kỳ trước — null khi không có cơ sở so sánh (kỳ trước = 0 và kỳ
 * này cũng = 0), Infinity khi kỳ trước = 0 nhưng kỳ này > 0 (tăng trưởng "mới"). */
export function growthPercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? null : Infinity;
  return ((current - previous) / previous) * 100;
}
