"use client";

import { useLanguage } from "@/lib/i18n";
import { Language } from "@/lib/types";
import { FlagVN, FlagGB } from "@/components/flag-icon";

const LANG_OPTIONS: { id: Language; Flag: typeof FlagVN }[] = [
  { id: "vi", Flag: FlagVN },
  { id: "en", Flag: FlagGB },
];

/** Chuyển đổi ngôn ngữ hiển thị toàn app (Tiếng Việt / English), kèm icon lá cờ —
 * lựa chọn được lưu persist nên giữ nguyên qua các lần đăng nhập/tải lại trang. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
      {LANG_OPTIONS.map(({ id, Flag }) => (
        <button
          key={id}
          onClick={() => setLanguage(id)}
          title={id === "vi" ? "Tiếng Việt" : "English"}
          aria-label={id === "vi" ? "Tiếng Việt" : "English"}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
            language === id ? "bg-accent-soft text-accent" : "text-text-faint hover:text-text-dim"
          }`}
        >
          <Flag className="h-3.5 w-5 shrink-0 rounded-[2px]" />
          {!compact && <span className="hidden sm:inline">{id === "vi" ? "VI" : "EN"}</span>}
        </button>
      ))}
    </div>
  );
}
