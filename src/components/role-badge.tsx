"use client";

import { Role, ROLE_LABEL } from "@/lib/types";
import { useLanguage } from "@/lib/i18n";

// Màu pastel (text-*-300) đọc tốt trên nền tối mặc định; thêm light:text-*-700 +
// light:bg-*/10 đậm hơn để vẫn rõ chữ khi Light Mode đang bật (nền sáng).
const ROLE_COLOR: Record<Role, string> = {
  manager: "text-orange-300 bg-orange-500/15 border-orange-500/30 light:text-orange-700 light:bg-orange-500/10 light:border-orange-500/40",
  accounting:
    "text-emerald-300 bg-emerald-500/15 border-emerald-500/30 light:text-emerald-700 light:bg-emerald-500/10 light:border-emerald-500/40",
  agent: "text-blue-300 bg-blue-500/15 border-blue-500/30 light:text-blue-700 light:bg-blue-500/10 light:border-blue-500/40",
  processor: "text-amber-300 bg-amber-500/15 border-amber-500/30 light:text-amber-700 light:bg-amber-500/10 light:border-amber-500/40",
  support: "text-cyan-300 bg-cyan-500/15 border-cyan-500/30 light:text-cyan-700 light:bg-cyan-500/10 light:border-cyan-500/40",
  agent_leader:
    "text-indigo-300 bg-indigo-500/15 border-indigo-500/30 light:text-indigo-700 light:bg-indigo-500/10 light:border-indigo-500/40",
  processor_leader:
    "text-fuchsia-300 bg-fuchsia-500/15 border-fuchsia-500/30 light:text-fuchsia-700 light:bg-fuchsia-500/10 light:border-fuchsia-500/40",
};

export function RoleBadge({ role }: { role: Role }) {
  const { language } = useLanguage();
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ROLE_COLOR[role]}`}>
      {ROLE_LABEL[language][role]}
    </span>
  );
}
