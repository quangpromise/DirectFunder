"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Settings, X } from "lucide-react";
import { CpaEmailDefaults } from "@/lib/types";
import { useT, useLanguage } from "@/lib/i18n";
import { CPA_EMAIL_TEMPLATE_VAR_KEYS, DEFAULT_BODY_TEMPLATE } from "@/lib/cpa-email-template";
import { MailBodyEditor } from "@/components/mail-body-editor";

function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Dialog Admin cấu hình To/Cc + mẫu Body mặc định dùng chung cho mọi hồ sơ khi gửi email
 * CPA — đặt trên trang Phân quyền (đã gate manager-only sẵn), theo đúng khung modal của
 * ColumnSettingsDialog. Body hỗ trợ biến {clientName}, {ssn}... được thay bằng dữ liệu
 * thật của từng hồ sơ lúc mở dialog gửi (xem cpa-email-template.ts). KHÔNG còn ô Subject
 * mẫu — từ 2026-08-22, Subject luôn tự tính "[EC {năm viết tắt}]" theo popup chọn năm mới
 * ở SendCpaEmailDialog, không dùng mẫu Admin cấu hình nữa (`defaults.subjectTemplate` giữ
 * lại trong type/DB cho tương thích ngược nhưng không còn ô nào ghi đè nó ở đây). */
export function CpaEmailDefaultsDialog({
  defaults,
  onSave,
}: {
  defaults: CpaEmailDefaults;
  onSave: (next: CpaEmailDefaults) => void;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [editorNonce, setEditorNonce] = useState(0);
  const t = useT();
  const { language } = useLanguage();

  function openDialog() {
    setTo(defaults.to.join(", "));
    setCc(defaults.cc.join(", "));
    setBodyTemplate(defaults.bodyTemplate?.trim() || DEFAULT_BODY_TEMPLATE);
    setEditorNonce((n) => n + 1);
    setOpen(true);
  }

  function handleSave() {
    onSave({
      to: parseEmailList(to),
      cc: parseEmailList(cc),
      subjectTemplate: defaults.subjectTemplate,
      bodyTemplate: bodyTemplate.trim(),
    });
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={openDialog}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <Settings size={14} />
        {t("cpaEmailSettings.triggerBtn")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-lg flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("cpaEmailSettings.title")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5">
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("cpaEmailSettings.toLabel")}</label>
                  <textarea
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    rows={2}
                    placeholder="cpa1@example.com, cpa2@example.com"
                    className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("cpaEmailSettings.ccLabel")}</label>
                  <textarea
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    rows={2}
                    placeholder="manager@example.com"
                    className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-text-faint">{t("cpaEmailSettings.subjectAutoHint")}</p>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("cpaEmailSettings.bodyLabel")}</label>
                  <MailBodyEditor
                    key={editorNonce}
                    value={bodyTemplate}
                    onChange={setBodyTemplate}
                    language={language}
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-text-faint">
                  {t("cpaEmailSettings.variablesHint")}{" "}
                  {CPA_EMAIL_TEMPLATE_VAR_KEYS.map((key) => `{${key}}`).join(", ")}
                </p>
              </div>

              <div className="mt-5 flex justify-end gap-2 px-5 pb-5">
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover"
                >
                  {t("common.cancel")}
                </button>
                <button onClick={handleSave} className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white">
                  {t("cpaEmailSettings.saveBtn")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
