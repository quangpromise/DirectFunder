"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, ChevronDown, Settings, X, Trash2, Plus, Send, AlarmClock } from "lucide-react";
import { CollectingReportManualFields, RefundYearAlarm, RefundYearStatus, SelectOption } from "@/lib/types";
import { findRefundStatusOption, hasPendingRefundYear, refundYearRows } from "@/lib/refund-status";
import { useConfirm } from "@/components/confirm-dialog";
import { useAppStore } from "@/store/app-store";
import { useT } from "@/lib/i18n";
import { darkenHex, withAlpha, hexToRgba15, rgbaToHex } from "@/lib/color";
import { ColorSwatchPicker } from "@/components/color-swatch-picker";
import { todayIsoDate } from "@/lib/date-format";

const MENU_MARGIN = 8;
const MENU_WIDTH = 306;
const MANAGE_WIDTH = 300;
const YEAR_DROPDOWN_WIDTH = 144;

function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/** Badge màu theo trạng thái (đọc từ SelectOption.bg/color) — đậm hơn ở Light Mode giống
 * OptionBadge, vì màu gốc chọn để đọc được trên nền tối. */
function useStatusColor(option: SelectOption) {
  const theme = useAppStore((s) => s.theme);
  const isLight = theme === "light";
  return {
    bg: isLight ? withAlpha(option.bg, 0.22) : option.bg,
    color: isLight ? darkenHex(option.color, 0.4) : option.color,
  };
}

/** Dropdown chọn 1 trong các trạng thái đang cấu hình (statusOptions, Quản lý thêm/sửa/xoá
 * được — xem RefundStatusOptionsManager) cho 1 năm — không editable thì chỉ hiện badge
 * tĩnh. Đóng khi click ra ngoài (document mousedown), không cần overlay full màn hình vì
 * popup cha đã đứng trên mọi thứ khác (portal + fixed) nên clip/z-index không phải lo. Vị
 * trí dùng `position: fixed` tính theo getBoundingClientRect (giống các dropdown khác trong
 * app) — mở xổ SANG PHẢI từ mép trái nút (không còn right-0/mở sang trái) + tự lật LÊN TRÊN
 * khi không đủ chỗ bên dưới, tránh bị khuất màn hình ở những hàng gần cuối popup cha (bug
 * user báo cáo 2026-08-13 — trước đây luôn mở cố định xuống dưới/sang trái).
 */
