"use client";

import { SelectOption } from "@/lib/types";
import { useLanguage, translateOptionLabel } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";
import { darkenHex, withAlpha } from "@/lib/color";

export function OptionBadge({ option }: { option: SelectOption }) {
  const { language } = useLanguage();
  const theme = useAppStore((s) => s.theme);
  // Màu option (option.bg/option.color) là pastel chọn để đọc được trên nền TỐI — ở
  // Light Mode cùng màu đó trên nền sáng gần như vô hình, nên đậm chữ lên + tăng độ phủ
  // nền badge, KHÔNG đổi giá trị gốc lưu trong cấu hình cột (chỉ đổi lúc render).
  const isLight = theme === "light";
  const bg = isLight ? withAlpha(option.bg, 0.22) : option.bg;
  const color = isLight ? darkenHex(option.color, 0.4) : option.color;
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: bg, color, borderColor: color + "4d" }}
    >
      {translateOptionLabel(language, option.id, option.label)}
    </span>
  );
}
