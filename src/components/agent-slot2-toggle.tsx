"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Settings, X } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Nút cài đặt nhỏ cạnh header "Agent" — chỉ có đúng 1 việc: ẩn/hiện dòng "Agent 2" (slot giao
 * việc thứ 2, xếp chồng trong CÙNG 1 cột với "Agent") cho MỌI user. Tách riêng khỏi
 * `ColumnSettingsDialog` (dùng cho cột dữ liệu thật, có rename/editableBy/xoá) vì "Agent 2"
 * chỉ là 1 cột giả lưu trạng thái `hiddenFromGrid`, không có gì khác để quản lý — dùng chung
 * dialog đầy đủ sẽ hiện thừa các mục không áp dụng (đổi tên, phân quyền sửa, xoá cột) gây
 * nhầm lẫn. Xem `agentSlot2` trong DEFAULT_COLUMNS (rbac.ts).
 */
export function AgentSlot2Toggle({ hidden, onSetHidden }: { hidden: boolean; onSetHidden: (hidden: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const t = useT();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 rounded text-text-faint opacity-0 transition hover:text-text group-hover/head:opacity-100"
        title={t("col.settingsBtn", { label: "Agent 2" })}
        aria-label={t("col.settingsBtn", { label: "Agent 2" })}
      >
        <Settings size={12} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex w-full max-w-sm flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">Agent 2</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>
              <div className="mt-4 px-5">
                <label className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={hidden}
                    onChange={(e) => onSetHidden(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span>{t("col.hideFromGrid")}</span>
                </label>
                <p className="mt-1 text-[11px] text-text-faint">{t("col.hideFromGridNote")}</p>
              </div>
              <div className="mt-5 flex justify-end px-5 pb-5">
                <button
                  onClick={() => setOpen(false)}
                  className="gradient-btn rounded-lg px-4 py-2 text-sm font-medium text-white"
                >
                  {t("common.done")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