function YearStatusDropdown({
  status,
  statusOptions,
  editable,
  onChange,
}: {
  status: RefundYearStatus;
  statusOptions: SelectOption[];
  editable: boolean;
  onChange: (status: RefundYearStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = findRefundStatusOption(statusOptions, status);
  const { bg, color } = useStatusColor(current);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
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
    const x = Math.min(rect.left, window.innerWidth - YEAR_DROPDOWN_WIDTH - MENU_MARGIN);
    setPos((p) => (p.x === x && p.y === y ? p : { x, y }));
  }, [open]);

  if (!editable) {
    return (
      <span
        className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
        style={{ backgroundColor: bg, color, borderColor: `${color}4d` }}
      >
        {current.label}
      </span>
    );
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:brightness-110"
        style={{ backgroundColor: bg, color, borderColor: `${color}4d` }}
      >
        {current.label}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="popover fixed z-[110] max-h-52 w-36 overflow-y-auto rounded-lg p-1 shadow-2xl shadow-black/60"
          style={{ left: pos.x, top: pos.y }}
        >
          {statusOptions.map((opt) => (
            <YearStatusOption
              key={opt.id}
              option={opt}
              onSelect={() => {
                onChange(opt.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function YearStatusOption({ option, onSelect }: { option: SelectOption; onSelect: () => void }) {
  const { bg, color } = useStatusColor(option);
  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center rounded-md px-1.5 py-1 text-left transition hover:bg-surface-hover"
    >
      <span
        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
        style={{ backgroundColor: bg, color, borderColor: `${color}4d` }}
      >
        {option.label}
      </span>
    </button>
  );
}

/** Badge tĩnh dùng trong RefundStatusOptionsManager — CỐ Ý không dùng OptionBadge dùng
 * chung: OptionBadge tự dịch nhãn theo id qua translateOptionLabel (DEFAULT_OPTION_LABEL_KEY
 * trong i18n.ts), map đó dùng chung id "pending"/"processing" với cột Status chính nên sẽ
 * âm thầm ghi đè label Admin vừa gõ ở đây bằng bản dịch cố định — badge preview này luôn
 * hiện ĐÚNG label Admin đang nhập. */
function StaticStatusBadge({ option }: { option: SelectOption }) {
  const { bg, color } = useStatusColor(option);
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: bg, color, borderColor: `${color}4d` }}
    >
      {option.label}
    </span>
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
  const [lastSyncedReason, setLastSyncedReason] = useState(reason);
  const t = useT();

  // Đồng bộ draft khi `reason` đổi từ bên ngoài (người khác vừa lưu lý do khác trong lúc
  // popup đang mở) — điều chỉnh state NGAY TRONG lúc render (so với snapshot lần render
  // trước) thay vì trong effect, theo khuyến nghị react-hooks/set-state-in-effect (tránh
  // 1 lượt render thừa mỗi lần reason đổi).
  if (reason !== lastSyncedReason) {
    setLastSyncedReason(reason);
    setDraft(reason);
  }

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

/** Icon đồng hồ đặt trước dropdown Status mỗi năm — bấm mở 1 ô `<input type="date">` inline
 * (không dùng popover nổi riêng vì popup cha đã là fixed/portal, lồng thêm 1 lớp portal nữa
 * chỉ để định vị 1 ô ngày là quá mức cần thiết). Icon xám khi chưa đặt lịch, xanh dương khi
 * đã đặt (còn hạn), đỏ nhấp nháy (`.refund-eye-pending`, tái dùng animation có sẵn) khi đã
 * QUÁ HẠN mà cron vẫn chưa kịp bắn thông báo (rất hiếm, chỉ lộ ra trong khung giờ giữa lúc
 * quá hạn và lần cron chạy tiếp theo). KHÔNG giới hạn theo `editable` (quyền cột "refunds")
 * — giống PendingReasonInput, đây chỉ là tiện ích nhắc việc cá nhân, mọi user mở popup bằng
 * click đều đặt được. */
function AlarmClockButton({
  year,
  alarm,
  canEdit,
  onSetDate,
}: {
  year: string;
  alarm: RefundYearAlarm | null | undefined;
  canEdit: boolean;
  onSetDate: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const hasAlarm = Boolean(alarm?.date);
  const overdue = Boolean(alarm?.date && !alarm.notifiedAt && alarm.date <= todayIsoDate());

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (canEdit) setOpen((o) => !o);
        }}
        title={
          hasAlarm
            ? t("refundStatus.alarmSetTitle", { date: alarm!.date })
            : canEdit
              ? t("refundStatus.alarmSetNew")
              : t("refundStatus.alarmNone")
        }
        aria-label={t("refundStatus.alarmTitle")}
        className={`flex h-5 w-5 items-center justify-center rounded-full transition ${
          canEdit ? "hover:bg-surface-hover" : "cursor-default"
        }`}
      >
        <AlarmClock
          size={12}
          className={overdue ? "refund-eye-pending text-red-500" : hasAlarm ? "text-accent-from" : "text-text-faint"}
        />
      </button>
      {open && (
        <div
          className="popover absolute left-0 top-6 z-[120] flex items-center gap-1 rounded-lg p-1.5 shadow-2xl shadow-black/60"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="date"
            value={alarm?.date ?? ""}
            autoFocus
            onChange={(e) => {
              onSetDate(e.target.value || null);
              setOpen(false);
            }}
            aria-label={`${t("refundStatus.alarmTitle")} ${year}`}
            className="rounded-md border border-border bg-bg-elevated px-1.5 py-1 text-[11px] text-text outline-none focus:border-accent"
          />
          {hasAlarm && (
            <button
              type="button"
              onClick={() => {
                onSetDate(null);
                setOpen(false);
              }}
              title={t("refundStatus.alarmClear")}
              aria-label={t("refundStatus.alarmClear")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-red-400"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Bảng quản lý danh sách trạng thái (thêm/sửa/xoá/đổi màu) — mở qua nút bánh răng trong
 * popup, chỉ hiện cho tài khoản có quyền (canManage, xem CaseRefundStatusButton). Cùng
 * pattern UI với phần "options" trong ColumnSettingsDialog. Option id "pending" là id đặc
 * biệt (nhấp nháy đỏ + ô nhập lý do, xem hasPendingRefundYear) — không cho xoá qua đây dù
 * vẫn đổi tên/màu tự do được. */
function RefundStatusOptionsManager({
  options,
  onAdd,
  onUpdate,
  onRemove,
  onClose,
}: {
  options: SelectOption[];
  onAdd: (option: Omit<SelectOption, "id">) => void;
  onUpdate: (optionId: string, patch: Partial<Omit<SelectOption, "id">>) => void;
  onRemove: (optionId: string) => void;
  onClose: () => void;
}) {
  const [newLabel, setNewLabel] = useState("");
  const { confirm, ConfirmDialogUI } = useConfirm();
  const t = useT();

  function handleAdd() {
    if (!newLabel.trim()) return;
    onAdd({ label: newLabel.trim(), bg: "rgba(139,92,246,0.15)", color: "#c4b5fd" });
    setNewLabel("");
  }

  async function handleRemove(optionId: string, label: string) {
    if (await confirm(t("col.removeOptionConfirm", { label }), { title: t("col.removeOptionTitle"), tone: "danger" })) {
      onRemove(optionId);
    }
  }

  return (
    <div style={{ width: MANAGE_WIDTH }}>
      {ConfirmDialogUI}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="px-1 text-xs font-semibold text-text">{t("refundStatus.manageTitle")}</span>
        <button onClick={onClose} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
          <X size={14} />
        </button>
      </div>
      <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-0.5">
        {options.map((o) => {
          const protectedOption = o.id === "pending";
          return (
            <div key={o.id} className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-2 py-1.5">
              <ColorSwatchPicker value={o.color} onChange={(hex) => onUpdate(o.id, { color: hex })} title={t("col.textColor")} />
              <ColorSwatchPicker
                value={rgbaToHex(o.bg)}
                onChange={(hex) => onUpdate(o.id, { bg: hexToRgba15(hex) })}
                title={t("col.bgColor")}
              />
              <input
                value={o.label}
                onChange={(e) => onUpdate(o.id, { label: e.target.value })}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none hover:border-border focus:border-accent"
              />
              <div className="shrink-0">
                <StaticStatusBadge option={o} />
              </div>
              <button
                onClick={() => !protectedOption && handleRemove(o.id, o.label)}
                disabled={protectedOption}
                title={protectedOption ? t("refundStatus.protectedOption") : t("col.removeOption")}
                className="shrink-0 text-text-faint hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-text-faint"
                aria-label={t("col.removeOption")}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={t("col.newOptionPlaceholder")}
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={handleAdd}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-border-strong px-3 text-xs font-medium text-text-dim hover:bg-surface-hover hover:text-text"
        >
          <Plus size={12} />
          {t("common.add")}
        </button>
      </div>
    </div>
  );
}

const PROGRAM_OPTIONS = ["EC", "1099"];
const PAYMENT_METHOD_OPTIONS = ["Zelle", "Check", "Venmo", "Cash", "Credit"];

function toNumberOrNull(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-text-dim">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
      />
    </div>
  );
}

/** Popup nhập tay các trường Collecting mở khi bấm nút "Send" trước mỗi năm trong popup
 * "Refund by years" (thêm 2026-08-16) — Name/Phone/Agent 1-2/ACCT/Year/Qual. Amount đã tự
 * tính ở server (buildCollectingCustomFromCase) nên KHÔNG có ở đây, chỉ những trường không
 * suy ra được từ Case mới cần người dùng tự nhập. */
function SendCollectingReportDialog({
  year,
  onClose,
  onSubmit,
}: {
  year: string;
  onClose: () => void;
  onSubmit: (manual: CollectingReportManualFields) => Promise<void>;
}) {
  const [program, setProgram] = useState("");
  const [taxOffset, setTaxOffset] = useState(false);
  const [approvedAmt, setApprovedAmt] = useState("");
  const [upfrontFees, setUpfrontFees] = useState("");
  const [totalCollected, setTotalCollected] = useState("");
  const [pmtMethod, setPmtMethod] = useState("");
  const [note, setNote] = useState("");
  const [tips, setTips] = useState("");
  const [receiptCheckNo, setReceiptCheckNo] = useState("");
  const [receiptCheckAmt, setReceiptCheckAmt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const t = useT();

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit({
        program,
        taxOffset,
        approvedAmt: toNumberOrNull(approvedAmt),
        upfrontFees: toNumberOrNull(upfrontFees),
        totalCollected: toNumberOrNull(totalCollected),
        pmtMethod,
        note,
        tips: toNumberOrNull(tips),
        receiptCheckNo,
        receiptCheckAmt: toNumberOrNull(receiptCheckAmt),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 px-4 py-8" onClick={onClose}>
      <div
        className="popover max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("collectingReport.dialogTitle", { year })}</h3>
          <button onClick={onClose} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-[11px] text-text-dim">{t("collectingReport.program")}</label>
            <div className="flex gap-2">
              {PROGRAM_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProgram(p)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    program === p ? "border-accent bg-accent-soft" : "border-border bg-bg-elevated hover:border-accent"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-text-dim">{t("collectingReport.taxOffset")}</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTaxOffset(true)}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  taxOffset ? "border-accent bg-accent-soft" : "border-border bg-bg-elevated hover:border-accent"
                }`}
              >
                {t("common.yes")}
              </button>
              <button
                type="button"
                onClick={() => setTaxOffset(false)}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  !taxOffset ? "border-accent bg-accent-soft" : "border-border bg-bg-elevated hover:border-accent"
                }`}
              >
                {t("common.no")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <MoneyField label={t("collectingReport.approvedAmt")} value={approvedAmt} onChange={setApprovedAmt} />
            <MoneyField label={t("collectingReport.upfrontFees")} value={upfrontFees} onChange={setUpfrontFees} />
          </div>
          <MoneyField label={t("collectingReport.totalCollected")} value={totalCollected} onChange={setTotalCollected} />

          <div>
            <label className="mb-1 block text-[11px] text-text-dim">{t("collectingReport.pmtMethod")}</label>
            <select
              value={pmtMethod}
              onChange={(e) => setPmtMethod(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
            >
              <option value="">—</option>
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <MoneyField label={t("collectingReport.tips")} value={tips} onChange={setTips} />
            <MoneyField label={t("collectingReport.receiptCheckAmt")} value={receiptCheckAmt} onChange={setReceiptCheckAmt} />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-text-dim">{t("collectingReport.receiptCheckNo")}</label>
            <input
              value={receiptCheckNo}
              onChange={(e) => setReceiptCheckNo(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-text-dim">{t("collectingReport.note")}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="gradient-btn mt-4 w-full rounded-lg py-1.5 text-xs font-medium text-white disabled:cursor-default disabled:opacity-50"
        >
          {t("common.confirm")}
        </button>
      </div>
    </div>,
    document.body
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
  refundYearAlarm,
  statusOptions,
  editable,
  canManageOptions,
  onChangeStatus,
  onChangeReason,
  onSetAlarm,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
  canSendCollectingReport,
  onSendCollectingReport,
}: {
  refunds: Record<string, number>;
  refundYearStatus: Record<string, RefundYearStatus>;
  refundYearPendingReason: Record<string, string>;
  refundYearAlarm: Record<string, RefundYearAlarm | null>;
  statusOptions: SelectOption[];
  editable: boolean;
  /** Admin (manager) — thêm/sửa/xoá trạng thái trong danh sách qua nút bánh răng. */
  canManageOptions: boolean;
  onChangeStatus: (year: string, status: RefundYearStatus) => void;
  onChangeReason: (year: string, reason: string) => void;
  /** Đặt/xoá lịch nhắc TTS & WIT cho 1 năm — date = null để xoá. */
  onSetAlarm: (year: string, date: string | null) => void;
  onAddOption: (option: Omit<SelectOption, "id">) => void;
  onUpdateOption: (optionId: string, patch: Partial<Omit<SelectOption, "id">>) => void;
  onRemoveOption: (optionId: string) => void;
  /** Quyền dùng nút "Send Collecting Report" trước mỗi năm (thêm 2026-08-16) — dùng lại
   * feature `addCollectingRow` đã có sẵn (tạo dòng mới ở tab Collecting), không phải quyền
   * sửa cột refunds nên tách riêng khỏi `editable`. */
  canSendCollectingReport: boolean;
  onSendCollectingReport: (year: string, manual: CollectingReportManualFields) => Promise<void>;
}) {
  const [clickOpen, setClickOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [sendYear, setSendYear] = useState<string | null>(null);
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
  // Popup đổi chiều cao khi 1 năm chuyển sang/khỏi "pending" (hiện/ẩn ô nhập lý do) hoặc khi
  // mở/đóng bảng quản lý options — cần đo lại vị trí.
  const rowStatusKey = rows.map((r) => r.status).join(",");

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = managing ? MANAGE_WIDTH : MENU_WIDTH;
    const menuHeight = menuRef.current?.offsetHeight ?? 200;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    // Mở LÊN TRÊN bất cứ khi nào không đủ chỗ bên dưới — trước đây còn so sánh thêm
    // "spaceAbove > spaceBelow" khiến vài hàng gần cuối màn hình (chỗ trên VÀ dưới đều hẹp,
    // nhưng chỗ dưới nhỉnh hơn 1 chút) vẫn bị chọn mở xuống rồi tràn khuất dưới màn hình —
    // đúng bug user báo cáo 2026-08-12. Không cần biết chỗ trên có thực sự đủ hay không ở
    // bước này, đã kẹp cứng trong khung nhìn ngay bên dưới.
    const openUpward = menuHeight > spaceBelow;
    let y = openUpward ? rect.top - 4 - menuHeight : rect.bottom + 4;
    // Kẹp cứng trong khung nhìn — phòng trường hợp cả trên lẫn dưới đều không đủ chỗ (màn
    // hình quá thấp/popup quá cao), đảm bảo popup luôn hiện trọn vẹn thay vì vẫn bị khuất.
    y = Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - menuHeight - MENU_MARGIN));
    const x = Math.min(rect.left, window.innerWidth - width - MENU_MARGIN);
    setPos((p) => (p.x === x && p.y === y ? p : { x, y }));
  }, [open, rowStatusKey, managing]);

  // "managing" phải reset về false mỗi lần popup đóng (không dựa vào effect theo clickOpen —
  // react-hooks/set-state-in-effect khuyến nghị xử lý ngay tại nơi thực sự đóng popup thay
  // vì suy ra từ 1 effect riêng) — 2 nơi đóng popup: nút trigger (toggle) và backdrop.
  function closePopup() {
    setClickOpen(false);
    setManaging(false);
  }

  return (
    <span className="relative inline-flex" onMouseEnter={() => setHoverOpen(true)} onMouseLeave={() => setHoverOpen(false)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (clickOpen) closePopup();
          else setClickOpen(true);
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
            {clickOpen && <div className="fixed inset-0 z-[90]" onClick={closePopup} />}
            <div
              ref={menuRef}
              className="popover fixed z-[100] rounded-xl p-2 shadow-2xl shadow-black/60"
              style={{ left: pos.x, top: pos.y, width: managing ? MANAGE_WIDTH : MENU_WIDTH }}
              onClick={(e) => e.stopPropagation()}
            >
              {managing ? (
                <RefundStatusOptionsManager
                  options={statusOptions}
                  onAdd={onAddOption}
                  onUpdate={onUpdateOption}
                  onRemove={onRemoveOption}
                  onClose={() => setManaging(false)}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between px-1 pb-1.5">
                    <span className="text-xs font-semibold text-text">{t("refundStatus.title")}</span>
                    <div className="flex items-center gap-2">
                      {clickOpen && canManageOptions && (
                        <button
                          onClick={() => setManaging(true)}
                          className="text-text-faint transition hover:text-text"
                          title={t("refundStatus.manageTitle")}
                          aria-label={t("refundStatus.manageTitle")}
                        >
                          <Settings size={13} />
                        </button>
                      )}
                      {/* Mở qua click không còn tự đóng khi rê chuột ra khỏi popup (yêu cầu
                          2026-08-13) — phải bấm nút X này (hoặc bấm ra ngoài/bấm lại icon
                          mắt) mới đóng, để không bị tắt giữa chừng lúc đang sửa nhiều năm. */}
                      {clickOpen && (
                        <button
                          onClick={closePopup}
                          className="text-text-faint transition hover:text-text"
                          title={t("common.close")}
                          aria-label={t("common.close")}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {rows.length === 0 ? (
                    <div className="px-1 py-3 text-center text-xs text-text-faint">{t("refundStatus.empty")}</div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {rows.map((r) => (
                        <div key={r.year} className="flex flex-col gap-1 rounded-lg px-1.5 py-1">
                          <div className="grid grid-cols-[20px_36px_1fr_20px_100px] items-center gap-2">
                            {clickOpen && canSendCollectingReport ? (
                              <button
                                type="button"
                                onClick={() => setSendYear(r.year)}
                                title={t("collectingReport.sendButtonTitle")}
                                aria-label={t("collectingReport.sendButtonTitle")}
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-faint transition hover:bg-surface-hover hover:text-accent"
                              >
                                <Send size={11} />
                              </button>
                            ) : (
                              <span className="h-5 w-5" aria-hidden="true" />
                            )}
                            <span className="text-xs font-medium text-text-dim">{r.year}</span>
                            <span className="truncate text-xs font-semibold text-text">{formatMoney(r.amount)}</span>
                            <AlarmClockButton
                              year={r.year}
                              alarm={refundYearAlarm[r.year]}
                              canEdit={clickOpen}
                              onSetDate={(date) => onSetAlarm(r.year, date)}
                            />
                            <div className="flex justify-center">
                              <YearStatusDropdown
                                status={r.status}
                                statusOptions={statusOptions}
                                editable={canEditNow}
                                onChange={(s) => onChangeStatus(r.year, s)}
                              />
                            </div>
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
                </>
              )}
            </div>
          </>,
          document.body
        )}

      {sendYear && typeof document !== "undefined" && (
        <SendCollectingReportDialog
          year={sendYear}
          onClose={() => setSendYear(null)}
          onSubmit={async (manual) => {
            await onSendCollectingReport(sendYear, manual);
            setSendYear(null);
          }}
        />
      )}
    </span>
  );
}
