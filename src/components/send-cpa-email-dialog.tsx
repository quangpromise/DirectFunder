"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, X, Paperclip, AlertCircle, CheckCircle2 } from "lucide-react";
import { CaseRecord, CpaEmailDefaults } from "@/lib/types";
import { fileToDataUrl } from "@/lib/file-to-data-url";
import {
  buildTemplateVars,
  renderCpaEmailTemplate,
  DEFAULT_BODY_TEMPLATE,
  DEFAULT_SUBJECT_TEMPLATE,
} from "@/lib/cpa-email-template";
import { useT, useLanguage } from "@/lib/i18n";
import { MailBodyEditor } from "@/components/mail-body-editor";

const MAX_TOTAL_ATTACHMENT_BYTES = 4 * 1024 * 1024;

type SendResult = { ok: true } | { ok: false; error: string };
type SendPayload = {
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; contentType: string; contentBase64: string }[];
};

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
 * Icon trong cột Status (chỉ hiện khi status = cpa_review) — mở popup soạn + gửi email
 * cho CPA qua Gmail SMTP. To/Cc mặc định lấy từ cấu hình chung (Admin sửa ở trang Phân
 * quyền), Subject/Nội dung tự do chỉnh, đính kèm nhiều file. Gửi là hành động foreground
 * có thể fail rõ ràng — KHÔNG optimistic, chờ kết quả thật từ server (xem sendCpaEmail
 * trong app-store.ts) trước khi báo thành công/lỗi. "Đã gửi hay chưa" (`justSent`) tính
 * THẲNG từ `caseRecord.cpaEmailSentAt` (server lưu xuống DB khi gửi thật/Mark as sent
 * thành công) chứ KHÔNG dùng local useState nữa — nhờ vậy trạng thái xanh giữ nguyên qua
 * reload/deploy lại (trước đây chỉ ở React state nên F5 là mất). Dialog còn có nút phụ
 * "Mark as sent" (markCpaEmailSent) cạnh nút "Gửi" — dùng khi đã gửi thủ công qua đường
 * khác, chỉ lưu cpaEmailSentAt mà KHÔNG gọi onSend thật.
 */
