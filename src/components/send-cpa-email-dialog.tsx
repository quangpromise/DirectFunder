"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { upload } from "@vercel/blob/client";
import { Mail, X, Paperclip, AlertCircle, Loader2, Search } from "lucide-react";
import { CaseRecord, CpaEmailDefaults } from "@/lib/types";
import { fileToDataUrl } from "@/lib/file-to-data-url";
import {
  buildTemplateVars,
  renderCpaEmailTemplate,
  DEFAULT_BODY_TEMPLATE,
} from "@/lib/cpa-email-template";
import { REFUND_YEARS } from "@/lib/refund";
import { primarySsn } from "@/lib/client-name";
import { useT, useLanguage } from "@/lib/i18n";
import { MailBodyEditor } from "@/components/mail-body-editor";

// Tổng đính kèm tối đa 20MB (đủ rộng cho hầu hết file CPA thật, vẫn có margin dưới giới hạn
// đính kèm thật ~25MB của Gmail). Dưới ngưỡng nhỏ SMALL_ATTACHMENT_THRESHOLD_BYTES gửi thẳng
// base64 trong JSON body (không phụ thuộc Vercel Blob) — trên ngưỡng đó mới upload qua Blob
// (né giới hạn ~4.5MB thân request của Serverless Function, xem .claude/skills/
// vercel-blob-large-upload/SKILL.md). Chọn nhánh nào KHÔNG đổi trải nghiệm người dùng, chỉ
// khác cách server nhận file — nhưng đảm bảo phần lớn email (đính kèm nhỏ) vẫn gửi được ngay
// cả khi Vercel Blob gặp sự cố/chạm hạn mức free (Hobby: khoá 30 ngày khi vượt hạn mức, xem
// deployment-database-sync.md mục 4.32).
//
// QUAN TRỌNG: ngưỡng này so với DUNG LƯỢNG GỐC của file, nhưng base64 encode làm phình thêm
// ~33% (n bytes -> ~n*4/3 ký tự) khi nhét vào JSON body — nếu để ngưỡng sát 4MB, 1 file gốc
// 3.5MB sẽ tạo ra body base64 ~4.67MB, VƯỢT giới hạn cứng ~4.5MB của Vercel Serverless
// Function -> lỗi 413 (đã gặp thật trên production 2026-08-20, hồ sơ Thanh Nguyen, file
// 3.5MB). Hạ ngưỡng xuống 2.5MB gốc (~3.33MB sau base64 + overhead JSON khác) để còn nhiều
// margin an toàn dưới mốc 4.5MB.
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const SMALL_ATTACHMENT_THRESHOLD_BYTES = 2.5 * 1024 * 1024;

type SendResult = { ok: true } | { ok: false; error: string };
type SendAttachment =
  | { filename: string; contentType: string; blobUrl: string }
  | { filename: string; contentType: string; contentBase64: string };
