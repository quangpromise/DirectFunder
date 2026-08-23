"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { NotebookPen, X, Check, AlertCircle } from "lucide-react";
import { MyNotesEditor } from "@/components/my-notes-editor";
import { Spinner } from "@/components/spinner";
import { useT, useLanguage } from "@/lib/i18n";

/**
 * Nút "My Notes" trên toolbar bảng Hồ sơ — ghi chú cá nhân rich text, cho MỌI user (không
 * cần quyền riêng, không ai khác xem/sửa được — xem GET/PATCH /api/me/notes). Nội dung nạp
 * lười (lazy) lần đầu mở popup qua `fetchMyNotes` (store), không nạp cùng hydrateFromServer.
 * Lưu tay qua nút "Lưu" (không auto-save mỗi keystroke) — dialog KHÔNG tự đóng sau khi lưu
 * (khác đa số dialog cấu hình khác trong app) vì đây là notepad, người dùng có thể còn ghi
 * tiếp trong cùng 1 lần mở.
 */
export function MyNotesDialog({
  myNotesHtml,
  fetchMyNotes,
  saveMyNotes,
}: {
  /** null = chưa nạp lần nào (xem app-store.ts). */
  myNotesHtml: string | null;
  fetchMyNotes: () => Promise<void>;
  saveMyNotes: (html: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const t = useT();
  const { language } = useLanguage();

  async function openDialog() {
    setOpen(true);
    setError("");
    setSavedAt(null);
    if (myNotesHtml === null) {
      setLoading(true);
      try {
        await fetchMyNotes();
      } finally {
        setLoading(false);
      }
    }
  }

  // myNotesHtml chỉ đổi khi fetch xong/vừa lưu xong -- đồng bộ draft theo giá trị mới nhất
  // từ store mỗi khi nó đổi trong lúc dialog đang mở (KHÔNG ghi đè draft đang gõ dở nếu
  // giá trị store không đổi — so sánh tham chiếu qua state riêng bên dưới).
  const [syncedFrom, setSyncedFrom] = useState<string | null>(null);
  if (open && myNotesHtml !== null && myNotesHtml !== syncedFrom) {
    setSyncedFrom(myNotesHtml);
    setDraft(myNotesHtml);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const result = await saveMyNotes(draft);
      if (result.ok) {
        setSavedAt(new Date());
      } else {
        setError(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={openDialog}
        title={t("myNotes.button")}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <NotebookPen size={14} />
        {t("myNotes.button")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-4">
            <div className="popover flex h-[95vh] w-full max-w-lg flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("myNotes.title")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>
              <p className="mt-1 px-5 text-xs text-text-faint">{t("myNotes.hint")}</p>

              <div className="mt-3 min-h-0 flex-1 px-5">
                {loading ? (
                  <div className="flex h-full items-center justify-center text-text-faint">
                    <Spinner size={18} />
                  </div>
                ) : (
                  <MyNotesEditor value={draft} onChange={setDraft} placeholder={t("myNotes.placeholder")} language={language} />
                )}
              </div>

              {error && (
                <div className="mx-5 mt-3 flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 light:text-red-700">
                  <AlertCircle size={13} className="shrink-0" />
                  {error}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between gap-2 px-5 pb-5">
                <span className="flex items-center gap-1 text-xs text-text-faint">
                  {savedAt && (
                    <>
                      <Check size={13} className="text-emerald-500" />
                      {t("myNotes.savedAt", {
                        time: savedAt.toLocaleTimeString(language === "vi" ? "vi-VN" : "en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        }),
                      })}
                    </>
                  )}
                </span>
                <button
                  onClick={handleSave}
                  disabled={saving || loading}
                  className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white disabled:cursor-default disabled:opacity-60"
                >
                  {saving ? t("myNotes.saving") : t("myNotes.saveBtn")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
