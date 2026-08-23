"use client";

import { useEffect, useId, useState } from "react";
import { useLanguage } from "@/lib/i18n";

function formatPhoenix(date: Date): { time: string; dateStr: string; seconds: number } {
  const time = date.toLocaleTimeString("en-US", {
    timeZone: "America/Phoenix",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const dateStr = date.toLocaleDateString("en-US", {
    timeZone: "America/Phoenix",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  // Giây không lệch giữa các múi giờ (chỉ giờ/ngày mới lệch) — đọc thẳng từ Date gốc an toàn,
  // không cần format riêng theo America/Phoenix.
  return { time, dateStr, seconds: date.getSeconds() };
}

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Vòng gauge tròn quanh giờ:phút (thêm 2026-08-24, lấy cảm hứng từ 1 mẫu đồng hồ dạng ring
 * gauge trên Pinterest, xem @clock.jpg) — viền ngoài track mờ cố định, cung sáng gradient
 * xanh chạy theo % giây trong phút hiện tại (0-59 -> 0-360°), kèm 1 chấm sáng ở đầu cung
 * (giống marker trong ảnh gốc). Thu nhỏ thành mini-ring ~36px thay vì vòng to nguyên khối như
 * ảnh gốc (không đủ chỗ trong header cao 56px) — vẫn giữ nguyên cơ chế badge/tooltip cũ (hover
 * xem đầy đủ ngày + MST), chỉ đổi phần hiển thị giờ:phút từ badge chữ thường sang bọc trong
 * ring này.
 */
export function PhoenixClock() {
  const [now, setNow] = useState<Date | null>(null);
  const { language } = useLanguage();
  const gradientId = useId();

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
  const { time, dateStr, seconds } = formatPhoenix(now);
  const progress = seconds / 60;
  const dashOffset = CIRCUMFERENCE * (1 - progress);
  // Góc bắt đầu ở 12h (top), chấm sáng đặt theo đúng vị trí cuối cung — SVG mặc định 0° ở
  // 3h nên trừ 90° để quy về mốc 12h giống hướng vẽ cung (transform: rotate(-90deg) bên dưới).
  const dotAngle = progress * 360 - 90;
  const dotX = 18 + RADIUS * Math.cos((dotAngle * Math.PI) / 180);
  const dotY = 18 + RADIUS * Math.sin((dotAngle * Math.PI) / 180);

  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 text-xs text-text-dim sm:flex"
      title={`${language === "en" ? "Phoenix, Arizona time (MST)" : "Giờ Phoenix, Arizona (MST)"} — ${dateStr}`}
    >
      <svg width={36} height={36} viewBox="0 0 36 36" className="shrink-0">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent-from)" />
            <stop offset="100%" stopColor="var(--accent-to)" />
          </linearGradient>
        </defs>
        <circle cx={18} cy={18} r={RADIUS} fill="none" stroke="var(--border-strong)" strokeWidth={2.5} />
        <circle
          cx={18}
          cy={18}
          r={RADIUS}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 18 18)"
          style={{ filter: "drop-shadow(0 0 3px rgba(58, 141, 209, 0.7))" }}
        />
        <circle cx={dotX} cy={dotY} r={1.8} fill="var(--accent-from)" style={{ filter: "drop-shadow(0 0 2px rgba(58, 141, 209, 0.9))" }} />
      </svg>
      <span className="font-semibold tabular-nums text-text">{time.slice(0, 5)}</span>
      <span className="text-[10px] text-text-faint">MST</span>
    </div>
  );
}
