"use client";

import { ShieldAlert } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { ASSIGNABLE_FEATURES, FEATURE_LABEL, ROLE_LABEL } from "@/lib/types";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { useT, useLanguage } from "@/lib/i18n";
import { CpaEmailDefaultsDialog } from "@/components/cpa-email-defaults-dialog";
import { GoogleSheetConfigDialog } from "@/components/google-sheet-config-dialog";
import { ClientEmailTemplateDialog } from "@/components/client-email-template-dialog";

export default function PermissionsPage() {
  const user = useCurrentUser();
  const permissions = useAppStore((s) => s.featurePermissions);
  const setFeaturePermission = useAppStore((s) => s.setFeaturePermission);
  const cpaEmailDefaults = useAppStore((s) => s.cpaEmailDefaults);
  const setCpaEmailDefaults = useAppStore((s) => s.setCpaEmailDefaults);
  const googleSheetConfig = useAppStore((s) => s.googleSheetConfig);
  const setGoogleSheetConfig = useAppStore((s) => s.setGoogleSheetConfig);
  const clientEmailTemplate = useAppStore((s) => s.clientEmailTemplate);
  const setClientEmailTemplate = useAppStore((s) => s.setClientEmailTemplate);
  const columns = useAppStore((s) => s.columns);
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
    <div className="px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t("permissions.title")}</h1>
          <p className="mt-0.5 text-xs text-text-faint">{t("permissions.desc")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CpaEmailDefaultsDialog defaults={cpaEmailDefaults} onSave={setCpaEmailDefaults} />
          <GoogleSheetConfigDialog config={googleSheetConfig} columns={columns} onSave={setGoogleSheetConfig} />
          <ClientEmailTemplateDialog value={clientEmailTemplate ?? {}} onSave={setClientEmailTemplate} />
        </div>
      </div>

      {/* Bỏ giới hạn max-w-3xl + max-h-[65vh] cũ (chỉ chiếm 1 khối nhỏ giữa màn hình) —
          giờ chiếm full chiều rộng/cao màn hình giống bảng Hồ sơ/Order, cuộn theo
          <main className="overflow-auto"> ở layout ngoài (header dính sticky top-0). */}
      <div className="mt-5 overflow-auto rounded-xl border border-border-strong">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-normal text-table-head-text">
                {t("permissions.feature")}
              </th>
              {ASSIGNABLE_ROLES.map((role) => (
                <th
                  key={role}
                  className="sticky top-0 z-10 border-b-2 border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-normal text-table-head-text"
                >
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
