"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, ChevronLeft, Send, Trash2, X, Volume2, VolumeX } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useConfirm } from "@/components/confirm-dialog";
import { useLanguage, useT } from "@/lib/i18n";
import type { SmsConversationSummary, SmsMessageRecord } from "@/lib/types";

function timeAgo(iso: string, language: "vi" | "en"): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (language === "en") {
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} giờ trước`;
  return `${Math.floor(hrs / 24)} ngày trước`;
}

/**
 * Icon hộp thư tổng hợp SMS (RingCentral, thêm 2026-08-17) — đặt cạnh chuông thông báo
 * (top-nav.tsx), gộp MỌI cuộc hội thoại SMS (không chỉ theo 1 hồ sơ như CaseSmsButton).
 * Badge đỏ = tổng số tin nhắn "in" chưa đọc trên mọi cuộc hội thoại. Bấm vào 1 dòng mở
 * thẳng khung chat (xem/reply) NGAY TRONG dropdown này — không điều hướng rời trang, khác
 * NotificationBell (vốn nhảy tới hồ sơ liên quan).
 */
export function SmsInboxButton() {
  const [open, setOpen] = useState(false);
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<SmsMessageRecord[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const conversations = useAppStore((s) => s.smsConversations);
  const fetchSmsInbox = useAppStore((s) => s.fetchSmsInbox);
  const fetchSmsThreadByPhone = useAppStore((s) => s.fetchSmsThreadByPhone);
  const sendSmsByPhone = useAppStore((s) => s.sendSmsByPhone);
  const markSmsThreadReadByPhone = useAppStore((s) => s.markSmsThreadReadByPhone);
  const deleteSmsMessage = useAppStore((s) => s.deleteSmsMessage);
  const deleteSmsThread = useAppStore((s) => s.deleteSmsThread);
  const smsNotificationSoundMuted = useAppStore((s) => s.smsNotificationSoundMuted);
  const setSmsNotificationSoundMuted = useAppStore((s) => s.setSmsNotificationSoundMuted);
  const { language } = useLanguage();
  const t = useT();
  const { confirm, ConfirmDialogUI } = useConfirm();

  // Nạp ngay lúc mount (không đợi mở dropdown lần đầu) — để badge số chưa đọc hiện đúng
  // ngay khi vào dashboard, giống hành vi NotificationBell. fetchSmsInbox là store action
  // bất đồng bộ, setState thật sự xảy ra SAU await bên trong nó nên không vi phạm
  // react-hooks/set-state-in-effect (chỉ cấm gọi setState ĐỒNG BỘ ngay thân effect).
  useEffect(() => {
    void fetchSmsInbox();
  }, [fetchSmsInbox]);

  // Banner + âm thanh khi có tin nhắn "in" MỚI — cùng cơ chế NotificationBell (so sánh
  // lastMessageAt từng số với lần render trước, seenRef bắt đầu null nên KHÔNG tự bắn cho
  // dữ liệu đã có sẵn lúc mount, chỉ bắn cho tin thực sự mới tới sau đó qua fetchSmsInbox()
  // được gọi lại nhờ tín hiệu Pusher case:changed ở use-realtime.ts).
  const [toastConvo, setToastConvo] = useState<SmsConversationSummary | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const seenRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const current = new Map(conversations.map((c) => [c.counterpartNumber, c.lastMessageAt]));
    if (seenRef.current) {
      const prev = seenRef.current;
      const newIncoming = conversations.filter(
        (c) => c.lastMessageDirection === "in" && c.unreadCount > 0 && prev.get(c.counterpartNumber) !== c.lastMessageAt
      );
      // Tắt chuông (smsNotificationSoundMuted) = KHÔNG phát âm thanh VÀ KHÔNG hiện banner —
      // "chuông không hoạt động" đúng nghĩa, không chỉ im lặng mà vẫn hiện popup. Badge số
      // chưa đọc trên icon vẫn cập nhật bình thường (đó là bộ đếm, không phải "chuông").
      if (newIncoming.length > 0 && !smsNotificationSoundMuted) {
        const latest = newIncoming.reduce((a, b) => (a.lastMessageAt > b.lastMessageAt ? a : b));
        audioRef.current?.play().catch(() => {});
        if (!open) {
          setToastConvo(latest);
          if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
          toastTimeoutRef.current = setTimeout(() => setToastConvo(null), 10_000);
        }
      }
    }
    seenRef.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ theo dõi đổi của conversations, open/smsNotificationSoundMuted đọc giá trị mới nhất tại thời điểm effect chạy là đủ, không cần re-run riêng khi chúng đổi
  }, [conversations]);
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);
  const active = conversations.find((c) => c.counterpartNumber === activePhone) ?? null;

  async function handleToggleOpen() {
    const next = !open;
    setOpen(next);
    setActivePhone(null);
    if (next) await fetchSmsInbox();
  }

  async function openThread(convo: SmsConversationSummary) {
    setActivePhone(convo.counterpartNumber);
    setThreadLoading(true);
    try {
      const rows = await fetchSmsThreadByPhone(convo.counterpartNumber);
      setMessages(rows);
    } finally {
      setThreadLoading(false);
    }
    if (convo.unreadCount > 0) void markSmsThreadReadByPhone(convo.counterpartNumber);
  }

  useEffect(() => {
    if (activePhone) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [activePhone, messages]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || !activePhone || sending) return;
    setSending(true);
    try {
      const result = await sendSmsByPhone(activePhone, trimmed);
      if (result.ok) {
        setText("");
        const rows = await fetchSmsThreadByPhone(activePhone);
        setMessages(rows);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteMessage(messageId: string) {
    const ok = await confirm(t("smsInbox.deleteMessageConfirm"), { title: t("smsInbox.deleteMessageTitle"), tone: "danger" });
    if (!ok) return;
    await deleteSmsMessage(messageId);
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }

  async function handleDeleteAll() {
    if (!activePhone) return;
    await handleDeleteConversation(activePhone);
    setMessages([]);
    setActivePhone(null);
  }

  // Xoá TOÀN BỘ tin nhắn của 1 số điện thoại NGAY TỪ danh sách (không cần mở cuộc hội thoại
  // trước) — "chọn 1 số để xoá tất cả tin nhắn trên số đó", thêm theo yêu cầu 2026-08-17.
  async function handleDeleteConversation(phone: string) {
    const ok = await confirm(t("smsInbox.deleteAllConfirm"), { title: t("smsInbox.deleteAllTitle"), tone: "danger" });
    if (!ok) return;
    await deleteSmsThread(phone);
  }

  return (
    <div className="relative">
      <audio ref={audioRef} src="/notification-sound.mp3" preload="auto" />
      <button
        onClick={() => void handleToggleOpen()}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-dim transition hover:bg-surface-hover hover:text-text active:scale-95"
        aria-label={t("smsInbox.ariaLabel")}
        title={t("smsInbox.ariaLabel")}
      >
        <MessageCircle size={17} />
        {totalUnread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {totalUnread}
          </span>
        )}
      </button>

      {ConfirmDialogUI}

      {/* Banner tin nhắn mới — cùng style/hành vi toast của NotificationBell (trượt+mờ dần
          vào, tự tắt sau 10s, bấm để mở thẳng cuộc hội thoại, nút X riêng chỉ đóng banner). */}
      {!open &&
        toastConvo &&
        (() => {
          const c = toastConvo;
          return (
            <div className="notif-toast-in popover absolute right-0 top-full z-50 mt-2.5 w-80 max-w-[85vw] rounded-2xl p-3 shadow-2xl shadow-black/60">
              <button
                onClick={() => {
                  setToastConvo(null);
                  setOpen(true);
                  void openThread(c);
                }}
                className="flex w-full items-start gap-3 text-left"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-from">
                  <MessageCircle size={17} />
                </div>
                <div className="min-w-0 flex-1 pr-5">
                  <p className="truncate text-[13px] font-semibold text-text">{c.clientName || c.counterpartNumber}</p>
                  <p className="mt-0.5 truncate text-[12px] text-text-dim">{c.lastMessageText}</p>
                </div>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setToastConvo(null);
                  if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
                }}
                aria-label={t("common.close")}
                title={t("common.close")}
                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-text-faint transition hover:bg-surface-hover hover:text-text"
              >
                <X size={13} />
              </button>
            </div>
          );
        })()}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="popover absolute right-0 z-50 mt-2 flex max-h-[28rem] w-96 max-w-[90vw] flex-col rounded-2xl p-0 shadow-2xl shadow-black/60">
            {!active ? (
              <>
                <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
                  <span className="text-[17px] font-bold tracking-tight text-text">{t("smsInbox.title")}</span>
                  <button
                    onClick={() => setSmsNotificationSoundMuted(!smsNotificationSoundMuted)}
                    title={smsNotificationSoundMuted ? t("smsInbox.unmute") : t("smsInbox.mute")}
                    aria-label={smsNotificationSoundMuted ? t("smsInbox.unmute") : t("smsInbox.mute")}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-text-dim transition hover:bg-surface-hover hover:text-text"
                  >
                    {smsNotificationSoundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-2 pt-1">
                  {conversations.length === 0 && (
                    <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
                      <MessageCircle size={26} className="text-text-faint" strokeWidth={1.5} />
                      <span className="text-xs text-text-faint">{t("smsInbox.empty")}</span>
                    </div>
                  )}
                  {conversations.map((c) => {
                    const unread = c.unreadCount > 0;
                    return (
                      <div
                        key={c.counterpartNumber}
                        className={`group flex w-full items-start gap-2 rounded-xl px-2.5 py-2.5 transition ${
                          unread ? "bg-accent-soft hover:brightness-[1.08]" : "hover:bg-surface-hover"
                        }`}
                      >
                        <button onClick={() => void openThread(c)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-text-dim">
                            <MessageCircle size={15} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-[13px] ${unread ? "font-semibold text-text" : "text-text-dim"}`}>
                              {c.clientName || c.counterpartNumber}
                            </p>
                            {c.clientName && <p className="truncate text-[11px] text-text-faint">{c.counterpartNumber}</p>}
                            <p className={`mt-0.5 truncate text-[12px] ${unread ? "text-text" : "text-text-faint"}`}>
                              {c.lastMessageDirection === "out" ? `${t("smsInbox.youPrefix")}: ` : ""}
                              {c.lastMessageText}
                            </p>
                            <p className="mt-0.5 text-[11px] text-text-faint">{timeAgo(c.lastMessageAt, language)}</p>
                          </div>
                        </button>
                        <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteConversation(c.counterpartNumber);
                            }}
                            title={t("smsInbox.deleteAllAction")}
                            aria-label={t("smsInbox.deleteAllAction")}
                            className="rounded p-1 text-text-faint opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                          >
                            <Trash2 size={13} />
                          </button>
                          {unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent-from" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <button
                    onClick={() => setActivePhone(null)}
                    aria-label={t("common.close")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-dim hover:bg-surface-hover hover:text-text"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text">{active.clientName || active.counterpartNumber}</p>
                    {active.clientName && <p className="truncate text-[11px] text-text-faint">{active.counterpartNumber}</p>}
                  </div>
                  <button
                    onClick={() => void handleDeleteAll()}
                    title={t("smsInbox.deleteAllAction")}
                    aria-label={t("smsInbox.deleteAllAction")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-faint transition hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto bg-bg-elevated/40 p-3">
                  {threadLoading && <p className="text-center text-xs text-text-faint">{t("common.loading")}</p>}
                  {!threadLoading && messages.length === 0 && (
                    <p className="text-center text-xs text-text-faint">{t("sms.empty")}</p>
                  )}
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`group flex items-end gap-1 ${m.direction === "out" ? "justify-end" : "justify-start"}`}
                    >
                      {m.direction === "out" && (
                        <button
                          onClick={() => void handleDeleteMessage(m.id)}
                          title={t("smsInbox.deleteMessageAction")}
                          aria-label={t("smsInbox.deleteMessageAction")}
                          className="shrink-0 rounded p-1 text-text-faint opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                      <div
                        className={`max-w-[80%] rounded-xl px-3 py-1.5 text-xs whitespace-pre-wrap break-words ${
                          m.direction === "out" ? "gradient-btn text-white" : "border border-border bg-surface text-text"
                        }`}
                      >
                        {m.text}
                        <div className={`mt-0.5 text-[10px] ${m.direction === "out" ? "text-white/70" : "text-text-faint"}`}>
                          {new Date(m.createdAt).toLocaleString()}
                        </div>
                      </div>
                      {m.direction === "in" && (
                        <button
                          onClick={() => void handleDeleteMessage(m.id)}
                          title={t("smsInbox.deleteMessageAction")}
                          aria-label={t("smsInbox.deleteMessageAction")}
                          className="shrink-0 rounded p-1 text-text-faint opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex items-end gap-2 border-t border-border p-2.5">
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
                    rows={1}
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
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
