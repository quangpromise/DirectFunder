"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { NotebookPen, X, Check, AlertCircle, Plus } from "lucide-react";
import { MyNotesEditor } from "@/components/my-notes-editor";
import { Spinner } from "@/components/spinner";
import { useConfirm } from "@/components/confirm-dialog";
import { MyNotesData, MyNoteTab, createTab, MAX_TABS, MAX_TAB_NAME_LENGTH } from "@/lib/my-notes";
import { stripHtmlTags } from "@/lib/rich-text";
import { useT, useLanguage } from "@/lib/i18n";

/**
 * Nút "My Notes" trên toolbar bảng Hồ sơ — ghi chú cá nhân rich text, cho MỌI user (không
 * cần quyền riêng, không ai khác xem/sửa được — xem GET/PATCH /api/me/notes). Nội dung nạp
 * lười (lazy) lần đầu mở popup qua `fetchMyNotes` (store), không nạp cùng hydrateFromServer.
 * Lưu tay qua nút "Lưu" (không auto-save mỗi keystroke) — dialog KHÔNG tự đóng sau khi lưu
 * (khác đa số dialog cấu hình khác trong app) vì đây là notepad, người dùng có thể còn ghi
 * tiếp trong cùng 1 lần mở.
 *
 * Nhiều tab (thêm 2026-08-24, "add thêm nhiều tab note và đặt tên cho tab") — thanh tab ngang
 * phía trên editor, mỗi tab tự đặt tên (double-click để sửa tên inline), nút "+" thêm tab mới
 * (tối đa MAX_TABS), nút "x" xoá tab (ẩn nếu chỉ còn đúng 1 tab — luôn giữ ít nhất 1 tab, xác
 * nhận trước nếu tab có nội dung). Toàn bộ tabs lưu CHUNG 1 lần bấm "Lưu" (không lưu riêng
 * từng tab) — xem `sendCaseRowToCpaReview`-style single save action, khớp đúng tinh thần "lưu
 * tay" đã có sẵn của dialog này.
 */
export function MyNotesDialog({
  myNotesData,
  fetchMyNotes,
  saveMyNotes,
}: {
  /** null = chưa nạp lần nào (xem app-store.ts). */
  myNotesData: MyNotesData | null;
  fetchMyNotes: () => Promise<void>;
  saveMyNotes: (data: MyNotesData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<MyNotesData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const t = useT();
  const { language } = useLanguage();
  const { confirm, ConfirmDialogUI } = useConfirm();

  async function openDialog() {
    setOpen(true);
    setError("");
    setSavedAt(null);
    if (myNotesData === null) {
      setLoading(true);
      try {
        await fetchMyNotes();
      } finally {
        setLoading(false);
      }
    }
  }

  // myNotesData chỉ đổi (tham chiếu mới) khi fetch xong/vừa lưu xong -- đồng bộ draft theo
  // giá trị mới nhất từ store mỗi khi nó đổi trong lúc dialog đang mở (KHÔNG ghi đè draft đang
  // sửa dở nếu tham chiếu store không đổi — so sánh qua state riêng bên dưới).
  const [syncedFrom, setSyncedFrom] = useState<MyNotesData | null>(null);
  if (open && myNotesData !== null && myNotesData !== syncedFrom) {
    setSyncedFrom(myNotesData);
    setDraft(myNotesData);
    setRenamingTabId(null);
  }

  const activeTab: MyNoteTab | null = draft ? draft.tabs.find((tb) => tb.id === draft.activeTabId) ?? draft.tabs[0] ?? null : null;

  function updateActiveTabHtml(html: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const targetId = prev.tabs.find((tb) => tb.id === prev.activeTabId) ? prev.activeTabId : prev.tabs[0]?.id;
      return { ...prev, tabs: prev.tabs.map((tb) => (tb.id === targetId ? { ...tb, html } : tb)) };
    });
  }

  function switchTab(id: string) {
    setRenamingTabId(null);
    setDraft((prev) => (prev ? { ...prev, activeTabId: id } : prev));
  }

  function addTab() {
    setDraft((prev) => {
      if (!prev || prev.tabs.length >= MAX_TABS) return prev;
      const tab = createTab(prev.tabs.length + 1, language);
      return { tabs: [...prev.tabs, tab], activeTabId: tab.id };
    });
  }

  function startRename(tab: MyNoteTab) {
    setRenamingTabId(tab.id);
    setRenameDraft(tab.name);
  }

  function commitRename() {
    const id = renamingTabId;
    setRenamingTabId(null);
    if (!id) return;
    const name = renameDraft.trim().slice(0, MAX_TAB_NAME_LENGTH);
    if (!name) return;
    setDraft((prev) => (prev ? { ...prev, tabs: prev.tabs.map((tb) => (tb.id === id ? { ...tb, name } : tb)) } : prev));
  }

  async function deleteTab(tab: MyNoteTab) {
    if (!draft || draft.tabs.length <= 1) return;
    const hasContent = stripHtmlTags(tab.html) !== "";
    if (hasContent) {
      const confirmed = await confirm(t("myNotes.deleteTabConfirm", { name: tab.name }), {
        title: t("myNotes.deleteTabTitle"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    setDraft((prev) => {
      if (!prev) return prev;
      const nextTabs = prev.tabs.filter((tb) => tb.id !== tab.id);
      const nextActive = prev.activeTabId === tab.id ? (nextTabs[0]?.id ?? "") : prev.activeTabId;
      return { tabs: nextTabs, activeTabId: nextActive };
    });
  }

  async function handleSave() {
    if (!draft) return;
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
      {ConfirmDialogUI}
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

              {!loading && draft && (
                <div className="mt-3 flex items-center gap-1.5 overflow-x-auto px-5 pb-0.5">
                  {draft.tabs.map((tab) => {
                    const active = tab.id === (draft.tabs.some((tb) => tb.id === draft.activeTabId) ? draft.activeTabId : draft.tabs[0]?.id);
                    return (
                      <div
                        key={tab.id}
                        className={`group flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs transition ${
                          active
                            ? "border-accent bg-accent-soft text-text"
                            : "border-border bg-bg-elevated text-text-dim hover:border-accent"
                        }`}
                      >
                        {renamingTabId === tab.id ? (
                          <input
                            autoFocus
                            value={renameDraft}
                            maxLength={MAX_TAB_NAME_LENGTH}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename();
                              if (e.key === "Escape") setRenamingTabId(null);
                            }}
                            className="w-24 bg-transparent outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => switchTab(tab.id)}
                            onDoubleClick={() => startRename(tab)}
                            title={t("myNotes.renameHint")}
                            className="max-w-[100px] truncate"
                          >
                            {tab.name}
                          </button>
                        )}
                        {draft.tabs.length > 1 && renamingTabId !== tab.id && (
                          <button
                            type="button"
                            onClick={() => deleteTab(tab)}
                            title={t("myNotes.deleteTabTitle")}
                            className="shrink-0 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={addTab}
                    disabled={draft.tabs.length >= MAX_TABS}
                    title={t("myNotes.addTab")}
                    className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong p-1 text-text-faint transition hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-40"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              )}

              <div className="mt-2 min-h-0 flex-1 px-5">
                {loading || !activeTab ? (
                  <div className="flex h-full items-center justify-center text-text-faint">
                    <Spinner size={18} />
                  </div>
                ) : (
                  <MyNotesEditor
                    key={activeTab.id}
                    value={activeTab.html}
                    onChange={updateActiveTabHtml}
                    placeholder={t("myNotes.placeholder")}
                    language={language}
                  />
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
