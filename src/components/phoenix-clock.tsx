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

// Viên "capsule" dẹp 2 đầu trên/dưới (thêm 2026-08-24, sửa lại từ vòng tròn ban đầu — yêu cầu
// "circle dẹp 2 đầu trên dưới, dài đủ để nhét giờ và AM,PM vào") — <rect rx=ry=PILL_H/2> tạo
// đúng hình capsule: 2 cạnh trên/dưới THẲNG (dẹp), 2 đầu trái/phải BO TRÒN bán nguyệt. Đủ rộng
// để "09:36 PM" nằm gọn 1 dòng bên trong, thay vì tách giờ:phút ra ngoài như bản vòng tròn cũ.
const PILL_W = 66;
const PILL_H = 22;
const STROKE = 2;
const RECT_X = STROKE / 2;
const RECT_Y = STROKE / 2;
const RECT_W = PILL_W - STROKE;
const RECT_H = PILL_H - STROKE;
const RECT_R = RECT_H / 2;

/**
 * Viên capsule gauge quanh giờ:phút + AM/PM (thêm 2026-08-24, thiết kế lại từ bản vòng tròn
 * cùng ngày — vòng tròn quá nhỏ để chứa cả giờ lẫn buổi AM/PM, phải tách "PM" vào giữa vòng
 * còn "09:36" đặt riêng bên ngoài). Track viền mờ cố định + cung sáng gradient xanh chạy dọc
 * theo chu vi capsule theo % giây trong phút hiện tại (dùng `pathLength=100` trên <rect> để
 * chuẩn hoá chu vi về 100 đơn vị, khỏi phải tự tính chu vi hình bo tròn 2 đầu bằng tay) — bỏ
 * hẳn chấm sáng marker cuối cung của bản vòng tròn cũ (không tính được điểm chính xác trên
 * path capsule tuỳ biến mà không cần đo DOM thật, đổi lấy sự đơn giản/ổn định). "09:36 PM" giờ
 * nằm gọn 1 dòng NGAY TRONG capsule. Bên cạnh capsule chỉ còn 1 dòng: thứ + ngày/tháng/năm
 * ngắn gọn (dòng "giờ:phút + MST" cũ bỏ đi vì giờ đã nằm trong capsule) — dùng `text-text-dim`
 * để đủ sáng dễ đọc trên nền pill tối. Hover xem đầy đủ thứ + ngày/tháng/năm trong tooltip.
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
  // pathLength=100 chuẩn hoá chu vi capsule về 100 đơn vị (SVG 2, hỗ trợ tốt trên mọi trình
  // duyệt hiện đại) — khỏi phải tự tính chu vi hình chữ nhật bo tròn 2 đầu bằng công thức tay.
  const dashOffset = 100 * (1 - progress);

  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 text-xs text-text-dim sm:flex"
      title={`${language === "en" ? "Phoenix, Arizona time (MST)" : "Giờ Phoenix, Arizona (MST)"} — ${fullDate}`}
    >
      {/* Capsule dẹp 2 đầu trên/dưới (thêm 2026-08-24, thay cho vòng tròn cũ) — "09:36 PM" nằm
          gọn 1 dòng ngay bên trong, overlay bằng <span> absolute thay vì <text> SVG (dễ chỉnh
          font/line-height khớp phần chữ còn lại của app hơn). */}
      <div className="relative shrink-0" style={{ width: PILL_W, height: PILL_H }}>
        <svg width={PILL_W} height={PILL_H} viewBox={`0 0 ${PILL_W} ${PILL_H}`}>
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--accent-from)" />
              <stop offset="100%" stopColor="var(--accent-to)" />
            </linearGradient>
          </defs>
          <rect
            x={RECT_X}
            y={RECT_Y}
            width={RECT_W}
            height={RECT_H}
            rx={RECT_R}
            ry={RECT_R}
            fill="none"
            stroke="var(--border-strong)"
            strokeWidth={STROKE}
          />
          <rect
            x={RECT_X}
            y={RECT_Y}
            width={RECT_W}
            height={RECT_H}
            rx={RECT_R}
            ry={RECT_R}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={STROKE}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={100}
            strokeDashoffset={dashOffset}
            style={{ filter: "drop-shadow(0 0 3px rgba(58, 141, 209, 0.7))" }}
          />
        </svg>
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 leading-none text-text">
          <span className="text-[11px] font-semibold tabular-nums">{time}</span>
          <span className="text-[9px] font-semibold uppercase">{period}</span>
        </span>
      </div>
      <span className="whitespace-nowrap text-[10px] font-medium capitalize text-text-dim">{weekdayDate}</span>
    </div>
  );
}
