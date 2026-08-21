"use client";

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useT } from "@/lib/i18n";

const MENU_MARGIN = 8;
const MENU_WIDTH = 260;

/**
 * Nút gộp (icon send-data-icon.png, phóng to 2026-08-16) cạnh badge Status trên bảng Hồ sơ —
 * trước đây 4 nút gửi (Send to Sheet/Send mail to CPA/Test Sheet/Send email to client) hiện
 * thành 1 cụm icon dọc chật chội ngay cạnh Status, giờ gộp lại sau 1 nút duy nhất. Bấm vào mở
 * popup dạng dropdown neo theo vị trí nút (giống AssignMenu/CaseRefundStatusButton) thay vì
 * modal toàn màn hình — KHÔNG mở khi hover nữa (đã bỏ theo yêu cầu 2026-08-16, chỉ còn bấm +
 * click ra ngoài để đóng). `allSent` (thêm cùng đợt) — true khi TẤT CẢ hành động đang hiện
 * trong popup đã ở trạng thái "đã gửi" (tính ở nơi gọi, xem cases/page.tsx) — nút tự đổi màu
 * xanh lá giống các nút con bên trong khi đã gửi hết, ngược lại giữ màu trung tính mặc định.
 * Mỗi hành động bên trong `children` TỰ quản lý popup con của riêng nó khi bấm vào — component
 * này chỉ là khung chứa, không biết gì về nghiệp vụ bên trong.
 */
export function SendActionsMenuButton({ children, allSent }: { children: ReactNode; allSent: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      // Không đóng nếu click xảy ra bên trong BẤT KỲ popup con nào (Send to Sheet/CPA
      // email/Test Sheet/Client email, kể cả confirm/alert bật lên sau đó khi bấm nút Gửi/
      // Mark as sent) — mỗi popup con TỰ portal thẳng ra document.body, không nằm trong DOM
      // của menuRef nên phép contains() ở trên không nhận ra, khiến trước đây bấm Gửi/Mark
      // as sent bên trong popup con vô tình bị tính là "click ra ngoài" và đóng mất popup
      // cha (thêm 2026-08-16). Nhận diện qua class ".popover" dùng chung cho mọi
      // dialog/popup trong app thay vì dò từng ref riêng lẻ.
      if (target instanceof Element && target.closest(".popover")) return;
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
        onClick={() => setOpen((o) => !o)}
        title={t("sendActions.buttonTitle")}
        aria-label={t("sendActions.buttonTitle")}
        className={`ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition ${
          allSent
            ? "border-green-600/70 bg-green-800/60 hover:bg-green-800/80 light:border-green-700 light:bg-green-600 light:hover:bg-green-700"
            : "border-border bg-transparent hover:bg-surface-hover"
        }`}
      >
        <Image src="/send-data-icon.png" alt="" width={18} height={18} className="object-contain" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
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
