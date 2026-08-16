"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FlaskConical, Search, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { REFUND_YEARS } from "@/lib/refund";
import { SelectOption } from "@/lib/types";

/** Dropdown chọn 1 trong các option của cột Status (dùng làm CRM Source, thêm 2026-08-16 —
 * cùng nguồn dữ liệu với dropdown CRM Source sẵn có trong tab CPA Review), có ô tìm kiếm —
 * hữu ích khi danh sách status dài. */
function CrmSourceSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: SelectOption[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;
  const current = options.find((o) => o.id === value);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setSearch("");
          setOpen((o) => !o);
          setTimeout(() => searchRef.current?.focus(), 0);
        }}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-left text-xs outline-none transition focus:border-accent"
      >
        <span className={`truncate ${current ? "" : "text-text-faint"}`}>
          {current?.label ?? t("testSheet.crmSourcePlaceholder")}
        </span>
      </button>

      {open && (
        <div className="popover absolute left-0 top-full z-20 mt-1 w-full rounded-lg p-1.5 shadow-2xl shadow-black/60">
          <div className="relative mb-1 shrink-0">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder={t("assign.searchPlaceholder")}
              className="w-full rounded-md border border-border bg-bg-elevated py-1 pl-6 pr-2 text-xs outline-none focus:border-accent"
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-text-faint transition hover:bg-surface-hover"
              >
                <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border border-dashed border-border">
                  <X size={9} />
                </span>
                {t("clientProfile.clearUser")}
              </button>
            )}
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className="w-full truncate rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-surface-hover"
              >
                {o.label}
              </button>
            ))}
            {filtered.length === 0 && <div className="px-2 py-2 text-xs text-text-faint">{t("assign.noMatching")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Nút "Test Sheet" cạnh Status (thêm 2026-08-14) — cùng vị trí/kiểu dáng VÀ cùng cơ chế
 * trạng thái "đã gửi" với SendToSheetButton (đọc thẳng `cpaReviewTestSentAt` trên
 * CaseRecord, không dùng local useState, giữ đúng màu xanh qua reload) nhưng gửi 1 dòng
 * MỚI sang tab "CPA Review" (tháng hiện tại) thay vì Google Sheet cá nhân. Bấm lúc mặc
 * định: popup chọn năm (chọn được nhiều năm, có ô tìm kiếm lọc năm) + dropdown CRM Source
 * (có ô tìm kiếm, thêm 2026-08-16) + nút phụ "Mark as sent" (đánh dấu thủ công, KHÔNG tạo
 * dòng CPA Review thật). Bấm lại lúc đang xanh: popup xác nhận riêng "muốn gửi lại?" — đồng
 * ý mới xoá cpaReviewTestSentAt + quay về mặc định, giống hệt SendToSheetButton.
 */
export function TestSheetButton({
  caseId,
  cpaReviewTestSentAt,
  refunds,
  crmSourceOptions,
  confirm,
  alertWarn,
  sendCaseRowToCpaReview,
  markCaseCpaReviewTestSent,
}: {
  caseId: string;
  cpaReviewTestSentAt: string | null;
  refunds: Record<string, number>;
  /** Danh sách option của cột Status trên bảng Hồ sơ — dùng làm nguồn cho dropdown CRM
   * Source (thêm 2026-08-16), cùng nguồn dữ liệu với CRM Source trong tab CPA Review. */
  crmSourceOptions: SelectOption[];
  confirm: (message: string, opts?: { title?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  alertWarn: (message: string, opts?: { title?: string }) => Promise<void>;
  sendCaseRowToCpaReview: (
    caseId: string,
    reviewYears: string[],
    note?: string,
    crmSource?: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  markCaseCpaReviewTestSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
}) {
  const sent = Boolean(cpaReviewTestSentAt);
  const [sending, setSending] = useState(false);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [yearSearch, setYearSearch] = useState("");
  const [note, setNote] = useState("");
  const [crmSource, setCrmSource] = useState("");
  const t = useT();

  function toggleYear(year: string) {
    setSelectedYears((prev) => (prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]));
  }

  const filteredYears = yearSearch.trim()
    ? REFUND_YEARS.filter((y) => y.includes(yearSearch.trim()))
    : REFUND_YEARS;

  async function handleClick() {
    if (sent) {
      const confirmed = await confirm(t("testSheet.resendConfirm"), {
        title: t("testSheet.resendTitle"),
      });
      if (!confirmed) return;
      await markCaseCpaReviewTestSent(caseId, "clear");
      return;
    }
    setSelectedYears([]);
    setYearSearch("");
    setNote("");
    setCrmSource("");
    setYearPickerOpen(true);
  }

  async function confirmYears() {
    if (selectedYears.length === 0) return;
    setYearPickerOpen(false);
    const confirmed = await confirm(t("testSheet.confirmSend"), {
      title: t("testSheet.confirmSendTitle"),
    });
    if (!confirmed) return;
    setSending(true);
    try {
      const result = await sendCaseRowToCpaReview(caseId, selectedYears, note, crmSource);
      if (!result.ok) {
        await alertWarn(result.error, { title: t("testSheet.sendErrorTitle") });
      }
    } finally {
      setSending(false);
    }
  }

  /** Đánh dấu "Đã gửi" thủ công — dùng khi đã tự thêm dòng vào tab CPA Review qua đường
   * khác, chỉ muốn UI phản ánh đúng trạng thái, KHÔNG tạo dòng CPA Review thật. */
  async function markAsSent() {
    setYearPickerOpen(false);
    await markCaseCpaReviewTestSent(caseId, "manual");
  }

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={handleClick}
        disabled={sending}
        title={sent ? t("testSheet.sentTitle") : t("testSheet.notSentTitle")}
        aria-label={sent ? t("testSheet.sentTitle") : t("testSheet.notSentTitle")}
        className={`ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition disabled:cursor-default disabled:opacity-60 ${
          sent
            ? "border-green-600/70 bg-green-800/60 text-green-100 hover:bg-green-800/80 light:border-green-700 light:bg-green-600 light:text-white light:hover:bg-green-700"
            : "border-border bg-transparent text-text-faint hover:bg-surface-hover hover:text-text"
        }`}
      >
        <FlaskConical size={11} />
      </button>

      {yearPickerOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("testSheet.pickerTitle")}</h3>
                <button onClick={() => setYearPickerOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="relative mb-2">
                <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
                <input
                  value={yearSearch}
                  onChange={(e) => setYearSearch(e.target.value)}
                  placeholder={t("testSheet.yearSearchPlaceholder")}
                  className="w-full rounded-md border border-border bg-bg-elevated py-1 pl-6 pr-2 text-xs outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                {filteredYears.map((year) => {
                  const selected = selectedYears.includes(year);
                  return (
                    <button
                      key={year}
                      type="button"
                      onClick={() => toggleYear(year)}
                      className={`flex flex-col items-center gap-0.5 rounded-lg border px-3 py-2.5 transition ${
                        selected
                          ? "border-accent bg-accent-soft"
                          : "border-border bg-bg-elevated hover:border-accent hover:bg-accent-soft"
                      }`}
                    >
                      <span className="text-sm font-semibold">{year}</span>
                      <span
                        className={`text-xs ${
                          selected ? "font-semibold text-amber-600 light:text-amber-700" : "text-text-dim"
                        }`}
                      >
                        ${(refunds?.[year] ?? 0).toLocaleString("en-US")}
                      </span>
                    </button>
                  );
                })}
                {filteredYears.length === 0 && (
                  <div className="col-span-2 py-2 text-center text-xs text-text-faint">{t("assign.noMatching")}</div>
                )}
              </div>

              <label className="mt-3 block text-xs text-text-dim">
                {t("testSheet.crmSourceLabel")}
                <div className="mt-1">
                  <CrmSourceSelect value={crmSource} options={crmSourceOptions} onChange={setCrmSource} />
                </div>
              </label>

              <label className="mt-3 block text-xs text-text-dim">
                {t("testSheet.noteLabel")}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder={t("testSheet.notePlaceholder")}
                  className="mt-1 w-full resize-none rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
                />
              </label>
              <button
                type="button"
                onClick={confirmYears}
                disabled={selectedYears.length === 0}
                className="gradient-btn mt-3 w-full rounded-lg py-1.5 text-xs font-medium text-white disabled:cursor-default disabled:opacity-50"
              >
                {t("common.confirm")}
              </button>
              <button
                type="button"
                onClick={markAsSent}
                className="mt-1.5 w-full rounded-lg border border-green-600/50 bg-green-800/20 py-1.5 text-xs font-medium text-green-300 transition hover:bg-green-800/40 light:border-green-600 light:bg-green-50 light:text-green-700 light:hover:bg-green-100"
              >
                {t("testSheet.markSentBtn")}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
