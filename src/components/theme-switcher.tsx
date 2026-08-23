"use client";

import { Moon, Sun } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useT } from "@/lib/i18n";

const TRACK_W = 64;
const TRACK_H = 36;
const KNOB = 28;
const PADDING = 4;

/**
 * Chuyển đổi giao diện Tối/Sáng — chỉ có hiệu lực ở các màn hình sau đăng nhập
 * (DashboardLayout đọc theme này để set data-theme trên <html>); trang Login không
 * dùng component này, luôn giữ nguyên nền tối cố định. Lựa chọn lưu persist theo
 * trình duyệt, giữ nguyên qua các lần đăng nhập/tải lại trang.
 *
 * Thiết kế lại (2026-08-24, theo mẫu @daynight.jpg) — dạng track/knob trượt thay vì nút icon
 * đơn: track luôn hiện CẢ 2 icon tĩnh (mặt trời trái/mặt trăng phải, mờ) để biết 2 đầu track
 * là gì, "viên bi" (knob) trượt sang đúng bên đang chọn, mang icon SÁNG kèm glow màu tương ứng
 * (cam cho sáng, xanh cho tối) — glow dựng bằng box-shadow trên chính knob, không dùng ảnh.
 */
export function ThemeSwitcher({ compact: _compact = false }: { compact?: boolean }) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const t = useT();
  const isDark = theme === "dark";
  const knobLeft = isDark ? TRACK_W - KNOB - PADDING : PADDING;

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? t("theme.switchToLight") : t("theme.switchToDark")}
      aria-label={isDark ? t("theme.switchToLight") : t("theme.switchToDark")}
      className="relative shrink-0 rounded-full border border-border bg-bg-elevated transition-colors"
      style={{ width: TRACK_W, height: TRACK_H }}
    >
      <span className="flex h-full items-center justify-between px-2.5">
        <Sun size={13} className={`transition-opacity ${isDark ? "text-amber-500/35" : "opacity-0"}`} />
        <Moon size={13} className={`transition-opacity ${isDark ? "opacity-0" : "text-blue-300/35"}`} />
      </span>
      <span
        aria-hidden="true"
        className="absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-surface transition-all duration-300 ease-out"
        style={{
          left: knobLeft,
          width: KNOB,
          height: KNOB,
          boxShadow: isDark ? "0 0 10px 2px rgba(96, 165, 250, 0.55)" : "0 0 10px 2px rgba(245, 158, 11, 0.55)",
        }}
      >
        {isDark ? (
          <Moon size={14} className="text-blue-300" style={{ filter: "drop-shadow(0 0 3px rgba(96, 165, 250, 0.9))" }} />
        ) : (
          <Sun size={14} className="text-amber-400" style={{ filter: "drop-shadow(0 0 3px rgba(245, 158, 11, 0.9))" }} />
        )}
      </span>
    </button>
  );
}
