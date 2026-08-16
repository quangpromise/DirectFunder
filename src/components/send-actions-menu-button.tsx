"use client";

import { ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Nút gộp (icon send-data.png) cạnh badge Status trên bảng Hồ sơ (thêm 2026-08-16) — trước
 * đây 4 nút gửi (Send to Sheet/Send mail to CPA/Test Sheet/Send email to client) hiện thành
 * 1 cụm icon dọc chật chội ngay cạnh Status, giờ gộp lại sau 1 nút duy nhất, bấm vào mở popup
 * liệt kê đủ 4 hành động (mỗi hành động vẫn TỰ quản lý popup con của riêng nó khi bấm vào,
 * xem cases/page.tsx — component này chỉ là cái khung chứa, không biết gì về nghiệp vụ bên
 * trong `children`). z-index popup này (95) thấp hơn mọi popup con (100) để popup con luôn
 * nổi lên trên khi mở, bất kể thứ tự DOM.
 */
export function SendActionsMenuButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const t = useT();

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("sendActions.buttonTitle")}
        aria-label={t("sendActions.buttonTitle")}
        className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-transparent transition hover:bg-surface-hover"
      >
        <img src="/send-data-icon.png" alt="" width={12} height={12} className="object-contain" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 px-4 py-8"
            onClick={() => setOpen(false)}
          >
            <div
              className="popover w-full max-w-xs rounded-2xl p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("sendActions.title")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={16} />
                </button>
              </div>
              <div className="flex flex-col gap-2.5">{children}</div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
