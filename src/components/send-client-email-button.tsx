"use client";

import { Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import { REFUND_YEARS } from "@/lib/refund";
import { fileToDataUrl } from "@/lib/file-to-data-url";
import { ConnectWebmailDialog } from "@/components/connect-webmail-dialog";
import { MailBodyEditor } from "@/components/mail-body-editor";
import { SendingProgressToast } from "@/components/sending-progress-toast";

type PreviewResult =
  | { ok: true; subject: string; bodyHtml: string; to: string[]; cc: string[] }
  | { ok: false; error: string };
type SendResult = { ok: true } | { ok: false; error: string; needsWebmailAuth?: boolean };
type ConnectResult = { ok: true } | { ok: false; error: string };
type Language = "vi" | "en";
type Attachment = { filename: string; contentType: string; contentBase64: string };

const MAX_TOTAL_ATTACHMENT_BYTES = 4 * 1024 * 1024;

function splitEmails(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Nút nhỏ cạnh Status trên bảng Hồ sơ (chuyển ra khỏi popup "Edit Hồ sơ" 2026-08-16) — mở
 * popup chọn năm (giống TestSheetButton) + ngôn ngữ + ô nhập Tax INT hiện NGAY DƯỚI năm đã
 * chọn (bôi màu nổi bật), rồi bấm "Confirm" mở màn hình "soạn mail" (Subject/Nội dung/To/Cc
 * điền sẵn từ POST /api/cases/[id]/refund-email-preview, CHO SỬA TỰ DO trước khi gửi thật —
 * khác thiết kế cũ vốn gửi cố định 100% không cho sửa) + tệp đính kèm tự thêm (giống
 * SendCpaEmailDialog) qua mailbox webmail mail.directfunder.com riêng của người bấm gửi.
 * Trạng thái "đã gửi" giờ BỀN VỮNG qua `clientEmailSentAt` (đọc thẳng từ CaseRecord, không
 * dùng local useState) — giữ đúng màu xanh qua reload, giống SendToSheetButton/
 * SendCpaEmailDialog/TestSheetButton. Có thêm nút phụ "Mark as sent" ở popup chọn năm (đánh
 * dấu thủ công, KHÔNG gửi mail thật) và bấm lại lúc đang xanh mở popup xác nhận riêng "muốn
 * gửi lại?".
 */
export function SendClientEmailButton({
  caseId,
  refunds,
  taxIntByYear,
  clientEmailSentAt,
  confirm,
  alertWarn,
  previewRefundEmail,
  sendClientEmail,
  markClientEmailSent,
  connectWebmailAccount,
}: {
  caseId: string;
  refunds: Record<string, number>;
  taxIntByYear: Record<string, string>;
  clientEmailSentAt: string | null;
  confirm: (message: string, opts?: { title?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  alertWarn: (message: string, opts?: { title?: string }) => Promise<void>;
  previewRefundEmail: (
    caseId: string,
    payload: { years: string[]; language: Language; taxInt: Record<string, string> }
  ) => Promise<PreviewResult>;
  sendClientEmail: (
    caseId: string,
    payload: {
      years: string[];
      taxInt: Record<string, string>;
      subject: string;
      bodyHtml: string;
      to: string[];
      cc: string[];
      attachments?: Attachment[];
    }
  ) => Promise<SendResult>;
  markClientEmailSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
  connectWebmailAccount: (email: string, password: string) => Promise<ConnectResult>;
}) {
  const sent = Boolean(clientEmailSentAt);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [taxIntDraft, setTaxIntDraft] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState<Language>("vi");
  const [editorNonce, setEditorNonce] = useState(0);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [composeError, setComposeError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  function toggleYear(year: string) {
    setSelectedYears((prev) => (prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]));
    if (!(year in taxIntDraft)) {
      setTaxIntDraft((prev) => ({ ...prev, [year]: taxIntByYear[year] ?? "" }));
    }
  }

  function openPicker() {
    setSelectedYears([]);
    setTaxIntDraft({ ...taxIntByYear });
    setLanguage("vi");
    setPickerOpen(true);
  }

  async function handleTriggerClick() {
    if (sent) {
      const confirmed = await confirm(t("refundEmail.resendConfirm"), { title: t("refundEmail.resendTitle") });
      if (!confirmed) return;
      await markClientEmailSent(caseId, "clear");
      return;
    }
    openPicker();
  }

  /** Bấm "Confirm" ở popup chọn năm — dựng sẵn Subject/Nội dung/To/Cc rồi mở màn hình soạn
   * mail, KHÔNG gửi gì cả ở bước này. */
  async function handleConfirmYears() {
    if (selectedYears.length === 0) return;
    const taxInt: Record<string, string> = {};
    for (const year of selectedYears) taxInt[year] = taxIntDraft[year] ?? "";
    setPreviewing(true);
    try {
      const result = await previewRefundEmail(caseId, { years: selectedYears, language, taxInt });
      if (!result.ok) {
        await alertWarn(result.error, { title: t("refundEmail.previewErrorTitle") });
        return;
      }
      setSubject(result.subject);
      setBodyHtml(result.bodyHtml);
      setTo(result.to.join(", "));
      setCc(result.cc.join(", "));
      setFiles([]);
      setComposeError("");
      setEditorNonce((n) => n + 1);
      setPickerOpen(false);
      setComposeOpen(true);
    } finally {
      setPreviewing(false);
    }
  }

  /** Đánh dấu "Đã gửi" thủ công ngay từ popup chọn năm — dùng khi đã gửi qua đường khác,
   * KHÔNG dựng/gửi mail thật. */
  async function markAsSent() {
    setPickerOpen(false);
    await markClientEmailSent(caseId, "manual");
  }

  function handleFilePick(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const nextFiles = [...files, ...Array.from(picked)];
    const nextTotal = nextFiles.reduce((sum, f) => sum + f.size, 0);
    if (nextTotal > MAX_TOTAL_ATTACHMENT_BYTES) {
      setComposeError(t("cpaEmail.fileTooLarge", { max: formatBytes(MAX_TOTAL_ATTACHMENT_BYTES) }));
      return;
    }
    setComposeError("");
    setFiles(nextFiles);
  }

  function removeFile(idx: number) {
    setFiles((list) => list.filter((_, i) => i !== idx));
  }

  async function attemptSend() {
    const toList = splitEmails(to);
    if (toList.length === 0) {
      setComposeError(t("cpaEmail.missingRecipient"));
      return;
    }
    const ccList = splitEmails(cc);
    const taxInt: Record<string, string> = {};
    for (const year of selectedYears) taxInt[year] = taxIntDraft[year] ?? "";
    setSending(true);
    setComposeError("");
    try {
      const attachments: Attachment[] = await Promise.all(
        files.map(async (file) => {
          const dataUrl = await fileToDataUrl(file);
          const base64 = dataUrl.split(",")[1] ?? "";
          return { filename: file.name, contentType: file.type || "application/octet-stream", contentBase64: base64 };
        })
      );
      const result = await sendClientEmail(caseId, {
        years: selectedYears,
        taxInt,
        subject,
        bodyHtml,
        to: toList,
        cc: ccList,
        attachments,
      });
      if (!result.ok) {
        if (result.needsWebmailAuth) {
          // Đóng màn hình soạn mail TRƯỚC khi mở ConnectWebmailDialog — dialog đó không
          // portal ra document.body và có z-index thấp hơn (z-50 so với z-[100] của màn
          // hình soạn mail), nên nếu để cả 2 cùng mở, ConnectWebmailDialog bị che khuất
          // hoàn toàn phía sau, người dùng bấm "Gửi" không thấy gì xảy ra (trông như lỗi).
          setComposeOpen(false);
          setConnectOpen(true);
          return;
        }
        await alertWarn(result.error, { title: t("clientEmail.sendErrorTitle") });
        return;
      }
      setComposeOpen(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleTriggerClick}
        disabled={previewing}
        title={sent ? t("refundEmail.sentTitle") : t("clientProfile.sendEmailBtn")}
        aria-label={sent ? t("refundEmail.sentTitle") : t("clientProfile.sendEmailBtn")}
        className={`ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition disabled:cursor-default disabled:opacity-60 ${
          sent
            ? "border-green-600/70 bg-green-800/60 text-green-100 hover:bg-green-800/80 light:border-green-700 light:bg-green-600 light:text-white light:hover:bg-green-700"
            : "border-orange-700/60 bg-orange-900/40 text-orange-200 hover:bg-orange-900/60 light:border-orange-400 light:bg-orange-100 light:text-orange-900 light:hover:bg-orange-200"
        }`}
      >
        {/* Luôn giữ nguyên icon chim/phong bì (không đổi thành dấu tick khi đã gửi, giống
            3 nút Send còn lại trong cùng cột — chỉ nền/viền nút đổi màu xanh) — icon 11x11
            cố định trong nút nhỏ, không cần next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mail-client-icon.png" alt="" width={11} height={11} className="object-contain" />
      </button>

      {pickerOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-sm flex-col rounded-2xl p-5 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("refundEmail.pickerTitle")}</h3>
                <button onClick={() => setPickerOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="overflow-y-auto">
                <div className="mb-3 flex gap-2">
                  {(["vi", "en"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setLanguage(lang)}
                      className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        language === lang
                          ? "border-accent bg-accent-soft text-text"
                          : "border-border bg-bg-elevated text-text-dim hover:border-accent"
                      }`}
                    >
                      {lang === "vi" ? t("refundEmail.langVi") : t("refundEmail.langEn")}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {REFUND_YEARS.map((year) => {
                    const selected = selectedYears.includes(year);
                    return (
                      <div key={year} className="flex flex-col gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleYear(year)}
                          className={`flex flex-col items-center gap-0.5 rounded-lg border px-3 py-2.5 transition ${
                            selected
                              ? "border-accent bg-accent-soft"
                              : "border-border bg-bg-elevated hover:border-accent hover:bg-accent-soft"
                          }`}
                        >
                          <span className="text-sm font-semibold">{year}</span>
                          <span
                            className={`text-xs ${
                              selected ? "font-semibold text-amber-600 light:text-amber-700" : "text-text-dim"
                            }`}
                          >
                            ${(refunds?.[year] ?? 0).toLocaleString("en-US")}
                          </span>
                        </button>
                        {/* Tax INT hiện NGAY DƯỚI năm vừa chọn, bôi màu nổi bật để phân biệt
                            với ô năm phía trên (thay vì gộp chung 1 danh sách dưới cùng như
                            thiết kế cũ). */}
                        {selected && (
                          <div className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-1.5 light:border-amber-400 light:bg-amber-50">
                            <label className="block text-[10px] font-medium text-amber-700 light:text-amber-800">
                              {t("refundEmail.taxIntLabel", { year })}
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={taxIntDraft[year] ?? ""}
                              onChange={(e) =>
                                setTaxIntDraft((prev) => ({ ...prev, [year]: e.target.value.replace(/[^\d.]/g, "") }))
                              }
                              placeholder="0"
                              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-2 py-1 text-xs text-text outline-none focus:border-accent"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={handleConfirmYears}
                disabled={selectedYears.length === 0 || previewing}
                className="gradient-btn mt-3 w-full rounded-lg py-1.5 text-xs font-medium text-white disabled:cursor-default disabled:opacity-50"
              >
                {previewing ? t("refundEmail.sending") : t("common.confirm")}
              </button>
              <button
                type="button"
                onClick={markAsSent}
                className="mt-1.5 w-full rounded-lg border border-green-600/50 bg-green-800/20 py-1.5 text-xs font-medium text-green-300 transition hover:bg-green-800/40 light:border-green-600 light:bg-green-50 light:text-green-700 light:hover:bg-green-100"
              >
                {t("refundEmail.markSentBtn")}
              </button>
            </div>
          </div>,
          document.body
        )}

      {composeOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-lg flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("refundEmail.composeTitle")}</h3>
                <button onClick={() => setComposeOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5">
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("cpaEmail.toLabel")}</label>
                  <input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="client@example.com"
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("cpaEmail.ccLabel")}</label>
                  <input
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="manager@example.com"
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("refundEmail.subjectLabel")}</label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("refundEmail.bodyLabel")}</label>
                  <MailBodyEditor key={editorNonce} value={bodyHtml} onChange={setBodyHtml} language={language} />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("cpaEmail.attachLabel")}</label>
                  <div className="flex flex-col gap-1.5">
                    {files.map((file, idx) => (
                      <div
                        key={`${file.name}-${idx}`}
                        className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs"
                      >
                        <Paperclip size={12} className="shrink-0 text-text-faint" />
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        <span className="shrink-0 text-text-faint">{formatBytes(file.size)}</span>
                        <button
                          type="button"
                          onClick={() => removeFile(idx)}
                          className="shrink-0 text-text-faint hover:text-red-400"
                          aria-label={t("cpaEmail.removeAttachment")}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong px-3 py-1.5 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text"
                    >
                      <Paperclip size={12} />
                      {t("cpaEmail.attachBtn")}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handleFilePick(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    {totalBytes > 0 && (
                      <span className="text-[10px] text-text-faint">
                        {formatBytes(totalBytes)} / {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {composeError && (
                <div className="mx-5 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 light:text-red-700">
                  {composeError}
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2 px-5 pb-5">
                <button
                  onClick={() => setComposeOpen(false)}
                  className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={attemptSend}
                  disabled={sending || !subject.trim()}
                  className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white disabled:cursor-default disabled:opacity-60"
                >
                  {sending ? t("refundEmail.sending") : t("refundEmail.sendBtn")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <ConnectWebmailDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        connectWebmailAccount={connectWebmailAccount}
        onConnected={() => {
          setConnectOpen(false);
          void attemptSend();
        }}
      />

      <SendingProgressToast show={previewing || sending} label={t("refundEmail.sending")} />
    </>
  );
}
