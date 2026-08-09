"use client";

import { SelectOption } from "@/lib/types";
import { useLanguage, translateOptionLabel } from "@/lib/i18n";

export function OptionBadge({ option }: { option: SelectOption }) {
  const { language } = useLanguage();
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: option.bg, color: option.color, borderColor: option.color + "4d" }}
    >
      {translateOptionLabel(language, option.id, option.label)}
    </span>
  );
}
