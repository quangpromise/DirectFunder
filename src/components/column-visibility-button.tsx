"use client";

import { useState } from "react";
import { EyeOff, Eye, X } from "lucide-react";
import { ColumnDef } from "@/lib/types";
import { useT, useLanguage, translateColumnLabel } from "@/lib/i18n";

/**
 * Nút "Ẩn cột" trên toolbar bảng Hồ sơ — cho MỌI user (không cần quyền `editColumn`) tự chọn
 * ẩn bớt cột họ không muốn nhìn, lưu riêng theo trình duyệt/tài khoản (xem
 * src/lib/hidden-columns.ts) — KHÁC hẳn `ColumnDef.hiddenFromGrid` (Admin ẩn cho MỌI user,
 * lưu server, chỉ người có quyền `editColumn` mới đổi được qua nút ⚙ từng cột).
 */
export function ColumnVisibilityButton({
  columns,
  hiddenColumnIds,
  onToggle,
  onShowAll,
}: {
  /** Danh sách cột CÓ THỂ ẩn — truyền đúng `otherColumns` (đã loại các cột lõi luôn hiện như
   * Client Name/Status/Agent/Processor, và các cột Admin đã ẩn sẵn qua hiddenFromGrid). */
  columns: ColumnDef[];
  hiddenColumnIds: string[];
  onToggle: (columnId: string) => void;
  onShowAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const { language } = useLanguage();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t("cases.hideColumns.button")}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <EyeOff size={14} />
        {t("cases.hideColumns.button")}
        {hiddenColumnIds.length > 0 && (
          <span className="gradient-btn flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white">
            {hiddenColumnIds.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-8">
          <div className="popover flex max-h-full w-full max-w-sm flex-col rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5">
              <h3 className="text-sm font-semibold">{t("cases.hideColumns.title")}</h3>
              <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                <X size={16} />
              </button>
            </div>
            <p className="mt-1.5 px-5 text-xs text-text-faint">{t("cases.hideColumns.hint")}</p>

            <div className="mt-3 flex flex-col gap-1 overflow-y-auto px-3 pb-2">
              {columns.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-text-faint">{t("cases.hideColumns.empty")}</p>
              )}
              {columns.map((col) => {
                const hidden = hiddenColumnIds.includes(col.id);
                return (
                  <button
                    key={col.id}
                    onClick={() => onToggle(col.id)}
                    className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-surface-hover"
                  >
                    <span className={hidden ? "text-text-faint line-through" : "text-text"}>
                      {translateColumnLabel(language, col.id, col.label)}
                    </span>
                    {hidden ? <EyeOff size={14} className="shrink-0 text-text-faint" /> : <Eye size={14} className="shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
              <span className="text-xs text-text-faint">
                {hiddenColumnIds.length > 0 ? t("cases.hideColumns.hiddenCount", { count: hiddenColumnIds.length }) : ""}
              </span>
              {hiddenColumnIds.length > 0 && (
                <button
                  onClick={onShowAll}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-surface-hover"
                >
                  {t("cases.hideColumns.showAll")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
