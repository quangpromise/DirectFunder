"use client";

import { ShieldAlert } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { ASSIGNABLE_FEATURES, FEATURE_LABEL, ROLE_LABEL } from "@/lib/types";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { useT, useLanguage } from "@/lib/i18n";

export default function PermissionsPage() {
  const user = useCurrentUser();
  const permissions = useAppStore((s) => s.featurePermissions);
  const setFeaturePermission = useAppStore((s) => s.setFeaturePermission);
  const t = useT();
  const { language } = useLanguage();

  if (!user) return null;

  if (user.role !== "manager") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <ShieldAlert size={28} className="text-text-faint" />
        <p className="text-sm text-text-dim">{t("users.accessDenied")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-lg font-semibold tracking-tight">{t("permissions.title")}</h1>
      <p className="mt-0.5 text-xs text-text-faint">{t("permissions.desc")}</p>

      <div className="mt-5 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-elevated">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-text-dim">{t("permissions.feature")}</th>
              {ASSIGNABLE_ROLES.map((role) => (
                <th key={role} className="px-3 py-2.5 text-center text-xs font-medium text-text-dim">
                  {ROLE_LABEL[language][role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ASSIGNABLE_FEATURES.map((feature) => (
              <tr key={feature} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3 text-sm">{FEATURE_LABEL[language][feature]}</td>
                {ASSIGNABLE_ROLES.map((role) => {
                  const isManager = role === "manager";
                  const checked = isManager || permissions[feature]?.includes(role);
                  return (
                    <td key={role} className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isManager}
                        onChange={(e) => setFeaturePermission(feature, role, e.target.checked)}
                        className="h-4 w-4 accent-[var(--accent)] disabled:opacity-50"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-text-faint">{t("permissions.footnote")}</p>
    </div>
  );
}
