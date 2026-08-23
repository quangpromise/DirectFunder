"use client";

import { Moon, Sun } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useT } from "@/lib/i18n";

/**
 * Chuyển đổi giao diện Tối/Sáng — chỉ có hiệu lực ở các màn hình sau đăng nhập
 * (DashboardLayout đọc theme này để set data-theme trên <html>); trang Login không
 * dùng component này, luôn giữ nguyên nền tối cố định. Lựa chọn lưu persist theo
 * trình duyệt, giữ nguyên qua các lần đăng nhập/tải lại trang.
 *
 * Đã thử thiết kế lại thành dạng track/knob trượt (2026-08-24, theo mẫu @daynight.jpg) rồi
 * TRẢ LẠI nút icon đơn giản như bản gốc theo phản hồi "trả lại darkmode/light mode như cũ" —
 * chỉ giữ lại 1 cải tiến nhỏ: icon của chế độ ĐANG chọn giờ SÁNG màu + có glow nhẹ (amber cho
 * Sáng, xanh cho Tối) thay vì xám mờ `text-text-faint` như bản gốc, để rõ ràng đây là trạng
 * thái đang bật chứ không chỉ là icon "nút bấm để đổi".
 */
export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const t = useT();
  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? t("theme.switchToLight") : t("theme.switchToDark")}
      aria-label={isDark ? t("theme.switchToLight") : t("theme.switchToDark")}
      className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-2 text-text-dim transition hover:bg-surface-hover hover:text-text"
    >
      {isDark ? (
        <Moon size={15} className="text-blue-300" style={{ filter: "drop-shadow(0 0 3px rgba(96, 165, 250, 0.75))" }} />
      ) : (
        <Sun size={15} className="text-amber-400" style={{ filter: "drop-shadow(0 0 3px rgba(245, 158, 11, 0.75))" }} />
      )}
      {!compact && <span className="hidden text-xs font-medium sm:inline">{isDark ? t("theme.dark") : t("theme.light")}</span>}
    </button>
  );
}
