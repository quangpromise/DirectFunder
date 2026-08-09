"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { History, X } from "lucide-react";
import { DeletedRowRecord, EditHistoryRecord, User } from "@/lib/types";
import { getFullName } from "@/lib/client-name";
import { useT } from "@/lib/i18n";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryDialog({
  editHistory,
  deletionHistory,
  users,
}: {
  editHistory: EditHistoryRecord[];
  deletionHistory: DeletedRowRecord[];
  users: User[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"edit" | "delete">("edit");
  const t = useT();

  function userName(id: string): string {
    return users.find((u) => u.id === id)?.name ?? t("desc.unknown");
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
        title={t("history.button")}
      >
        <History size={14} />
        <span className="hidden sm:inline">{t("common.history")}</span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-lg flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("history.title")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="mt-3 flex gap-1.5 border-b border-border px-5">
                <button
                  onClick={() => setTab("edit")}
                  className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium transition ${
                    tab === "edit" ? "border-b-2 border-accent text-accent" : "text-text-faint hover:text-text-dim"
                  }`}
                >
                  {t("history.edits")}
                  <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] text-text-faint">
                    {editHistory.length}
                  </span>
                </button>
                <button
                  onClick={() => setTab("delete")}
                  className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium transition ${
                    tab === "delete" ? "border-b-2 border-accent text-accent" : "text-text-faint hover:text-text-dim"
                  }`}
                >
                  {t("history.deletes")}
                  <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] text-text-faint">
                    {deletionHistory.length}
                  </span>
                </button>
              </div>

              <div className="mt-3 flex flex-col gap-2 overflow-y-auto px-5 pb-5">
                {tab === "edit" && (
                  <>
                    {editHistory.length === 0 && (
                      <div className="py-8 text-center text-sm text-text-faint">{t("history.noEdits")}</div>
                    )}
                    {editHistory.map((h) => (
                      <div key={h.id} className="rounded-lg border border-border bg-bg-elevated p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {h.caseNumber} · {h.fieldLabel}
                          </span>
                          <span className="shrink-0 text-[11px] text-text-faint">{formatTime(h.editedAt)}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-text-faint">
                          <span className="text-red-300 line-through">{h.oldValue}</span>
                          {" → "}
                          <span className="text-emerald-300">{h.newValue}</span>
                        </p>
                        <p className="mt-1 text-[11px] text-text-faint">
                          {t("history.editedBy")} <span className="text-text-dim">{userName(h.editedByUserId)}</span>
                        </p>
                      </div>
                    ))}
                  </>
                )}

                {tab === "delete" && (
                  <>
                    {deletionHistory.length === 0 && (
                      <div className="py-8 text-center text-sm text-text-faint">{t("history.noDeletes")}</div>
                    )}
                    {deletionHistory.map((h) => (
                      <div key={h.id} className="rounded-lg border border-border bg-bg-elevated p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {getFullName(h.caseSnapshot) || "—"} · {h.caseSnapshot.caseNumber}
                          </span>
                          <span className="shrink-0 text-[11px] text-text-faint">{formatTime(h.deletedAt)}</span>
                        </div>
                        <p className="mt-1 text-xs text-text-faint">
                          {t("history.deletedBy")} <span className="text-text-dim">{userName(h.deletedByUserId)}</span>
                        </p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
