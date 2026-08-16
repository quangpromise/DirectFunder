"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Mail, X } from "lucide-react";
import { ClientEmailTemplate } from "@/lib/types";
import { useT, useLanguage } from "@/lib/i18n";
import {
  DEFAULT_SIGNATURE_JOB_TITLE,
  DEFAULT_SIGNATURE_PHONE,
  DEFAULT_SIGNATURE_ADDRESS,
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_REFUND_EMAIL_SUBJECT_VI,
  DEFAULT_REFUND_EMAIL_SUBJECT_EN,
  DEFAULT_REFUND_EMAIL_BODY_VI,
  DEFAULT_REFUND_EMAIL_BODY_EN,
  DEFAULT_BREAKDOWN_TAX_CREDIT_LABEL,
  DEFAULT_BREAKDOWN_TAX_INT_LABEL,
  DEFAULT_BREAKDOWN_ESTIMATED_LABEL,
  REFUND_EMAIL_TEMPLATE_VAR_KEYS,
} from "@/lib/client-email-template";
import { MailBodyEditor } from "@/components/mail-body-editor";

function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Dialog Admin cấu hình Cc + Subject/Body (RIÊNG theo ngôn ngữ VI/EN, khớp toggle ngôn ngữ
 * trong popup gửi) + 4 field chữ ký/liên hệ cố định cho email "Thông báo hoàn thuế" gửi
 * khách hàng (nút gửi mail cạnh ô Email trong popup Edit Hồ sơ) — đặt trên trang Phân
 * quyền (đã gate manager-only sẵn). Subject/Body hỗ trợ token {key} (xem
 * REFUND_EMAIL_TEMPLATE_VAR_KEYS) — {breakdown} là khối Tax credit/Additional tax on
 * 1099-INT/Estimated refund amount tính tự động, không gõ tay được, chỉ đặt token này ở
 * đâu trong template. Tên/Email/Logo trong chữ ký tự lấy theo user đang đăng nhập, KHÔNG
 * cấu hình ở đây. */
