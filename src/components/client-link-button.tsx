"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link2, ExternalLink, X, Trash2, Pencil } from "lucide-react";
import { useT } from "@/lib/i18n";

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Nút chèn/sửa/xem liên kết cho Client Name — dùng chung giữa bảng Hồ sơ và
 * bảng Order, cùng thao tác trên field `clientLink` của case nên dữ liệu
 * link luôn đồng bộ ở cả 2 nơi. Popup luôn canh giữa theo hàng chứa nút
 * (dựa theo vị trí thực của chính nút, vốn đã được căn giữa theo chiều cao
 * hàng bởi container cha) để không rơi lệch sang hàng khác.
 */
export function ClientLinkButton({
  link,
  editable = true,
  onCommitLink,
}: {
  link: string | null;
  /** Khi false: chỉ xem/mở liên kết (nếu có), ẩn hoàn toàn tính năng chèn/sửa/xóa. */
  editable?: boolean;
  onCommitLink: (link: string | null) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(link ?? "");
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  const iconRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  useEffect(() => setDraft(link ?? ""), [link]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function handleEnter() {
    if (link && !previewOpen) {
      const rect = iconRef.current?.getBoundingClientRect();
      if (rect) setTooltipPos({ x: rect.right + 8, y: rect.top + rect.height / 2 });
      setPreviewOpen(true);
    }
  }

  // Ưu tiên hiện preview (Mở link + Sửa) nếu đã có link — kể cả khi editable, vì bấm
  // thẳng vào "sửa" mà không xem trước link hiện tại trước sẽ dễ nhầm trên di động (nơi
  // không có hover để xem trước như desktop). Chỉ nhảy thẳng vào form chèn link khi CHƯA
  // có link nào (không có gì để xem trước).
  function handleIconClick() {
    if (link) {
      handleEnter();
    } else if (editable) {
      openEdit();
    }
  }

  function save() {
    const next = draft.trim() ? normalizeUrl(draft) : null;
    onCommitLink(next);
    setEditing(false);
  }

  function remove() {
    onCommitLink(null);
    setDraft("");
    setEditing(false);
    setPreviewOpen(false);
  }

  function openEdit() {
    const rect = iconRef.current?.getBoundingClientRect();
    if (rect) setPopoverPos({ x: rect.left, y: rect.bottom + 4 });
    setPreviewOpen(false);
    setEditing((v) => !v);
  }

  // Luôn hiện icon khi editable (không còn phụ thuộc hover — hover không tồn tại trên
  // di động nên icon "chèn link" trước đây bị ẩn vĩnh viễn/không bấm được trên mobile).
  const showIcon = editable || Boolean(link);
  if (!showIcon) return null;

  const iconTitle = editable ? (link ? t("link.edit") : t("link.insert")) : t("link.view");

  return (
    <>
      <button
        ref={iconRef}
        onClick={handleIconClick}
        onMouseEnter={handleEnter}
        className={`shrink-0 rounded p-1 transition ${
          link ? "text-accent hover:bg-accent-soft" : "text-text-faint hover:bg-surface-hover hover:text-text"
        }`}
        title={iconTitle}
        aria-label={iconTitle}
      >
        <Link2 size={13} />
      </button>

      {!editing &&
        previewOpen &&
        link &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setPreviewOpen(false)} />
            <div
              className="popover fixed z-[100] flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs shadow-2xl shadow-black/60"
              style={{ left: tooltipPos.x, top: tooltipPos.y, transform: "translateY(-50%)" }}
            >
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                title={link}
                className="max-w-[220px] truncate text-accent hover:underline"
              >
                {link}
              </a>
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded p-0.5 text-text-faint hover:bg-surface-hover hover:text-text"
                title={t("link.open")}
              >
                <ExternalLink size={12} />
              </a>
              {editable && (
                <button
                  onClick={openEdit}
                  className="shrink-0 rounded p-0.5 text-text-faint hover:bg-surface-hover hover:text-text"
                  title={t("link.edit")}
                  aria-label={t("link.edit")}
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          </>,
          document.body
        )}

      {editing &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setEditing(false)} />
            <div
              className="popover fixed z-[100] w-64 rounded-xl p-2.5 shadow-2xl shadow-black/60"
              style={{ left: popoverPos.x, top: popoverPos.y }}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-text-dim">{t("link.insert")}</span>
                <button onClick={() => setEditing(false)} className="text-text-faint hover:text-text">
                  <X size={13} />
                </button>
              </div>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                placeholder="https://..."
                className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
              <div className="mt-2 flex items-center justify-between">
                {link ? (
                  <button onClick={remove} className="flex items-center gap-1 text-xs text-red-400 hover:underline">
                    <Trash2 size={11} />
                    {t("link.remove")}
                  </button>
                ) : (
                  <span />
                )}
                <button onClick={save} className="gradient-btn rounded-md px-2.5 py-1 text-xs font-medium text-white">
                  {t("common.save")}
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  );
}
