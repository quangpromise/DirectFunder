/** Khung giờ trong ngày dùng cho lời chào đầu trang Hồ sơ — tính theo giờ Phoenix, Arizona
 * (America/Phoenix, MST) để khớp với PhoenixClock ở top-nav và toPhoenixDateStr trong
 * report-period.ts, không phụ thuộc múi giờ máy người dùng. */
export type GreetingPeriod = "morning" | "afternoon" | "evening" | "night";

export function greetingPeriodFor(date: Date): GreetingPeriod {
  const hour = Number(
    date.toLocaleString("en-US", { timeZone: "America/Phoenix", hour: "2-digit", hour12: false })
  );
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}
