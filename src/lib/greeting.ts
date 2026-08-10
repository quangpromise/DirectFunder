/** Khung giờ trong ngày dùng cho lời chào đầu trang Hồ sơ — tính theo giờ LOCAL của máy
 * người dùng (date.getHours() đọc giờ theo múi giờ hệ điều hành/trình duyệt đang chạy),
 * KHÔNG cố định theo 1 múi giờ hệ thống nào — khác PhoenixClock ở top-nav/toPhoenixDateStr
 * trong report-period.ts (những chỗ đó CỐ Ý cố định giờ Phoenix cho đồng bộ báo cáo, lời
 * chào thì nên đúng theo cảm nhận thời gian thật của người đang dùng app). */
export type GreetingPeriod = "morning" | "afternoon" | "evening" | "night";

export function greetingPeriodFor(date: Date): GreetingPeriod {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

/** Icon minh hoạ cho từng khung giờ trong dòng chào đầu trang Hồ sơ — sáng mặt trời lên,
 * chiều nắng gắt, tối hoàng hôn tắt nắng, khuya trăng lên. */
export function greetingEmoji(period: GreetingPeriod): string {
  switch (period) {
    case "morning":
      return "🌤️";
    case "afternoon":
      return "☀️";
    case "evening":
      return "🌇";
    case "night":
      return "🌙";
  }
}
