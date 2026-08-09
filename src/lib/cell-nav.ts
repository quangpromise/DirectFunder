import type { KeyboardEvent } from "react";

export const GRID_ROOT_ATTR = "data-grid-root";
export const CELL_NAV_ATTR = "data-cell-nav";

/**
 * Nhấn Tab trong 1 ô đang sửa: nhảy sang textbox kế tiếp (Shift+Tab: lùi lại) theo đúng
 * thứ tự DOM (trái->phải, hết dòng xuống dòng dưới) và tự mở luôn chế độ sửa — không cần
 * click chuột, giống hành vi Tab trong Excel/Google Sheets.
 */
export function focusAdjacentCell(current: HTMLElement, direction: 1 | -1) {
  const root = current.closest<HTMLElement>(`[${GRID_ROOT_ATTR}]`);
  if (!root) return;
  const all = Array.from(root.querySelectorAll<HTMLElement>(`[${CELL_NAV_ATTR}]`));
  const idx = all.indexOf(current);
  if (idx === -1) return;
  const next = all[idx + direction];
  if (!next) return;
  if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) {
    next.focus();
    next.select();
  } else {
    next.click();
  }
}

/** Gắn vào onKeyDown của input trong 1 ô bảng: Tab -> commit rồi nhảy sang ô kế tiếp. */
export function handleCellTab(e: KeyboardEvent<HTMLElement>, commit: () => void) {
  if (e.key !== "Tab") return;
  e.preventDefault();
  commit();
  focusAdjacentCell(e.currentTarget, e.shiftKey ? -1 : 1);
}
