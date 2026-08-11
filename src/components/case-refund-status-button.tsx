"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, ChevronDown } from "lucide-react";
import { RefundYearStatus } from "@/lib/types";
import { REFUND_STATUS_COLOR, REFUND_STATUS_OPTIONS, hasPendingRefundYear, refundYearRows } from "@/lib/refund-status";
import { useAppStore } from "@/store/app-store";
import { useT } from "@/lib/i18n";
import { darkenHex, withAlpha } from "@/lib/color";

const MENU_MARGIN = 8;
const MENU_WIDTH = 268;

const STATUS_I18N_KEY: Record<RefundYearStatus, string> = {
  preProcessing: "status.pre_processing",
  processing: "status.processing",
  pending: "status.pending",
  cpaReview: "status.cpa_review",
};

function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/** Badge màu theo trạng thái (đọc từ REFUND_STATUS_COLOR) — đậm hơn ở Light Mode giống
 * OptionBadge, vì màu gốc chọn để đọc được trên nền tối. */
function useStatusColor(status: RefundYearStatus) {
  const theme = useAppStore((s) => s.theme);
  const isLight = theme === "light";
  const raw = REFUND_STATUS_COLOR[status];
  return {
    bg: isLight ? withAlpha(raw.bg, 0.22) : raw.bg,
    color: isLight ? darkenHex(raw.color, 0.4) : raw.color,
  };
}

/** Dropdown 3 lựa chọn (Processing/Pending/CPA Review) cho 1 năm — không editable thì chỉ
 * hiện badge tĩnh. Đóng khi click ra ngoài (document mousedown), không cần overlay full
 * màn hình vì popup cha đã đứng trên mọi thứ khác (portal + fixed) nên clip/z-index không
 * phải lo. */
