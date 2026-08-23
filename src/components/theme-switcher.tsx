"use client";

import { Moon, Sun } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useT } from "@/lib/i18n";

const TRACK_W = 64;
const TRACK_H = 34;
const BORDER = 2;
const KNOB = TRACK_H - BORDER * 2 - 4;

/**
 * Chuyển đổi giao diện Tối/Sáng — chỉ có hiệu lực ở các màn hình sau đăng nhập
 * (DashboardLayout đọc theme này để set data-theme trên <html>); trang Login không
 * dùng component này, luôn giữ nguyên nền tối cố định. Lựa chọn lưu persist theo
 * trình duyệt, giữ nguyên qua các lần đăng nhập/tải lại trang.
 *
 * Thiết kế lại (2026-08-24, bám sát mẫu @daynight.jpg — bản đầu chưa đủ giống, sửa lại theo
 * phản hồi "chưa giống thiết kế gốc"): track LUÔN có viền dạng gradient cam (trái, phía mặt
 * trời) -> xanh (phải, phía mặt trăng) CỐ ĐỊNH bất kể đang chọn theme nào (dựng bằng kỹ thuật
 * "gradient border" — div ngoài nền gradient + padding = độ dày viền, div/button trong nền
 * đặc che phần giữa). Icon KHÔNG active hiện dạng phẳng, màu no đủ + glow nhẹ ngay trên track
 * (không làm mờ/opacity thấp như bản đầu). Icon ĐANG active nằm trong knob to gần bằng chiều
 * cao track (giống ảnh gốc, không phải viên bi nhỏ), nền tối, viền + glow màu tương ứng. Nền
 * track/knob cố tình hard-code tối (không đổi theo data-theme hiện tại của app) — bản thân
 * công tắc mô phỏng 1 thiết bị vật lý riêng biệt, giữ đúng tông ảnh gốc dù app đang Light hay
 * Dark mode.
 */
export function ThemeSwitcher({ compact: _compact = false }: { compact?: boolean }) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const t = useT();
  const isDark = theme === "dark";
  const knobLeft = isDark ? TRACK_W - BORDER - 2 - KNOB : BORDER + 2;

  return (
    <div
      className="shrink-0 rounded-full"
      style={{
        width: TRACK_W,
        height: TRACK_H,
        padding: BORDER,
        backgroundImage:
          "linear-gradient(90deg, rgba(245,158,11,0.95), rgba(245,158,11,0.25) 42%, rgba(96,165,250,0.25) 58%, rgba(96,165,250,0.95))",
      }}
    >
      <button
        onClick={() => setTheme(isDark ? "light" : "dark")}
        title={isDark ? t("theme.switchToLight") : t("theme.switchToDark")}
        aria-label={isDark ? t("theme.switchToLight") : t("theme.switchToDark")}
        className="relative h-full w-full rounded-full"
        style={{ backgroundColor: "#0b0c11" }}
      >
        <span className="flex h-full items-center justify-between px-2.5">
          <Sun
            size={14}
            className={`text-amber-400 transition-opacity ${isDark ? "opacity-100" : "opacity-0"}`}
            style={isDark ? { filter: "drop-shadow(0 0 3px rgba(245, 158, 11, 0.85))" } : undefined}
          />
          <Moon
            size={14}
            className={`text-blue-300 transition-opacity ${isDark ? "opacity-0" : "opacity-100"}`}
            style={!isDark ? { filter: "drop-shadow(0 0 3px rgba(96, 165, 250, 0.85))" } : undefined}
          />
        </span>
        <span
          aria-hidden="true"
          className="absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full transition-all duration-300 ease-out"
          style={{
            left: knobLeft,
            width: KNOB,
            height: KNOB,
            backgroundColor: "#161923",
            boxShadow: isDark
              ? "0 0 0 1.5px rgba(96, 165, 250, 0.7), 0 0 12px 3px rgba(96, 165, 250, 0.55)"
              : "0 0 0 1.5px rgba(245, 158, 11, 0.7), 0 0 12px 3px rgba(245, 158, 11, 0.55)",
          }}
        >
          {isDark ? (
            <Moon size={16} className="text-blue-200" style={{ filter: "drop-shadow(0 0 4px rgba(96, 165, 250, 0.95))" }} />
          ) : (
            <Sun size={16} className="text-amber-300" style={{ filter: "drop-shadow(0 0 4px rgba(245, 158, 11, 0.95))" }} />
          )}
        </span>
      </button>
    </div>
  );
}