export function SendCpaEmailDialog({
  disabled,
  caseRecord,
  defaults,
  statusLabel,
  senderEmail,
  senderName,
  confirm,
  onSend,
  markCpaEmailSent,
}: {
  disabled: boolean;
  caseRecord: CaseRecord;
  defaults: CpaEmailDefaults;
  statusLabel: string;
  senderEmail: string;
  senderName: string;
  confirm: (message: string, opts?: { title?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  onSend: (payload: SendPayload) => Promise<SendResult>;
  markCpaEmailSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
}) {
  const justSent = Boolean(caseRecord.cpaEmailSentAt);
  const [open, setOpen] = useState(false);
  const [editorNonce, setEditorNonce] = useState(0);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = useT();
  const { language } = useLanguage();

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  async function handleTriggerClick() {
    if (justSent) {
      const confirmed = await confirm(t("cpaEmail.confirmResend"), { title: t("cpaEmail.confirmResendTitle") });
      if (!confirmed) return;
      await markCpaEmailSent(caseRecord.id, "clear");
      return;
    }
    openDialog();
  }

  function openDialog() {
    const vars = buildTemplateVars(caseRecord, statusLabel, senderEmail, senderName);
    const subjectTemplate = defaults.subjectTemplate?.trim() || DEFAULT_SUBJECT_TEMPLATE;
    const bodyTemplate = defaults.bodyTemplate?.trim() || DEFAULT_BODY_TEMPLATE;
    setTo(defaults.to.join(", "));
    setCc(defaults.cc.join(", "));
    setSubject(renderCpaEmailTemplate(subjectTemplate, vars));
    setBodyHtml(renderCpaEmailTemplate(bodyTemplate, vars));
    setFiles([]);
    setError("");
    setEditorNonce((n) => n + 1);
    setOpen(true);
  }

  function handleFilePick(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const nextFiles = [...files, ...Array.from(picked)];
    const nextTotal = nextFiles.reduce((sum, f) => sum + f.size, 0);
    if (nextTotal > MAX_TOTAL_ATTACHMENT_BYTES) {
      setError(t("cpaEmail.fileTooLarge", { max: formatBytes(MAX_TOTAL_ATTACHMENT_BYTES) }));
      return;
    }
    setError("");
    setFiles(nextFiles);
  }

  function removeFile(idx: number) {
    setFiles((list) => list.filter((_, i) => i !== idx));
  }

  /** Đánh dấu "Đã gửi" thủ công — dùng khi CPA/Processor đã tự gửi mail qua đường khác
   * (không qua dialog này) và chỉ muốn UI phản ánh đúng trạng thái, KHÔNG gọi API gửi mail
   * thật (onSend). Vẫn đi vào đúng vòng lặp xác nhận gửi lại như khi gửi thật (bấm lại lúc
   * đang xanh -> hỏi "muốn gửi lại?" -> đồng ý mới quay về mặc định). */
  async function markAsSent() {
    setOpen(false);
    await markCpaEmailSent(caseRecord.id, "manual");
  }

  async function handleSend() {
    const toList = splitEmails(to);
    const ccList = splitEmails(cc);
    if (toList.length === 0) {
      setError(t("cpaEmail.missingRecipient"));
      return;
    }
    if (!subject.trim()) {
      setError(t("cpaEmail.missingSubject"));
      return;
    }
    setSending(true);
    setError("");
    try {
      const attachments = await Promise.all(
        files.map(async (file) => {
          const dataUrl = await fileToDataUrl(file);
          const base64 = dataUrl.split(",")[1] ?? "";
          return { filename: file.name, contentType: file.type || "application/octet-stream", contentBase64: base64 };
        })
      );
      // Editor giữ HTML trong state qua onChange; text fallback lấy từ chính đoạn HTML
      // (đủ dùng — email client không đọc được HTML sẽ thấy văn bản thô, không cần bản
      // plain-text tách biệt hoàn hảo).
      const text = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const result = await onSend({ to: toList, cc: ccList, subject: subject.trim(), html: bodyHtml, text, attachments });
      if (result.ok) {
        setOpen(false);
      } else {
        setError(result.error);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={handleTriggerClick}
        title={justSent ? t("cpaEmail.sentHint") : t("cpaEmail.button")}
        aria-label={justSent ? t("cpaEmail.sentHint") : t("cpaEmail.button")}
        className={`ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition disabled:cursor-default disabled:opacity-60 ${
          justSent
            ? "border-green-600/70 bg-green-800/60 text-green-100 hover:bg-green-800/80 light:border-green-700 light:bg-green-600 light:text-white light:hover:bg-green-700"
            : "border-orange-700/60 bg-orange-900/40 text-orange-200 hover:bg-orange-900/60 light:border-orange-400 light:bg-orange-100 light:text-orange-900 light:hover:bg-orange-200"
        }`}
      >
        {justSent ? <CheckCircle2 size={11} /> : <Mail size={11} />}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-lg flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("cpaEmail.dialogTitle")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5">
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("cpaEmail.toLabel")}</label>
                  <input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="cpa1@example.com, cpa2@example.com"
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
                  <label className="mb-1 block text-xs text-text-dim">{t("cpaEmail.subjectLabel")}</label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("cpaEmail.bodyLabel")}</label>
                  <MailBodyEditor
                    key={editorNonce}
                    value={bodyHtml}
                    onChange={setBodyHtml}
                    language={language}
                  />
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

              {error && (
                <div className="mx-5 mt-3 flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 light:text-red-700">
                  <AlertCircle size={13} className="shrink-0" />
                  {error}
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2 px-5 pb-5">
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={markAsSent}
                  disabled={sending}
                  className="rounded-lg border border-green-600/50 bg-green-800/20 px-3.5 py-2 text-sm font-medium text-green-300 transition hover:bg-green-800/40 disabled:cursor-default disabled:opacity-60 light:border-green-600 light:bg-green-50 light:text-green-700 light:hover:bg-green-100"
                >
                  {t("cpaEmail.markSentBtn")}
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white disabled:cursor-default disabled:opacity-60"
                >
                  {sending ? t("cpaEmail.sending") : t("cpaEmail.sendBtn")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
