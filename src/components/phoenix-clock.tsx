"use client";

import { useEffect, useId, useState } from "react";
import { useLanguage } from "@/lib/i18n";

function formatPhoenix(date: Date, locale: string): { time: string; period: string; weekdayDate: string; fullDate: string; seconds: number } {
  // hour12: true để có AM/PM (locale vi-VN tự đổi thành "SA"/"CH" đúng quy ước, không cần tự
  // dịch tay) — tách riêng "period" (buổi) khỏi "time" bằng dateTimeFormat.formatToParts thay
  // vì cắt chuỗi bằng tay (toLocaleTimeString gộp chung "09:36 PM" khó tách chính xác giữa
  // các locale/trình duyệt khác nhau).
  const timeParts = new Intl.DateTimeFormat(locale, {
    timeZone: "America/Phoenix",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour = timeParts.find((p) => p.type === "hour")?.value ?? "";
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "";
  const period = timeParts.find((p) => p.type === "dayPeriod")?.value ?? "";

  const weekdayDate = date.toLocaleDateString(locale, {
    timeZone: "America/Phoenix",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const fullDate = date.toLocaleDateString(locale, {
    timeZone: "America/Phoenix",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  // Giây không lệch giữa các múi giờ (chỉ giờ/ngày mới lệch) — đọc thẳng từ Date gốc an toàn,
  // không cần format riêng theo America/Phoenix.
  return { time: `${hour}:${minute}`, period, weekdayDate, fullDate, seconds: date.getSeconds() };
}

const SIZE = 40;
const CENTER = SIZE / 2;
const RADIUS = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Vòng gauge tròn quanh giờ:phút (thêm 2026-08-24, lấy cảm hứng từ 1 mẫu đồng hồ dạng ring
 * gauge trên Pinterest, xem @clock.jpg) — viền ngoài track mờ cố định, cung sáng gradient
 * xanh chạy theo % giây trong phút hiện tại (0-59 -> 0-360°), kèm 1 chấm sáng ở đầu cung
 * (giống marker trong ảnh gốc). AM/PM (tự đổi "SA"/"CH" theo locale vi-VN) đặt NGAY GIỮA vòng
 * tròn (yêu cầu 2026-08-24, giống ảnh gốc "PM" nằm trong vòng gauge to). Bên cạnh ring xếp 2
 * dòng chữ: dòng trên = thứ + ngày/tháng/năm ngắn gọn, dòng dưới = giờ:phút + MST — cả 2 dòng
 * dùng `text-text-dim` (không phải `text-text-faint`) để đủ sáng dễ đọc trên nền pill tối,
 * theo phản hồi "chữ hơi tối" 2026-08-24. Hover xem đầy đủ thứ + ngày/tháng/năm trong tooltip.
 */
export function PhoenixClock() {
  const [now, setNow] = useState<Date | null>(null);
  const { language } = useLanguage();
  const gradientId = useId();
  const locale = language === "vi" ? "vi-VN" : "en-US";

  useEffect(() => {
    // Gọi setState đồng bộ ngay đây (khác nạp lười thông thường) là CỐ Ý — tránh lệch giờ
    // giữa lúc SSR render (không có Date thật, `now` = null) và lần render đầu ở client;
    // đợi tick đầu tiên của setInterval (1s sau) sẽ khiến đồng hồ trống 1 giây khi mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;
  const { time, period, weekdayDate, fullDate, seconds } = formatPhoenix(now, locale);
  const progress = seconds / 60;
  const dashOffset = CIRCUMFERENCE * (1 - progress);
  // Góc bắt đầu ở 12h (top), chấm sáng đặt theo đúng vị trí cuối cung — SVG mặc định 0° ở
  // 3h nên trừ 90° để quy về mốc 12h giống hướng vẽ cung (transform: rotate(-90deg) bên dưới).
  const dotAngle = progress * 360 - 90;
  const dotX = CENTER + RADIUS * Math.cos((dotAngle * Math.PI) / 180);
  const dotY = CENTER + RADIUS * Math.sin((dotAngle * Math.PI) / 180);

  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 text-xs text-text-dim sm:flex"
      title={`${language === "en" ? "Phoenix, Arizona time (MST)" : "Giờ Phoenix, Arizona (MST)"} — ${fullDate}`}
    >
      {/* AM/PM đặt NGAY GIỮA vòng tròn (yêu cầu 2026-08-24, giống ảnh gốc "PM" nằm trong vòng
          gauge to) — phóng nhẹ ring lên 40px (từ 36px) để chữ 2 ký tự còn đọc được ở giữa,
          overlay bằng <span> absolute thay vì <text> SVG (dễ chỉnh font/line-height khớp
          phần chữ còn lại của app hơn). */}
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--accent-from)" />
              <stop offset="100%" stopColor="var(--accent-to)" />
            </linearGradient>
          </defs>
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--border-strong)" strokeWidth={2.5} />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            style={{ filter: "drop-shadow(0 0 3px rgba(58, 141, 209, 0.7))" }}
          />
          <circle cx={dotX} cy={dotY} r={1.8} fill="var(--accent-from)" style={{ filter: "drop-shadow(0 0 2px rgba(58, 141, 209, 0.9))" }} />
        </svg>
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9px] font-semibold uppercase leading-none text-text">
          {period}
        </span>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="whitespace-nowrap text-[10px] font-medium capitalize text-text-dim">{weekdayDate}</span>
        <span className="whitespace-nowrap">
          <span className="font-semibold tabular-nums text-text">{time}</span>{" "}
          <span className="text-[10px] font-medium text-text-dim">MST</span>
        </span>
      </div>
    </div>
  );
}
