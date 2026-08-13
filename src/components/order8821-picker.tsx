"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Users, User, CheckCircle2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useSuccessFlash } from "@/lib/use-success-flash";

const MENU_MARGIN = 8;

/**
 * Popup nhỏ neo cạnh nút "Order 8821" — cho chọn đặt order cho Client 1, Client 2, hay
 * Cả 2 (tạo 2 order riêng, xem placeOrder trong app-store.ts). Dùng chung cho nút Order
 * 8821 ở bảng Hồ sơ lẫn cột Order 8821 phụ trong tab Order (Order TTS & WIT).
 */
export function Order8821Picker({
  disabled,
  onPick,
}: {
  disabled: boolean;
  /** Trả về true nếu order được đặt thành công (đã qua xác nhận) -> nút hiện dấu tick
   * xanh 5s rồi TỰ QUAY VỀ MẶC ĐỊNH (không khoá chờ Support Done — đặt lại được ngay,
   * chặn trùng dựa vào SSN trong onPick chứ không khoá theo trạng thái case). Trả về
   * false/undefined nếu bị huỷ hoặc chặn (thiếu trường, SSN trùng...) — không hiện tick. */
  onPick: (slots: (0 | 1)[]) => Promise<boolean | void> | boolean | void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [justPlaced, flashPlaced] = useSuccessFlash();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const t = useT();

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
    const y = openUpward ? rect.top - 4 - menuHeight : rect.bottom + 4;
    setPos((p) => (p.x === rect.left && p.y === y ? p : { x: rect.left, y }));
  }, [open]);

  async function pick(slots: (0 | 1)[]) {
    setOpen(false);
    const success = await onPick(slots);
    if (success) flashPlaced();
  }

  return (
    <div className="relative w-full min-w-0">
      <button
        ref={triggerRef}
        disabled={disabled || justPlaced}
        onClick={() => setOpen((o) => !o)}
        className={`w-full shrink-0 cursor-pointer whitespace-nowrap rounded-md border px-1 py-0.5 text-center text-[10px] font-bold leading-tight transition disabled:cursor-default ${
          justPlaced
            ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-300 light:text-emerald-700"
            : "border-amber-800/60 bg-amber-900/40 text-amber-200 hover:bg-amber-900/60 light:border-amber-300 light:bg-amber-100 light:text-amber-900 light:hover:bg-amber-200"
        }`}
      >
        {justPlaced ? (
          <span className="flex items-center justify-center gap-1">
            <CheckCircle2 size={12} className="shrink-0" />
            {t("order8821.placed")}
          </span>
        ) : (
          t("order8821.button")
        )}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className="popover fixed z-[100] max-h-56 w-44 overflow-y-auto rounded-xl p-1.5 shadow-2xl shadow-black/60"
              style={{ left: pos.x, top: pos.y }}
            >
              <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
                {t("order8821.pickTitle")}
              </div>
              <button
                onClick={() => pick([0])}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-surface-hover"
              >
                <User size={13} className="shrink-0 text-text-faint" />
                {t("order8821.client1")}
              </button>
              <button
                onClick={() => pick([1])}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-surface-hover"
              >
                <User size={13} className="shrink-0 text-text-faint" />
                {t("order8821.client2")}
              </button>
              <button
                onClick={() => pick([0, 1])}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-surface-hover"
              >
                <Users size={13} className="shrink-0 text-text-faint" />
                {t("order8821.both")}
              </button>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