export function ClientEmailTemplateDialog({
  value,
  onSave,
}: {
  value: ClientEmailTemplate;
  onSave: (next: ClientEmailTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeLang, setActiveLang] = useState<"vi" | "en">("vi");
  const [cc, setCc] = useState("");
  const [subjectVi, setSubjectVi] = useState("");
  const [subjectEn, setSubjectEn] = useState("");
  const [bodyVi, setBodyVi] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [breakdownTaxCreditLabel, setBreakdownTaxCreditLabel] = useState("");
  const [breakdownTaxIntLabel, setBreakdownTaxIntLabel] = useState("");
  const [breakdownEstimatedLabel, setBreakdownEstimatedLabel] = useState("");
  const [signatureJobTitle, setSignatureJobTitle] = useState("");
  const [signaturePhone, setSignaturePhone] = useState("");
  const [signatureAddress, setSignatureAddress] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [editorNonce, setEditorNonce] = useState(0);
  const t = useT();
  const { language } = useLanguage();

  function openDialog() {
    setActiveLang("vi");
    setCc((value.cc ?? []).join(", "));
    setSubjectVi(value.subjectTemplateVi?.trim() || DEFAULT_REFUND_EMAIL_SUBJECT_VI);
    setSubjectEn(value.subjectTemplateEn?.trim() || DEFAULT_REFUND_EMAIL_SUBJECT_EN);
    setBodyVi(value.bodyTemplateVi?.trim() || DEFAULT_REFUND_EMAIL_BODY_VI);
    setBodyEn(value.bodyTemplateEn?.trim() || DEFAULT_REFUND_EMAIL_BODY_EN);
    setBreakdownTaxCreditLabel(value.breakdownTaxCreditLabel?.trim() || DEFAULT_BREAKDOWN_TAX_CREDIT_LABEL);
    setBreakdownTaxIntLabel(value.breakdownTaxIntLabel?.trim() || DEFAULT_BREAKDOWN_TAX_INT_LABEL);
    setBreakdownEstimatedLabel(value.breakdownEstimatedLabel?.trim() || DEFAULT_BREAKDOWN_ESTIMATED_LABEL);
    setSignatureJobTitle(value.signatureJobTitle?.trim() || DEFAULT_SIGNATURE_JOB_TITLE);
    setSignaturePhone(value.signaturePhone?.trim() || DEFAULT_SIGNATURE_PHONE);
    setSignatureAddress(value.signatureAddress?.trim() || DEFAULT_SIGNATURE_ADDRESS);
    setSupportPhone(value.supportPhone?.trim() || DEFAULT_SUPPORT_PHONE);
    setEditorNonce((n) => n + 1);
    setOpen(true);
  }

  function handleSave() {
    onSave({
      cc: parseEmailList(cc),
      subjectTemplateVi: subjectVi.trim(),
      subjectTemplateEn: subjectEn.trim(),
      bodyTemplateVi: bodyVi.trim(),
      bodyTemplateEn: bodyEn.trim(),
      breakdownTaxCreditLabel: breakdownTaxCreditLabel.trim(),
      breakdownTaxIntLabel: breakdownTaxIntLabel.trim(),
      breakdownEstimatedLabel: breakdownEstimatedLabel.trim(),
      signatureJobTitle: signatureJobTitle.trim(),
      signaturePhone: signaturePhone.trim(),
      signatureAddress: signatureAddress.trim(),
      supportPhone: supportPhone.trim(),
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
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.ccLabel")}</label>
                  <textarea
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    rows={2}
                    placeholder="manager@example.com"
                    className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>

                <div className="flex gap-2">
                  {(["vi", "en"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setActiveLang(lang)}
                      className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        activeLang === lang
                          ? "border-accent bg-accent-soft text-text"
                          : "border-border bg-bg-elevated text-text-dim hover:border-accent"
                      }`}
                    >
                      {lang === "vi" ? t("refundEmail.langVi") : t("refundEmail.langEn")}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.subjectLabel")}</label>
                  <input
                    value={activeLang === "vi" ? subjectVi : subjectEn}
                    onChange={(e) => (activeLang === "vi" ? setSubjectVi(e.target.value) : setSubjectEn(e.target.value))}
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.bodyLabel")}</label>
                  {activeLang === "vi" ? (
                    <MailBodyEditor key={`vi-${editorNonce}`} value={bodyVi} onChange={setBodyVi} language={language} />
                  ) : (
                    <MailBodyEditor key={`en-${editorNonce}`} value={bodyEn} onChange={setBodyEn} language={language} />
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-text-faint">
                  {t("clientEmailSettings.variablesHint")} {REFUND_EMAIL_TEMPLATE_VAR_KEYS.map((key) => `{${key}}`).join(", ")}
                </p>

                <div className="mt-1 border-t border-border pt-3">
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.breakdownTaxCreditLabel")}</label>
                  <input
                    value={breakdownTaxCreditLabel}
                    onChange={(e) => setBreakdownTaxCreditLabel(e.target.value)}
                    placeholder="{year} tax credit"
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.breakdownTaxIntLabel")}</label>
                  <input
                    value={breakdownTaxIntLabel}
                    onChange={(e) => setBreakdownTaxIntLabel(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.breakdownEstimatedLabel")}</label>
                  <input
                    value={breakdownEstimatedLabel}
                    onChange={(e) => setBreakdownEstimatedLabel(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-text-faint">{t("clientEmailSettings.breakdownHint")}</p>

                <div className="mt-1 border-t border-border pt-3">
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.jobTitleLabel")}</label>
                  <input
                    value={signatureJobTitle}
                    onChange={(e) => setSignatureJobTitle(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.signaturePhoneLabel")}</label>
                  <input
                    value={signaturePhone}
                    onChange={(e) => setSignaturePhone(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.addressLabel")}</label>
                  <input
                    value={signatureAddress}
                    onChange={(e) => setSignatureAddress(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("clientEmailSettings.supportPhoneLabel")}</label>
                  <input
                    value={supportPhone}
                    onChange={(e) => setSupportPhone(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-text-faint">{t("clientEmailSettings.hint")}</p>
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
