"use client";

import { Role, ROLE_LABEL } from "@/lib/types";
import { useLanguage } from "@/lib/i18n";

const ROLE_COLOR: Record<Role, string> = {
  manager: "text-orange-300 bg-orange-500/15 border-orange-500/30",
  accounting: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30",
  agent: "text-blue-300 bg-blue-500/15 border-blue-500/30",
  processor: "text-amber-300 bg-amber-500/15 border-amber-500/30",
  support: "text-cyan-300 bg-cyan-500/15 border-cyan-500/30",
};

export function RoleBadge({ role }: { role: Role }) {
  const { language } = useLanguage();
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ROLE_COLOR[role]}`}>
      {ROLE_LABEL[language][role]}
    </span>
  );
}
