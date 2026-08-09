"use client";

import { useLanguage } from "@/lib/i18n";
import { Language } from "@/lib/types";

const LANG_OPTIONS: { id: Language; flag: string; labelKey: "lang.vietnamese" | "lang.english" }[] = [
  { id: "vi", flag: "🇻🇳", labelKey: "lang.vietnamese" },
  { id: "en", flag: "🇬🇧", labelKey: "lang.english" },
];

/** Chuyển đổi ngôn ngữ hiển thị toàn app (Tiếng Việt / English), kèm icon lá cờ —
 * lựa chọn được lưu persist nên giữ nguyên qua các lần đăng nhập/tải lại trang. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
      {LANG_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          onClick={() => setLanguage(opt.id)}
          title={opt.id === "vi" ? "Tiếng Việt" : "English"}
          aria-label={opt.id === "vi" ? "Tiếng Việt" : "English"}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
            language === opt.id ? "bg-accent-soft text-accent" : "text-text-faint hover:text-text-dim"
          }`}
        >
          <span className="text-sm leading-none">{opt.flag}</span>
          {!compact && <span className="hidden sm:inline">{opt.id === "vi" ? "VI" : "EN"}</span>}
        </button>
      ))}
    </div>
  );
}
