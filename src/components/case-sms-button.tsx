"use client";

import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { createPortal } from "react-dom";
import { FileText, ImageIcon, MessageCircle, Send, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { SmsMessageRecord } from "@/lib/types";
import { REFUND_YEARS } from "@/lib/refund";
import { buildTaxIntShortfallSms, type SmsTemplateLanguage } from "@/lib/sms-templates";
import { fileToDataUrl } from "@/lib/file-to-data-url";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * Icon nhắn tin SMS (RingCentral, thêm 2026-08-17) — đặt NGAY DƯỚI icon Send Data cạnh
 * Status (xem cases/page.tsx), nhấp nháy đỏ khi hồ sơ có tin nhắn "in" (khách nhắn tới)
 * CHƯA đọc (`row.hasUnreadSms`, tính server-side khớp theo số điện thoại — xem GET
 * /api/cases). Bấm mở popup dạng chat đơn giản: danh sách bong bóng tin nhắn + ô nhập gửi.
 * Dùng CHUNG 1 số điện thoại công ty cho mọi user (server-to-server JWT, không phải OAuth
 * theo từng user như webmail) — xem src/lib/ringcentral.ts.
 */
export function CaseSmsButton({
  caseId,
  phone,
  hasUnreadSms,
  taxpayerName,
  agentName,
  userName,
  alertWarn,
  fetchSmsThread,
  sendSmsMessage,
  sendSmsImage,
  markSmsThreadRead,
}: {
  caseId: string;
  phone: string;
  hasUnreadSms: boolean;
  taxpayerName: string;
  agentName: string;
  userName: string;
  alertWarn: (message: string, opts?: { title?: string }) => Promise<void>;
  fetchSmsThread: (caseId: string) => Promise<SmsMessageRecord[]>;
  sendSmsMessage: (caseId: string, text: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  sendSmsImage: (
    caseId: string,
    payload: { contentBase64: string; contentType: string; filename: string; caption?: string }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  markSmsThreadRead: (caseId: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SmsMessageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const hasPhone = phone.trim().length > 0;

  // Ảnh dán vào (Ctrl+V, thêm 2026-09-19) chờ gửi — CHỈ giữ tạm trong state trình duyệt
  // (object URL) tới khi bấm gửi. Bấm gửi xong, route .../sms/image ĐẨY ảnh đi qua RingCentral
  // rồi LƯU LẠI 1 dòng SmsMessage dạng text ("[Hình ảnh]" + caption nếu có, xem sendMmsToPhone)
  // — CHỈ byte ảnh là không lưu, tin nhắn vẫn lưu như SMS thường nên hiện lại đúng vị trí
  // trong thread lẫn hộp thư tổng hợp sau khi tải lại trang (fetchSmsThread bên dưới).
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);

  // Popup con "Chèn mẫu thiếu INT" (thêm 2026-09-19) — chọn ngôn ngữ + 1/nhiều năm + số tiền
  // INT riêng từng năm, dựng sẵn nội dung rồi CHÈN VÀO ô soạn (không tự gửi) để người dùng
  // sửa tự do trước khi bấm gửi thật.
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateLanguage, setTemplateLanguage] = useState<SmsTemplateLanguage>("vi");
  const [templateYears, setTemplateYears] = useState<string[]>([]);
  const [templateAmounts, setTemplateAmounts] = useState<Record<string, string>>({});

  function openTemplatePicker() {
    setTemplateLanguage("vi");
    setTemplateYears([]);
    setTemplateAmounts({});
    setTemplateOpen(true);
  }

  function toggleTemplateYear(year: string) {
    setTemplateYears((prev) => (prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]));
  }

  function insertTemplate() {
    if (templateYears.length === 0) return;
    const generated = buildTaxIntShortfallSms({
      taxpayerName,
      userName,
      agentName,
      years: templateYears,
      amounts: templateAmounts,
      language: templateLanguage,
    });
    setText(generated);
    setTemplateOpen(false);
  }

  // Nạp thread NGAY trong handler bấm mở (event handler thường, không phải useEffect) —
  // tránh lỗi lint "set-state-in-effect" (gọi setState đồng bộ ngay đầu thân effect) mà
  // vẫn có đúng hành vi "mở popup -> tự fetch", không cần theo dõi `open` qua dependency
  // array. markSmsThreadRead chỉ cần bắn nền, không chặn hiển thị.
  async function handleOpen() {
    if (!hasPhone) return;
    setOpen(true);
    setLoading(true);
    setPendingImage(null);
    try {
      const rows = await fetchSmsThread(caseId);
      setMessages(rows);
    } finally {
      setLoading(false);
    }
    if (hasUnreadSms) void markSmsThreadRead(caseId);
  }

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, messages]);

  function handlePasteImage(e: ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    if (file.size > MAX_IMAGE_BYTES) {
      void alertWarn(t("sms.imageTooLarge", { max: `${(MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(1)}MB` }), {
        title: t("sms.sendImageErrorTitle"),
      });
      return;
    }
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file) };
    });
  }

  function clearPendingImage() {
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (sending) return;
    if (!trimmed && !pendingImage) return;
    setSending(true);
    try {
      if (pendingImage) {
        const dataUrl = await fileToDataUrl(pendingImage.file);
        const base64 = dataUrl.split(",")[1] ?? "";
        const result = await sendSmsImage(caseId, {
          contentBase64: base64,
          contentType: pendingImage.file.type || "image/jpeg",
          filename: pendingImage.file.name || "image.jpg",
          caption: trimmed || undefined,
        });
        if (!result.ok) {
          await alertWarn(result.error, { title: t("sms.sendImageErrorTitle") });
          return;
        }
        URL.revokeObjectURL(pendingImage.previewUrl);
        setPendingImage(null);
        setText("");
        const rows = await fetchSmsThread(caseId);
        setMessages(rows);
        return;
      }
      const result = await sendSmsMessage(caseId, trimmed);
      if (!result.ok) {
        await alertWarn(result.error, { title: t("sms.sendErrorTitle") });
        return;
      }
      setText("");
      const rows = await fetchSmsThread(caseId);
      setMessages(rows);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={!hasPhone}
        title={hasPhone ? t("sms.buttonTitle") : t("sms.noPhone")}
        aria-label={t("sms.buttonTitle")}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-30 ${
          hasUnreadSms
            ? "sms-unread-pulse border-red-600/70 bg-red-900/40 text-red-300 light:border-red-400 light:bg-red-100 light:text-red-700"
            : "border-border bg-transparent text-text-faint hover:bg-surface-hover hover:text-text"
        }`}
      >
        <MessageCircle size={12} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4" onClick={() => setOpen(false)}>
            <div
              className="popover flex h-[70vh] w-full max-w-sm flex-col rounded-2xl p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold">
                  <MessageCircle size={15} className="shrink-0" />
                  <span className="truncate">
                    {t("sms.dialogTitle")} — {taxpayerName ? `${taxpayerName} · ${phone}` : phone}
                  </span>
                </h3>
                <button type="button" onClick={() => setOpen(false)} className="shrink-0 text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div ref={listRef} className="mt-3 flex-1 space-y-2 overflow-y-auto rounded-lg bg-bg-elevated/40 p-2">
                {loading && <p className="text-center text-xs text-text-faint">{t("common.loading")}</p>}
                {!loading && messages.length === 0 && <p className="text-center text-xs text-text-faint">{t("sms.empty")}</p>}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[80%] rounded-xl px-3 py-1.5 text-xs whitespace-pre-wrap break-words ${
                        m.direction === "out"
                          ? "gradient-btn text-white"
                          : "border border-border bg-surface text-text"
                      }`}
                    >
                      {m.text}
                      <div className={`mt-0.5 text-[10px] ${m.direction === "out" ? "text-white/70" : "text-text-faint"}`}>
                        {new Date(m.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={openTemplatePicker}
                className="mt-2 flex items-center gap-1.5 self-start rounded-lg border border-dashed border-border-strong px-2.5 py-1 text-[11px] text-text-dim transition hover:bg-surface-hover hover:text-text"
              >
                <FileText size={12} />
                {t("sms.templateBtn")}
              </button>

              {pendingImage && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-2 py-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- preview object URL cục bộ, không phải asset app */}
                  <img src={pendingImage.previewUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                  <span className="flex-1 truncate text-[11px] text-text-dim">{t("sms.pastedImageReady")}</span>
                  <button
                    type="button"
                    onClick={clearPendingImage}
                    aria-label={t("sms.removeImage")}
                    className="shrink-0 text-text-faint hover:text-red-400"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="mt-2 flex items-end gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={handlePasteImage}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={t("sms.placeholder")}
                  rows={2}
                  className="w-full flex-1 resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || (!text.trim() && !pendingImage)}
                  className="gradient-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white disabled:opacity-50"
                >
                  {pendingImage ? <ImageIcon size={15} /> : <Send size={15} />}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {templateOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 px-4" onClick={() => setTemplateOpen(false)}>
            <div className="popover flex max-h-full w-full max-w-sm flex-col rounded-2xl p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("sms.templateTitle")}</h3>
                <button type="button" onClick={() => setTemplateOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="overflow-y-auto">
                <div className="mb-3 flex gap-2">
                  {(["vi", "en"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setTemplateLanguage(lang)}
                      className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        templateLanguage === lang
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
                    const selected = templateYears.includes(year);
                    return (
                      <div key={year} className="flex flex-col gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleTemplateYear(year)}
                          className={`flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                            selected
                              ? "border-accent bg-accent-soft"
                              : "border-border bg-bg-elevated hover:border-accent hover:bg-accent-soft"
                          }`}
                        >
                          {year}
                        </button>
                        {selected && (
                          <div className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-1.5 light:border-amber-400 light:bg-amber-50">
                            <label className="block text-[10px] font-medium text-amber-700 light:text-amber-800">
                              {t("sms.templateIntLabel", { year })}
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={templateAmounts[year] ?? ""}
                              onChange={(e) =>
                                setTemplateAmounts((prev) => ({ ...prev, [year]: e.target.value.replace(/[^\d.]/g, "") }))
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
                onClick={insertTemplate}
                disabled={templateYears.length === 0}
                className="gradient-btn mt-3 w-full rounded-lg py-1.5 text-xs font-medium text-white disabled:cursor-default disabled:opacity-50"
              >
                {t("sms.templateInsertBtn")}
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
