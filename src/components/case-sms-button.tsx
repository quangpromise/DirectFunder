"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Send, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { SmsMessageRecord } from "@/lib/types";

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
  alertWarn,
  fetchSmsThread,
  sendSmsMessage,
  markSmsThreadRead,
}: {
  caseId: string;
  phone: string;
  hasUnreadSms: boolean;
  alertWarn: (message: string, opts?: { title?: string }) => Promise<void>;
  fetchSmsThread: (caseId: string) => Promise<SmsMessageRecord[]>;
  sendSmsMessage: (caseId: string, text: string) => Promise<{ ok: true } | { ok: false; error: string }>;
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

  // Nạp thread NGAY trong handler bấm mở (event handler thường, không phải useEffect) —
  // tránh lỗi lint "set-state-in-effect" (gọi setState đồng bộ ngay đầu thân effect) mà
  // vẫn có đúng hành vi "mở popup -> tự fetch", không cần theo dõi `open` qua dependency
  // array. markSmsThreadRead chỉ cần bắn nền, không chặn hiển thị.
  async function handleOpen() {
    if (!hasPhone) return;
    setOpen(true);
    setLoading(true);
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

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
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
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <MessageCircle size={15} />
                  {t("sms.dialogTitle")} — {phone}
                </h3>
                <button type="button" onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
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

              <div className="mt-3 flex items-end gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
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
                  disabled={sending || !text.trim()}
                  className="gradient-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white disabled:opacity-50"
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