function YearStatusDropdown({
  status,
  editable,
  onChange,
}: {
  status: RefundYearStatus;
  editable: boolean;
  onChange: (status: RefundYearStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const t = useT();
  const { bg, color } = useStatusColor(status);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!editable) {
    return (
      <span
        className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
        style={{ backgroundColor: bg, color, borderColor: `${color}4d` }}
      >
        {t(STATUS_I18N_KEY[status])}
      </span>
    );
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:brightness-110"
        style={{ backgroundColor: bg, color, borderColor: `${color}4d` }}
      >
        {t(STATUS_I18N_KEY[status])}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="popover absolute right-0 top-full z-10 mt-1 w-36 rounded-lg p-1 shadow-2xl shadow-black/60">
          {REFUND_STATUS_OPTIONS.map((opt) => (
            <YearStatusOption key={opt} option={opt} onSelect={() => {
              onChange(opt);
              setOpen(false);
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

function YearStatusOption({ option, onSelect }: { option: RefundYearStatus; onSelect: () => void }) {
  const { bg, color } = useStatusColor(option);
  const t = useT();
  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center rounded-md px-1.5 py-1 text-left transition hover:bg-surface-hover"
    >
      <span
        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
        style={{ backgroundColor: bg, color, borderColor: `${color}4d` }}
      >
        {t(STATUS_I18N_KEY[option])}
      </span>
    </button>
  );
}

/** Ô nhập lý do Pending — chỉ hiện khi năm đó đang "pending". KHÔNG theo quyền `editable`
 * của dropdown trạng thái: mọi user mở popup bằng CLICK đều nhập được (đúng yêu cầu "phân
 * quyền edit và nhập text cho tất cả user"), chỉ khoá khi mở qua hover (xem `editable` prop
 * ở đây thực ra là "đang ở chế độ click", đặt tên theo view từ component cha). Commit khi
 * rời khỏi ô (blur), không đồng bộ theo từng phím gõ. */
function PendingReasonInput({
  year,
  reason,
  editable,
  onCommit,
}: {
  year: string;
  reason: string;
  editable: boolean;
  onCommit: (reason: string) => void;
}) {
  const [draft, setDraft] = useState(reason);
  const t = useT();

  // Đồng bộ draft khi `reason` đổi từ bên ngoài (người khác vừa lưu lý do khác trong lúc
  // popup đang mở) — cùng pattern với SsnSlot/EditableCell (setDraft theo prop trong
  // effect).
  useEffect(() => {
    setDraft(reason);
  }, [reason]);

  if (!editable) {
    return (
      <p className="rounded-md bg-surface px-2 py-1 text-[11px] leading-snug text-text-dim">
        {reason.trim() || <span className="text-text-faint">{t("refundStatus.reasonEmpty")}</span>}
      </p>
    );
  }

  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== reason) onCommit(draft);
      }}
      onClick={(e) => e.stopPropagation()}
      placeholder={t("refundStatus.reasonPlaceholder")}
      rows={2}
      className="w-full resize-none rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] leading-snug text-text outline-none focus:border-accent"
      aria-label={`${t("refundStatus.reasonPlaceholder")} ${year}`}
    />
  );
}

/** Nút mắt cạnh số trong cột "Case" — bấm mở popup xem/sửa trạng thái từng năm refund,
 * hover mở cùng popup nhưng chỉ xem (không sửa được). Xanh lá đứng yên nếu không có năm
 * nào Pending, đỏ nhấp nháy (xem .refund-eye-pending trong globals.css) nếu có ít nhất 1
 * năm Pending — giúp nhận ra ngay từ ngoài bảng mà không cần mở popup. */
export function CaseRefundStatusButton({
  refunds,
  refundYearStatus,
  refundYearPendingReason,
  editable,
  onChangeStatus,
  onChangeReason,
}: {
  refunds: Record<string, number>;
  refundYearStatus: Record<string, RefundYearStatus>;
  refundYearPendingReason: Record<string, string>;
  editable: boolean;
  onChangeStatus: (year: string, status: RefundYearStatus) => void;
  onChangeReason: (year: string, reason: string) => void;
}) {
  const [clickOpen, setClickOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const t = useT();

  const rows = refundYearRows(refunds, refundYearStatus);
  const pending = hasPendingRefundYear(refunds, refundYearStatus);
  const open = clickOpen || hoverOpen;
  // Mở qua hover (không click) -> luôn chỉ xem, kể cả khi có quyền sửa — chỉ khi thực sự
  // bấm vào nút mới cho sửa (và vẫn cần đủ quyền `editable`).
  const canEditNow = clickOpen && editable;
  // Lý do Pending KHÔNG giới hạn theo `editable` (quyền cột "refunds") — mọi user mở popup
  // bằng click đều nhập được, chỉ khoá khi mở qua hover (xem PendingReasonInput).
  const canEditReason = clickOpen;
  // Popup đổi chiều cao khi 1 năm chuyển sang/khỏi "pending" (hiện/ẩn ô nhập lý do) — cần
  // đo lại vị trí, không chỉ dựa vào số lượng năm (rows.length không đổi trong trường hợp
  // này).
  const rowStatusKey = rows.map((r) => r.status).join(",");

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 200;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    const spaceAbove = rect.top - MENU_MARGIN;
    const openUpward = menuHeight > spaceBelow && spaceAbove > spaceBelow;
    const y = openUpward ? rect.top - 4 - menuHeight : rect.bottom + 4;
    const x = Math.min(rect.left, window.innerWidth - MENU_WIDTH - MENU_MARGIN);
    setPos((p) => (p.x === x && p.y === y ? p : { x, y }));
  }, [open, rowStatusKey]);

  return (
    <span className="relative inline-flex" onMouseEnter={() => setHoverOpen(true)} onMouseLeave={() => setHoverOpen(false)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setClickOpen((o) => !o);
        }}
        aria-label={t("refundStatus.title")}
        title={t("refundStatus.title")}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition hover:bg-surface-hover"
      >
        <Eye size={13} className={pending ? "refund-eye-pending text-red-500" : "text-emerald-500"} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            {clickOpen && <div className="fixed inset-0 z-[90]" onClick={() => setClickOpen(false)} />}
            <div
              ref={menuRef}
              className="popover fixed z-[100] rounded-xl p-2 shadow-2xl shadow-black/60"
              style={{ left: pos.x, top: pos.y, width: MENU_WIDTH }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-1 pb-1.5 text-xs font-semibold text-text">{t("refundStatus.title")}</div>
              {rows.length === 0 ? (
                <div className="px-1 py-3 text-center text-xs text-text-faint">{t("refundStatus.empty")}</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {rows.map((r) => (
                    <div key={r.year} className="flex flex-col gap-1 rounded-lg px-1.5 py-1">
                      <div className="grid grid-cols-[36px_1fr_auto] items-center gap-2">
                        <span className="text-xs font-medium text-text-dim">{r.year}</span>
                        <span className="truncate text-xs font-semibold text-text">{formatMoney(r.amount)}</span>
                        <YearStatusDropdown status={r.status} editable={canEditNow} onChange={(s) => onChangeStatus(r.year, s)} />
                      </div>
                      {r.status === "pending" && (
                        <PendingReasonInput
                          year={r.year}
                          reason={refundYearPendingReason[r.year] ?? ""}
                          editable={canEditReason}
                          onCommit={(reason) => onChangeReason(r.year, reason)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>,
          document.body
        )}
    </span>
  );
}
