"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Bot, X, Send } from "lucide-react";
import { Spinner } from "@/components/spinner";
import { useT } from "@/lib/i18n";

/** 1 tin nhắn trong state UI (chat KHÔNG lưu DB — mất khi đóng popup/reload, giống chat "So
 * sánh WIT/1040/TTS" ở `crm-tts-wit-check-button.tsx`). */
type ChatEntry = { role: "user" | "assistant"; text: string };

export type AskAiChatFn = (payload: {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
}) => Promise<{ ok: true; reply: string } | { ok: false; error: string }>;

/**
 * Nút "Trợ lý AI" trên toolbar bảng Hồ sơ, đặt NGAY TRƯỚC nút "My Notes" (thêm 2026-08-27) —
 * chat AI TỰ DO dùng Gemini API free tier (KHÔNG lưu DB, không gắn với hồ sơ/CRM nào, khác hẳn
 * chat "So sánh WIT/1040/TTS" trong popup "Get Files" vốn CHỈ trả lời trong phạm vi tài liệu đã
 * chọn của 1 hồ sơ — xem `crm-tts-wit-check-button.tsx`/`crm-doc-compare.ts`). Cho MỌI role,
 * không cần feature permission riêng (giống `MyNotesDialog`) vì không đọc/ghi dữ liệu hồ sơ
 * nào. Cùng model + cùng đánh đổi dữ liệu-bị-dùng-để-train đã người dùng xác nhận cho tính năng
 * CRM (free tier) — xem `src/lib/gemini-general-chat.ts`.
 */
export function AiChatDialog({ onAsk }: { onAsk: AskAiChatFn }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const t = useT();

  // Câu hỏi/trả lời KHÔNG lưu DB (route /api/ai-chat không ghi gì) — nhưng component vẫn giữ
  // nguyên mount trên toolbar nên state React sẽ tồn tại xuyên suốt phiên trình duyệt nếu
  // không tự dọn. Xoá sạch mỗi khi đóng popup (thêm 2026-08-27 theo yêu cầu "xóa sau khi hết
  // phiên làm việc để không ảnh hưởng dung lượng lưu trữ") — 1 lượt mở/đóng popup = 1 "phiên"
  // hỏi-đáp, mở lại luôn bắt đầu từ đầu, không cộng dồn vô thời hạn trong bộ nhớ trình duyệt.
  function closeDialog() {
    setOpen(false);
    setMessages([]);
    setDraft("");
    setError("");
  }

  async function handleSend() {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    setError("");
    setSending(true);
    const history = messages.slice(-20).map((m) => ({ role: m.role, content: m.text }));
    setMessages((prev) => [...prev, { role: "user", text: message }]);
    try {
      const res = await onAsk({ message, history });
      if (res.ok) {
        setMessages((prev) => [...prev, { role: "assistant", text: res.reply }]);
      } else {
        setError(res.error);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t("aiChat.button")}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <Bot size={14} />
        {t("aiChat.button")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-4" onClick={closeDialog}>
            <div
              className="popover flex h-[85vh] w-full max-w-lg flex-col rounded-2xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("aiChat.title")}</h3>
                <button onClick={closeDialog} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={16} />
                </button>
              </div>
              <p className="mt-1 px-5 text-xs text-text-faint">{t("aiChat.hint")}</p>

              <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5">
                {messages.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-center text-xs text-text-faint">{t("aiChat.emptyState")}</div>
                ) : (
                  messages.map((m, i) =>
                    m.role === "user" ? (
                      <div
                        key={i}
                        className="self-end whitespace-pre-wrap rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs leading-relaxed text-text"
                      >
                        {m.text}
                      </div>
                    ) : (
                      <div
                        key={i}
                        className="self-start whitespace-pre-wrap rounded-lg bg-bg-elevated px-2.5 py-1.5 text-xs leading-relaxed text-text"
                      >
                        {m.text}
                      </div>
                    )
                  )
                )}
                {sending && (
                  <div className="self-start rounded-lg bg-bg-elevated px-2.5 py-1.5 text-xs text-text-faint">
                    <Spinner size={12} />
                  </div>
                )}
              </div>

              {error && (
                <div className="mx-5 mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300 light:text-red-700">
                  {error}
                </div>
              )}

              <div className="mt-3 flex items-center gap-1.5 px-5 pb-5">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={t("aiChat.placeholder")}
                  disabled={sending}
                  className="h-9 flex-1 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-faint disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !draft.trim()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition hover:opacity-90 disabled:cursor-default disabled:opacity-40"
                  aria-label={t("aiChat.send")}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
