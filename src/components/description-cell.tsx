"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { upload } from "@vercel/blob/client";
import { History, MessageSquarePlus, Paperclip, X } from "lucide-react";
import { DescriptionReply, User } from "@/lib/types";
import { Avatar } from "@/components/avatar";
import { useT } from "@/lib/i18n";

const MENU_MARGIN = 8;
// File đính kèm CHỈ dùng để gửi kèm tin nhắn Teams (Processor -> Agent 1) khi reply
// Description — KHÔNG lưu lại trong app (server tự xoá blob ngay sau khi gửi xong, xem
// PATCH /api/cases/[id]/route.ts) — giới hạn dung lượng hợp lý, không phải giới hạn kỹ
// thuật của Vercel Blob.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DescriptionCell({
  caseId,
  description,
  replies,
  unread,
  users,
  editable,
  onReply,
  onMarkRead,
}: {
  caseId: string;
  description: string;
  replies: DescriptionReply[];
  unread: boolean;
  users: User[];
  editable: boolean;
  onReply: (text: string, teamsAttachments?: { name: string; url: string }[]) => void;
  onMarkRead: () => void;
}) {
  const [hovering, setHovering] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState("");
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const replyBtnRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeTriggerRef = useRef<HTMLElement | null>(null);
  const activeAlignRight = useRef(false);

  const t = useT();
  const latest = replies.length > 0 ? replies[replies.length - 1].text : description;

  // Đo lại vị trí sau khi popup render (biết chiều cao thật) và lật lên trên nếu không đủ
  // chỗ bên dưới — tránh popup bị khuất màn hình khi ô nằm ở hàng gần cuối bảng.
  useLayoutEffect(() => {
    const open = historyOpen || replyOpen;
    if (!open) return;
    const trigger = activeTriggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    const spaceAbove = rect.top - MENU_MARGIN;
    const openUpward = menuHeight > spaceBelow && spaceAbove > spaceBelow;
    const x = activeAlignRight.current ? rect.right - 280 : rect.left;
    const y = openUpward ? rect.top - 4 - menuHeight : rect.bottom + 4;
    setPopoverPos((p) => (p.x === x && p.y === y ? p : { x, y }));
  }, [historyOpen, replyOpen]);

  function authorName(id: string): string {
    return users.find((u) => u.id === id)?.name ?? t("desc.unknown");
  }

  function author(id: string): User | undefined {
    return users.find((u) => u.id === id);
  }

  function openHistory() {
    const rect = cellRef.current?.getBoundingClientRect();
    if (rect) setPopoverPos({ x: rect.left, y: rect.bottom + 4 });
    activeTriggerRef.current = cellRef.current;
    activeAlignRight.current = false;
    setReplyOpen(false);
    setHistoryOpen(true);
  }

  // Text màu đỏ của reply mới chỉ về màu mặc định khi ĐÓNG pop-up (không phải ngay khi
  // mở), để người dùng còn kịp thấy rõ nội dung nào là mới trước khi nó hết đỏ.
  function closeHistory() {
    setHistoryOpen(false);
    if (unread) onMarkRead();
  }

  function openReply() {
    const rect = replyBtnRef.current?.getBoundingClientRect();
    if (rect) setPopoverPos({ x: rect.right - 280, y: rect.bottom + 4 });
    activeTriggerRef.current = replyBtnRef.current;
    activeAlignRight.current = true;
    setHistoryOpen(false);
    setReplyDraft("");
    setPendingFiles([]);
    setAttachError("");
    setReplyOpen(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  // Upload thẳng lên Vercel Blob (né giới hạn ~4.5MB thân request) — file CHỈ dùng để đính
  // link vào tin nhắn Teams, server tự xoá ngay sau khi gửi (không lưu lại trong app).
  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttachError("");
    const list = Array.from(files);
    if (pendingFiles.length + list.length > MAX_ATTACHMENTS) {
      setAttachError(t("desc.tooManyAttachments"));
      return;
    }
    const tooBig = list.find((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      setAttachError(t("desc.attachmentTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        list.map(async (file) => {
          const blob = await upload(file.name, file, {
            access: "public",
            handleUploadUrl: `/api/cases/${caseId}/description-attachment-upload`,
          });
          return { name: file.name, url: blob.url };
        })
      );
      setPendingFiles((prev) => [...prev, ...uploaded]);
    } catch {
      setAttachError(t("desc.attachmentUploadError"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function submitReply() {
    const trimmed = replyDraft.trim();
    if (!trimmed && pendingFiles.length === 0) return;
    onReply(trimmed, pendingFiles.length > 0 ? pendingFiles : undefined);
    setReplyDraft("");
    setPendingFiles([]);
    setReplyOpen(false);
  }

  return (
    <div
      ref={cellRef}
      className="relative flex h-full min-w-0 items-center"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button
        onClick={openHistory}
        title={latest || undefined}
        className={`min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-center text-xs transition hover:bg-surface-hover ${
          unread ? "font-medium text-red-400" : "text-text-dim"
        }`}
      >
        {latest || <span className="text-text-faint">—</span>}
      </button>

      {editable && (hovering || replies.length > 0) && (
        <button
          ref={replyBtnRef}
          onClick={openReply}
          className="mr-1 shrink-0 rounded p-1 text-text-faint transition hover:bg-surface-hover hover:text-text"
          title={t("desc.reply")}
          aria-label={t("desc.reply")}
        >
          <MessageSquarePlus size={13} />
        </button>
      )}
      {(hovering || replies.length > 0) && (
        <button
          onClick={openHistory}
          className="mr-1 shrink-0 rounded p-1 text-text-faint transition hover:bg-surface-hover hover:text-text"
          title={t("desc.viewAll")}
          aria-label={t("desc.viewAll")}
        >
          <History size={13} />
        </button>
      )}

      {historyOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={closeHistory} />
            <div
              ref={menuRef}
              className="popover fixed z-[100] flex max-h-80 w-80 flex-col rounded-xl p-3 shadow-2xl shadow-black/60"
              style={{ left: popoverPos.x, top: popoverPos.y }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-text-dim">{t("desc.historyTitle")}</span>
                <button onClick={closeHistory} className="text-text-faint hover:text-text">
                  <X size={13} />
                </button>
              </div>
              {/* Nội dung mới nhất hiện trên đầu — đảo ngược thứ tự reply (mới nhất
                  trước), Mô tả ban đầu luôn là nội dung cũ nhất nên nằm cuối cùng. Reply
                  mới nhất bôi đỏ khi còn unread, tự về màu mặc định khi đóng pop-up. */}
              <div className="flex-1 space-y-2 overflow-y-auto pr-0.5">
                {[...replies].reverse().map((r, idx) => (
                  <div
                    key={r.id}
                    className={`rounded-lg border p-2 ${
                      idx === 0 && unread ? "border-red-500/30 bg-red-500/5" : "border-border bg-bg-elevated"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Avatar
                          name={authorName(r.authorId)}
                          color={author(r.authorId)?.avatarColor ?? "#6b7280"}
                          url={author(r.authorId)?.avatarUrl}
                          size={16}
                        />
                        <span className="min-w-0 truncate text-[11px] font-medium text-accent">
                          {authorName(r.authorId)}
                        </span>
                      </div>
                      <span className="shrink-0 text-[10px] text-text-faint">{formatTime(r.createdAt)}</span>
                    </div>
                    <p
                      className={`whitespace-pre-wrap text-xs ${
                        idx === 0 && unread ? "font-medium text-red-400" : "text-text-dim"
                      }`}
                    >
                      {r.text}
                    </p>
                  </div>
                ))}
                <div className="rounded-lg border border-border bg-bg-elevated p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-text-faint">{t("desc.original")}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-text-dim">{description}</p>
                </div>
                {replies.length === 0 && (
                  <div className="px-1 py-2 text-center text-xs text-text-faint">{t("desc.noReplies")}</div>
                )}
              </div>
            </div>
          </>,
          document.body
        )}

      {replyOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setReplyOpen(false)} />
            <div
              ref={menuRef}
              className="popover fixed z-[100] max-h-80 w-72 overflow-y-auto rounded-xl p-2.5 shadow-2xl shadow-black/60"
              style={{ left: popoverPos.x, top: popoverPos.y }}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-text-dim">{t("desc.replyTitle")}</span>
                <button onClick={() => setReplyOpen(false)} className="text-text-faint hover:text-text">
                  <X size={13} />
                </button>
              </div>
              <textarea
                ref={textareaRef}
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitReply();
                  if (e.key === "Escape") setReplyOpen(false);
                }}
                placeholder={t("desc.replyPlaceholder")}
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
              {pendingFiles.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-1">
                  {pendingFiles.map((f, i) => (
                    <div
                      key={`${f.url}:${i}`}
                      className="flex items-center justify-between gap-1.5 rounded-md bg-surface px-1.5 py-1 text-[11px] text-text-dim"
                    >
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <button
                        onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="shrink-0 text-text-faint hover:text-text"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {attachError && <p className="mt-1.5 text-[11px] text-red-400">{attachError}</p>}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              <div className="mt-2 flex items-center justify-between">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title={t("desc.attachFile")}
                  aria-label={t("desc.attachFile")}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text disabled:opacity-40"
                >
                  <Paperclip size={13} />
                </button>
                <button
                  onClick={submitReply}
                  disabled={(!replyDraft.trim() && pendingFiles.length === 0) || uploading}
                  className="gradient-btn rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                >
                  {uploading ? t("desc.uploading") : t("desc.send")}
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
