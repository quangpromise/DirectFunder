"use client";

import { Moon, Sun } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useT } from "@/lib/i18n";

/** Chuyển đổi giao diện Tối/Sáng — chỉ có hiệu lực ở các màn hình sau đăng nhập
 * (DashboardLayout đọc theme này để set data-theme trên <html>); trang Login không
 * dùng component này, luôn giữ nguyên nền tối cố định. Lựa chọn lưu persist theo
 * trình duyệt, giữ nguyên qua các lần đăng nhập/tải lại trang. */
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
      className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-2 text-text-faint transition hover:bg-surface-hover hover:text-text-dim"
    >
      {isDark ? <Moon size={15} /> : <Sun size={15} />}
      {!compact && <span className="hidden text-xs font-medium sm:inline">{isDark ? t("theme.dark") : t("theme.light")}</span>}
    </button>
  );
}
