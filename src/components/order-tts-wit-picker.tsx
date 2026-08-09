"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Users, User, CheckCircle2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useSuccessFlash } from "@/lib/use-success-flash";

const MENU_MARGIN = 8;

type ClientChoice = 0 | 1 | "both";

/**
 * Popup nhỏ neo cạnh nút "Order TTS & WIT" — chọn Client 1/Client 2/Cả 2 GIỐNG popup
 * Order 8821 (xem order8821-picker.tsx), nhưng bổ sung ô nhập Description bắt buộc +
 * nút Confirm riêng (chọn client xong chưa gửi ngay, phải nhập mô tả rồi bấm Confirm).
 * Thiếu client hoặc mô tả -> cảnh báo ngay trong popup, không đóng lại.
 */
export function OrderTtsWitPicker({
  disabled,
  onConfirm,
}: {
  disabled: boolean;
  /** Trả về true nếu order được đặt thành công (đã qua xác nhận) -> nút hiện dấu tick
   * xanh 5s rồi TỰ QUAY VỀ MẶC ĐỊNH (không khoá chờ Support Done — đặt lại được ngay,
   * chặn trùng dựa vào SSN trong onConfirm chứ không khoá theo trạng thái case). Trả về
   * false/undefined nếu bị huỷ/chặn — không hiện tick. */
  onConfirm: (slots: (0 | 1)[], description: string) => Promise<boolean | void> | boolean | void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [choice, setChoice] = useState<ClientChoice | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
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
  }, [open, choice, error]);

  function openMenu() {
    setChoice(null);
    setDescription("");
    setError("");
    setOpen((o) => !o);
  }

  async function handleConfirm() {
    if (choice === null) {
      setError(t("order8821.pickClientWarning"));
      return;
    }
    if (!description.trim()) {
      setError(t("orderTtsWit.descriptionWarning"));
      return;
    }
    setOpen(false);
    const success = await onConfirm(choice === "both" ? [0, 1] : [choice], description.trim());
    if (success) flashPlaced();
  }

  return (
    <div className="relative w-full min-w-0">
      <button
        ref={triggerRef}
        disabled={disabled || justPlaced}
        onClick={openMenu}
        className={`w-full shrink-0 cursor-pointer whitespace-nowrap rounded-md border px-1.5 py-1 text-center text-[10px] font-bold leading-tight transition disabled:cursor-default ${
          justPlaced
            ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-300 light:text-emerald-700"
            : "border-amber-800/60 bg-amber-900/40 text-amber-200 hover:bg-amber-900/60 light:border-amber-300 light:bg-amber-100 light:text-amber-900 light:hover:bg-amber-200"
        }`}
      >
        {justPlaced ? (
          <span className="flex items-center justify-center gap-1">
            <CheckCircle2 size={12} className="shrink-0" />
            {t("orderTtsWit.placed")}
          </span>
        ) : (
          t("orderTtsWit.button")
        )}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className="popover fixed z-[100] w-64 rounded-xl p-2.5 shadow-2xl shadow-black/60"
              style={{ left: pos.x, top: pos.y }}
            >
              <div className="px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
                {t("order8821.pickTitle")}
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setChoice(0)}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition ${
                    choice === 0 ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-hover"
                  }`}
                >
                  <User size={13} className="shrink-0" />
                  {t("order8821.client1")}
                </button>
                <button
                  onClick={() => setChoice(1)}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition ${
                    choice === 1 ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-hover"
                  }`}
                >
                  <User size={13} className="shrink-0" />
                  {t("order8821.client2")}
                </button>
                <button
                  onClick={() => setChoice("both")}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition ${
                    choice === "both" ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-hover"
                  }`}
                >
                  <Users size={13} className="shrink-0" />
                  {t("order8821.both")}
                </button>
              </div>

              <label className="mb-1 mt-2.5 block text-[10px] font-semibold uppercase tracking-wide text-text-faint">
                {t("orderTtsWit.descriptionLabel")}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder={t("orderTtsWit.descriptionPlaceholder")}
                className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs outline-none focus:border-accent"
              />

              {error && <p className="mt-1.5 text-[11px] text-red-400 light:text-red-600">{error}</p>}

              <button
                onClick={handleConfirm}
                className="gradient-btn mt-2.5 w-full rounded-lg py-1.5 text-xs font-medium text-white"
              >
                {t("common.confirm")}
              </button>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
