"use client";

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";

const MENU_MARGIN = 8;
const MENU_WIDTH = 260;
// Trễ trước khi đóng khi rê chuột ra khỏi nút/popup — bù khoảng trống vật lý giữa nút và
// popup (portal ra document.body nên KHÔNG lồng trong nhau về DOM, di chuột từ nút sang
// popup vẫn khiến mouseleave bắn ra trước mouseenter của popup nếu không có độ trễ này).
const CLOSE_DELAY = 150;

/**
 * Nút gộp (icon send-data-icon.png, phóng to 2026-08-16) cạnh badge Status trên bảng Hồ sơ —
 * trước đây 4 nút gửi (Send to Sheet/Send mail to CPA/Test Sheet/Send email to client) hiện
 * thành 1 cụm icon dọc chật chội ngay cạnh Status, giờ gộp lại sau 1 nút duy nhất. RÊ CHUỘT
 * vào (hover) là mở popup — không cần bấm — dùng dạng dropdown neo theo vị trí nút (giống
 * AssignMenu/CaseRefundStatusButton) thay vì modal toàn màn hình, hợp hành vi hover hơn. Vẫn
 * giữ onClick + click-outside làm phương án dự phòng cho thiết bị cảm ứng (không có hover).
 * Mỗi hành động bên trong `children` TỰ quản lý popup con của riêng nó khi bấm vào — component
 * này chỉ là khung chứa, không biết gì về nghiệp vụ bên trong.
 */
export function SendActionsMenuButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = useT();

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function openNow() {
    cancelClose();
    setOpen(true);
  }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  }

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 220;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    const openUpward = menuHeight > spaceBelow;
    const y = openUpward ? rect.top - 4 - menuHeight : rect.bottom + 4;
    const x = Math.min(rect.left, window.innerWidth - MENU_WIDTH - MENU_MARGIN);
    setPos((p) => (p.x === x && p.y === y ? p : { x, y }));
  }, [open]);

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openNow())}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        title={t("sendActions.buttonTitle")}
        aria-label={t("sendActions.buttonTitle")}
        className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-transparent transition hover:bg-surface-hover"
      >
        <img src="/send-data-icon.png" alt="" width={18} height={18} className="object-contain" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            onMouseEnter={openNow}
            onMouseLeave={scheduleClose}
            className="popover fixed z-[95] rounded-xl p-3 shadow-2xl shadow-black/60"
            style={{ left: pos.x, top: pos.y, width: MENU_WIDTH }}
          >
            <div className="mb-2 text-xs font-semibold text-text">{t("sendActions.title")}</div>
            <div className="flex flex-col gap-2">{children}</div>
          </div>,
          document.body
        )}
    </div>
  );
}
