"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus } from "lucide-react";
import { isLightHex } from "@/lib/color";
import { useT } from "@/lib/i18n";

const MENU_MARGIN = 8;
const MENU_WIDTH = 216;

/** Bảng màu preset khớp đúng bố cục chọn màu chữ của Google Sheets (chuột phải ô → Text
 * color, xem colorgroup.png) — 1 hàng thang xám (đen → trắng) rồi tới 4 hàng màu, mỗi hàng
 * sau nhạt/pastel dần theo hàng trước, 10 cột. Thêm 2026-08-14 thay cho `<input
 * type="color">` gốc trình duyệt (không đồng bộ giao diện, khác nhau giữa các trình duyệt).
 */
const COLOR_GRID: string[][] = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
];

/**
 * Nút chọn màu dạng lưới preset (giống Google Sheets) — thay thế `<input type="color">` gốc
 * trình duyệt ở mọi nơi quản lý màu SelectOption (ColumnSettingsDialog/AddColumnDialog/
 * RefundStatusOptionsManager/CpaReviewStatusOptionsButton). Vẫn cho chọn màu TỰ DO qua ô
 * "Tuỳ chỉnh" (input type=color ẩn) ở cuối, không giới hạn đúng 50 màu preset.
 */
export function ColorSwatchPicker({
  value,
  onChange,
  title,
}: {
  /** Hex "#rrggbb" hiện tại. */
  value: string;
  onChange: (hex: string) => void;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useLayoutEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    const openUpward = menuHeight > spaceBelow;
    const y = openUpward ? rect.top - 4 - menuHeight : rect.bottom + 4;
    const x = Math.min(rect.left, window.innerWidth - MENU_WIDTH - MENU_MARGIN);
    setPos((p) => (p.x === x && p.y === y ? p : { x, y }));
  }, [open]);

  const normalizedValue = value.toLowerCase();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        className="h-6 w-6 shrink-0 rounded border border-border transition hover:brightness-110"
        style={{ backgroundColor: value }}
      />

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            className="popover fixed z-[200] rounded-xl p-2.5 shadow-2xl shadow-black/60"
            style={{ left: pos.x, top: pos.y, width: MENU_WIDTH }}
          >
            <div className="grid grid-cols-10 gap-1">
              {COLOR_GRID.flat().map((hex, i) => (
                <button
                  key={`${hex}-${i}`}
                  type="button"
                  onClick={() => {
                    onChange(hex);
                    setOpen(false);
                  }}
                  title={hex}
                  aria-label={hex}
                  className="relative h-4 w-4 rounded-[3px] border border-black/10 transition hover:scale-110"
                  style={{ backgroundColor: hex }}
                >
                  {normalizedValue === hex && (
                    <Check
                      size={10}
                      strokeWidth={3}
                      className="absolute inset-0 m-auto"
                      style={{ color: isLightHex(hex) ? "#000" : "#fff" }}
                    />
                  )}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
              <span className="text-[10px] text-text-faint">{t("col.customColor")}</span>
              <label
                className="relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border-strong"
                title={t("col.customColor")}
              >
                <input
                  type="color"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
                <Plus size={10} className="pointer-events-none text-text-faint" />
              </label>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