type SendPayload = {
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  text: string;
  attachments: SendAttachment[];
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
  lookupCpaReviewRow,
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
  lookupCpaReviewRow: (ssn: string) => Promise<{ found: boolean; rowNumber?: number }>;
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
  const [uploadStatus, setUploadStatus] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = useT();
  const { language } = useLanguage();

  // Popup chọn năm gửi (thêm 2026-08-22) — mở TRƯỚC popup soạn mail, quyết định Subject
  // "[EC {năm viết tắt}]" (vd chọn 25 -> "[EC 25]", chọn 23/24/25 -> "[EC 23-24-25]") và
  // điền số row trên tab CPA Review ({cpaReviewRow}) vào nội dung mail. Cùng UI grid chọn
  // năm với TestSheetButton (test-sheet-button.tsx) để nhất quán trải nghiệm.
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [yearSearch, setYearSearch] = useState("");
  const [lookingUpRow, setLookingUpRow] = useState(false);

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  function toggleYear(year: string) {
    setSelectedYears((prev) => (prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]));
  }

  const filteredYears = yearSearch.trim()
    ? REFUND_YEARS.filter((y) => y.includes(yearSearch.trim()))
    : REFUND_YEARS;

  async function handleTriggerClick() {
    if (justSent) {
      const confirmed = await confirm(t("cpaEmail.confirmResend"), { title: t("cpaEmail.confirmResendTitle") });
      if (!confirmed) return;
      await markCpaEmailSent(caseRecord.id, "clear");
      return;
    }
    setSelectedYears([]);
    setYearSearch("");
    setYearPickerOpen(true);
  }

  async function confirmYears() {
    if (selectedYears.length === 0) return;
    setYearPickerOpen(false);
    setLookingUpRow(true);
    let cpaReviewRow = "";
    try {
      const ssn = primarySsn(caseRecord);
      if (ssn) {
        const result = await lookupCpaReviewRow(ssn);
        if (result.found && result.rowNumber) cpaReviewRow = String(result.rowNumber);
      }
    } finally {
      setLookingUpRow(false);
    }
    openDialog(selectedYears, cpaReviewRow);
  }

  function openDialog(years: string[], cpaReviewRow: string) {
    const vars = buildTemplateVars(caseRecord, statusLabel, senderEmail, senderName, cpaReviewRow);
    const bodyTemplate = defaults.bodyTemplate?.trim() || DEFAULT_BODY_TEMPLATE;
    const yearsAbbrev = years.map((y) => y.slice(-2)).join("-");
    setTo(defaults.to.join(", "));
    setCc(defaults.cc.join(", "));
    setSubject(`[EC ${yearsAbbrev}]`);
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
      // Dưới ngưỡng nhỏ -- gửi thẳng base64 trong JSON body, KHÔNG phụ thuộc Vercel Blob (xem
      // SMALL_ATTACHMENT_THRESHOLD_BYTES ở đầu file: đa số email CPA có đính kèm nhỏ, giữ
      // đường base64 cũ cho nhánh này vừa đỡ tốn quota Blob vừa tự chịu được nếu Blob gặp sự
      // cố/chạm hạn mức free). Trên ngưỡng đó mới upload qua Blob (né giới hạn ~4.5MB thân
      // request Serverless Function).
      const attachments: SendAttachment[] = [];
      if (totalBytes <= SMALL_ATTACHMENT_THRESHOLD_BYTES) {
        for (const file of files) {
          const dataUrl = await fileToDataUrl(file);
          const contentBase64 = dataUrl.split(",")[1] ?? "";
          attachments.push({ filename: file.name, contentType: file.type || "application/octet-stream", contentBase64 });
        }
      } else {
        setUploadStatus(files.length > 0 ? { done: 0, total: files.length } : null);
        for (const file of files) {
          const blob = await upload(file.name, file, {
            access: "public",
            handleUploadUrl: "/api/cpa-email/blob-upload",
          });
          attachments.push({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            blobUrl: blob.url,
          });
          setUploadStatus((s) => (s ? { done: s.done + 1, total: s.total } : s));
        }
        setUploadStatus(null);
      }
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
    } catch (err) {
      // upload() (tải file đính kèm lên Vercel Blob) có thể thất bại vì lỗi mạng -- khác
      // fileToDataUrl (đọc file local, gần như không bao giờ lỗi) trước đây không cần catch.
      setError(err instanceof Error ? err.message : t("cpaEmail.attachmentUploadFailed"));
    } finally {
      setUploadStatus(null);
      setSending(false);
    }
  }

  return (
    <div className="shrink-0">
      <button
        type="button"
        disabled={disabled || lookingUpRow}
        onClick={handleTriggerClick}
        title={justSent ? t("cpaEmail.sentHint") : t("cpaEmail.button")}
        aria-label={justSent ? t("cpaEmail.sentHint") : t("cpaEmail.button")}
        className={`ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition disabled:cursor-default disabled:opacity-60 ${
          justSent
            ? "border-green-600/70 bg-green-800/60 text-green-100 hover:bg-green-800/80 light:border-green-700 light:bg-green-600 light:text-white light:hover:bg-green-700"
            : "border-orange-700/60 bg-orange-900/40 text-orange-200 hover:bg-orange-900/60 light:border-orange-400 light:bg-orange-100 light:text-orange-900 light:hover:bg-orange-200"
        }`}
      >
        {lookingUpRow ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
      </button>

      {yearPickerOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("cpaEmail.yearPickerTitle")}</h3>
                <button onClick={() => setYearPickerOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="relative mb-2">
                <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
                <input
                  value={yearSearch}
                  onChange={(e) => setYearSearch(e.target.value)}
                  placeholder={t("testSheet.yearSearchPlaceholder")}
                  className="w-full rounded-md border border-border bg-bg-elevated py-1 pl-6 pr-2 text-xs outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                {filteredYears.map((year) => {
                  const selected = selectedYears.includes(year);
                  return (
                    <button
                      key={year}
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
                        ${(caseRecord.refunds?.[year] ?? 0).toLocaleString("en-US")}
                      </span>
                    </button>
                  );
                })}
                {filteredYears.length === 0 && (
                  <div className="col-span-2 py-2 text-center text-xs text-text-faint">{t("assign.noMatching")}</div>
                )}
              </div>

              <p className="mt-3 text-xs text-text-faint">
                {t("cpaEmail.yearPickerSubjectPreview", {
                  subject: selectedYears.length > 0 ? `[EC ${selectedYears.map((y) => y.slice(-2)).join("-")}]` : "—",
                })}
              </p>

              <button
                type="button"
                onClick={confirmYears}
                disabled={selectedYears.length === 0}
                className="gradient-btn mt-3 w-full rounded-lg py-1.5 text-xs font-medium text-white disabled:cursor-default disabled:opacity-50"
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>,
          document.body
        )}

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

              {uploadStatus && (
                <div className="mx-5 mt-3 flex items-center gap-1.5 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-dim">
                  <Loader2 size={13} className="shrink-0 animate-spin" />
                  {t("cpaEmail.uploadingAttachments", { done: uploadStatus.done, total: uploadStatus.total })}
                </div>
              )}

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
