"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Settings, X, Trash2, Plus } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useT } from "@/lib/i18n";
import { useConfirm } from "@/components/confirm-dialog";
import { OptionBadge } from "@/components/option-badge";
import { ColorSwatchPicker } from "@/components/color-swatch-picker";
import { hexToRgba15, rgbaToHex } from "@/lib/color";
import type { SelectOption } from "@/lib/types";

const MENU_MARGIN = 8;
const PANEL_WIDTH = 320;

/**
 * Nút bánh răng quản lý danh sách Status (thêm/sửa/xoá/đổi màu text+nền) của tab "CPA
 * Review" — thêm 2026-08-14 theo yêu cầu "cấu hình cho phép thêm sửa xóa và chỉnh màu text,
 * background trong dropbox status". Cùng pattern UI với "quản lý trạng thái" trong popup
 * "Refund by years" (CaseRefundStatusButton) nhưng tách riêng file vì đối tượng dữ liệu
 * khác (cpaReviewStatusOptions, không có id nào bị khoá xoá như "pending" bên refund).
 */
export function CpaReviewStatusOptionsButton() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [newLabel, setNewLabel] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { confirm, ConfirmDialogUI } = useConfirm();
  const t = useT();

  const options = useAppStore((s) => s.cpaReviewStatusOptions);
  const addOption = useAppStore((s) => s.addCpaReviewStatusOption);
  const updateOption = useAppStore((s) => s.updateCpaReviewStatusOption);
  const removeOption = useAppStore((s) => s.removeCpaReviewStatusOption);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    const spaceAbove = rect.top - MENU_MARGIN;
    const openUpward = menuHeight > spaceBelow && spaceAbove > spaceBelow;
    const y = openUpward ? rect.top - 4 - Math.min(menuHeight, spaceAbove) : rect.bottom + 4;
    const x = Math.min(rect.left, window.innerWidth - PANEL_WIDTH - MENU_MARGIN);
    setPos((p) => (p.x === x && p.y === y ? p : { x, y }));
  }, [open, options.length]);

  function handleAdd() {
    if (!newLabel.trim()) return;
    addOption({ label: newLabel.trim(), bg: "rgba(59,130,246,0.15)", color: "#93c5fd" });
    setNewLabel("");
  }

  async function handleRemove(optionId: string, label: string) {
    if (await confirm(t("col.removeOptionConfirm", { label }), { title: t("col.removeOptionTitle"), tone: "danger" })) {
      removeOption(optionId);
    }
  }

  return (
    <>
      {ConfirmDialogUI}
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <Settings size={14} />
        Trạng thái Status
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className="popover fixed z-[100] rounded-xl p-2 shadow-2xl shadow-black/60"
              style={{ left: pos.x, top: pos.y, width: PANEL_WIDTH }}
            >
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-text">Quản lý Status (CPA Review)</span>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={14} />
                </button>
              </div>
              <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-0.5">
                {options.map((o: SelectOption) => (
                  <div key={o.id} className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-2 py-1.5">
                    <ColorSwatchPicker
                      value={o.color}
                      onChange={(hex) => updateOption(o.id, { color: hex })}
                      title={t("col.textColor")}
                    />
                    <ColorSwatchPicker
                      value={rgbaToHex(o.bg)}
                      onChange={(hex) => updateOption(o.id, { bg: hexToRgba15(hex) })}
                      title={t("col.bgColor")}
                    />
                    <input
                      value={o.label}
                      onChange={(e) => updateOption(o.id, { label: e.target.value })}
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none hover:border-border focus:border-accent"
                    />
                    <div className="shrink-0">
                      <OptionBadge option={o} />
                    </div>
                    <button
                      onClick={() => handleRemove(o.id, o.label)}
                      title={t("col.removeOption")}
                      className="shrink-0 text-text-faint hover:text-red-400"
                      aria-label={t("col.removeOption")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAdd();
                    }
                  }}
                  placeholder={t("col.newOptionPlaceholder")}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-sm outline-none focus:border-accent"
                />
                <button
                  onClick={handleAdd}
                  disabled={!newLabel.trim()}
                  className="flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong px-2.5 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-40"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  );
}
