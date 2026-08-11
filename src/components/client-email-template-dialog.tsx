"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Mail, X } from "lucide-react";
import { ClientEmailTemplate } from "@/lib/types";
import { useT, useLanguage } from "@/lib/i18n";
import {
  CLIENT_EMAIL_TEMPLATE_VAR_KEYS,
  DEFAULT_CLIENT_EMAIL_SUBJECT,
  DEFAULT_CLIENT_EMAIL_BODY,
} from "@/lib/client-email-template";
import { MailBodyEditor } from "@/components/mail-body-editor";

/** Dialog Admin cấu hình mẫu Subject/Body cố định dùng chung cho mọi hồ sơ khi gửi email
 * TRỰC TIẾP CHO KHÁCH HÀNG (nút cạnh ô Email trong popup "Edit Hồ sơ") — đặt trên trang
 * Phân quyền (đã gate manager-only sẵn), theo đúng khung modal của CpaEmailDefaultsDialog.
 * KHÔNG có To/Cc — người nhận LUÔN là email khách hàng của hồ sơ đang mở. Danh sách biến
 * gợi ý lấy từ CLIENT_EMAIL_TEMPLATE_VAR_KEYS (KHÁC danh sách biến CPA — cố ý không có
 * {ssn}/{money}/{status} để tránh Admin lỡ chèn dữ liệu nội bộ vào mail gửi ra ngoài). */
export function ClientEmailTemplateDialog({
  value,
  onSave,
}: {
  value: ClientEmailTemplate;
  onSave: (next: ClientEmailTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [editorNonce, setEditorNonce] = useState(0);
  const t = useT();
  const { language } = useLanguage();

  function openDialog() {
    setSubjectTemplate(value.subjectTemplate?.trim() || DEFAULT_CLIENT_EMAIL_SUBJECT);
    setBodyTemplate(value.bodyTemplate?.trim() || DEFAULT_CLIENT_EMAIL_BODY);
    setEditorNonce((n) => n + 1);
    setOpen(true);
  }

  function handleSave() {
    onSave({
      subjectTemplate: subjectTemplate.trim(),
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
        <Mail size={14} />
        {t("clientEmailSettings.triggerBtn")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-lg flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("clientEmailSettings.title")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5">
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.subjectLabel")}</label>
                  <input
                    value={subjectTemplate}
                    onChange={(e) => setSubjectTemplate(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.bodyLabel")}</label>
                  <MailBodyEditor key={editorNonce} value={bodyTemplate} onChange={setBodyTemplate} language={language} />
                </div>
                <p className="text-[11px] leading-relaxed text-text-faint">
                  {t("clientEmailSettings.variablesHint")}{" "}
                  {CLIENT_EMAIL_TEMPLATE_VAR_KEYS.map((key) => `{${key}}`).join(", ")}
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
                  {t("clientEmailSettings.saveBtn")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
