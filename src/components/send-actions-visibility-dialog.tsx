"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { EyeOff, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { SendActionId, SendActionsHidden } from "@/lib/types";

/** 5 nút cố định trong popup "Gửi dữ liệu" (SendActionsMenuButton, xem cases/page.tsx) — id +
 * key i18n TÁI DÙNG đúng nhãn đã hiện trong popup đó, để tên trong dialog này khớp 1-1 với tên
 * người dùng thấy khi bấm nút thật. */
const SEND_ACTIONS: { id: SendActionId; labelKey: string }[] = [
  { id: "updateToCrm", labelKey: "agentc3UpdateCrm.button" },
  { id: "testSheet", labelKey: "testSheet.notSentTitle" },
  { id: "cpaEmail", labelKey: "cpaEmail.dialogTitle" },
  { id: "sheet", labelKey: "sheet.sendBtn" },
  { id: "clientEmail", labelKey: "clientEmail.confirmSendTitle" },
];

/** Dialog Admin bật/tắt TOÀN CỤC từng nút trong popup "Gửi dữ liệu" (thêm 2026-08-30, theo yêu
 * cầu "admin có thể ẩn các nút trong send data") — đặt trên trang Phân quyền (đã gate
 * manager-only sẵn ở đó), cùng vị trí với CpaEmailDefaultsDialog/GoogleSheetConfigDialog/
 * ClientEmailTemplateDialog. KHÁC hẳn FeaturePermissions (ma trận theo role, Manager luôn
 * bypass) — nút tắt ở đây biến mất với TẤT CẢ mọi người, kể cả Manager, nên đặt ở trang quản lý
 * chung thay vì trong popup của từng dòng hồ sơ (nếu Admin tắt hết cả 5 nút, popup "Gửi dữ
 * liệu" của dòng đó có thể không còn hiện ra nữa — cần 1 chỗ luôn truy cập được để bật lại).
 * Toggle bấm là lưu ngay (không có bước "Lưu" riêng), giống các danh sách bật/tắt tức thời
 * khác trong app (vd trạng thái Refund by years). */
export function SendActionsVisibilityDialog({
  value,
  onToggle,
}: {
  value: SendActionsHidden;
  onToggle: (actionId: SendActionId, hidden: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <EyeOff size={14} />
        {t("sendActionsVisibility.triggerBtn")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8" onClick={() => setOpen(false)}>
            <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("sendActionsVisibility.title")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={16} />
                </button>
              </div>
              <p className="mb-3 text-xs text-text-faint">{t("sendActionsVisibility.desc")}</p>

              <div className="flex flex-col gap-1.5">
                {SEND_ACTIONS.map(({ id, labelKey }) => {
                  const hidden = Boolean(value[id]);
                  return (
                    <label
                      key={id}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm"
                    >
                      <span className={hidden ? "text-text-faint line-through" : "text-text"}>{t(labelKey)}</span>
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={(e) => onToggle(id, !e.target.checked)}
                        className="h-4 w-4 cursor-pointer accent-accent"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
