"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, FlaskConical, X } from "lucide-react";
import { REFUND_YEARS } from "@/lib/refund";

/**
 * Nút "Test Sheet" cạnh Status (thêm 2026-08-14) — cùng vị trí/kiểu dáng VÀ cùng cơ chế
 * trạng thái "đã gửi" với SendToSheetButton (đọc thẳng `cpaReviewTestSentAt` trên
 * CaseRecord, không dùng local useState, giữ đúng màu xanh qua reload) nhưng gửi 1 dòng
 * MỚI sang tab "CPA Review" (tháng hiện tại) thay vì Google Sheet cá nhân. Bấm lúc mặc
 * định: popup chọn năm (chọn được nhiều năm) + nút phụ "Mark as sent" (đánh dấu thủ công,
 * KHÔNG tạo dòng CPA Review thật). Bấm lại lúc đang xanh: popup xác nhận riêng "muốn gửi
 * lại?" — đồng ý mới xoá cpaReviewTestSentAt + quay về mặc định, giống hệt SendToSheetButton.
 */
export function TestSheetButton({
  caseId,
  cpaReviewTestSentAt,
  refunds,
  confirm,
  alertWarn,
  sendCaseRowToCpaReview,
  markCaseCpaReviewTestSent,
}: {
  caseId: string;
  cpaReviewTestSentAt: string | null;
  refunds: Record<string, number>;
  confirm: (message: string, opts?: { title?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  alertWarn: (message: string, opts?: { title?: string }) => Promise<void>;
  sendCaseRowToCpaReview: (
    caseId: string,
    reviewYears: string[],
    note?: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  markCaseCpaReviewTestSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
}) {
  const sent = Boolean(cpaReviewTestSentAt);
  const [sending, setSending] = useState(false);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [note, setNote] = useState("");

  function toggleYear(year: string) {
    setSelectedYears((prev) => (prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]));
  }

  async function handleClick() {
    if (sent) {
      const confirmed = await confirm("Bạn có muốn gửi lại hồ sơ này sang tab CPA Review không?", {
        title: "Gửi lại Test Sheet",
      });
      if (!confirmed) return;
      await markCaseCpaReviewTestSent(caseId, "clear");
      return;
    }
    setSelectedYears([]);
    setNote("");
    setYearPickerOpen(true);
  }

  async function confirmYears() {
    if (selectedYears.length === 0) return;
    setYearPickerOpen(false);
    const confirmed = await confirm("Gửi thông tin hồ sơ này sang tab CPA Review (tháng hiện tại)?", {
      title: "Test Sheet",
    });
    if (!confirmed) return;
    setSending(true);
    try {
      const result = await sendCaseRowToCpaReview(caseId, selectedYears, note);
      if (!result.ok) {
        await alertWarn(result.error, { title: "Gửi thất bại" });
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
        title={sent ? "Đã gửi sang tab CPA Review" : "Test Sheet (gửi sang tab CPA Review)"}
        aria-label={sent ? "Đã gửi sang tab CPA Review" : "Test Sheet (gửi sang tab CPA Review)"}
        className={`ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition disabled:cursor-default disabled:opacity-60 ${
          sent
            ? "border-green-600/70 bg-green-800/60 text-green-100 hover:bg-green-800/80 light:border-green-700 light:bg-green-600 light:text-white light:hover:bg-green-700"
            : "border-border bg-transparent text-text-faint hover:bg-surface-hover hover:text-text"
        }`}
      >
        {sent ? <CheckCircle2 size={11} /> : <FlaskConical size={11} />}
      </button>

      {yearPickerOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Test Sheet — chọn năm gửi</h3>
                <button onClick={() => setYearPickerOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {REFUND_YEARS.map((year) => {
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
              </div>
              <label className="mt-3 block text-xs text-text-dim">
                Note (sẽ đổ vào cột &quot;Note&quot; ở tab CPA Review)
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Không bắt buộc..."
                  className="mt-1 w-full resize-none rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
                />
              </label>
              <button
                type="button"
                onClick={confirmYears}
                disabled={selectedYears.length === 0}
                className="gradient-btn mt-3 w-full rounded-lg py-1.5 text-xs font-medium text-white disabled:cursor-default disabled:opacity-50"
              >
                Xác nhận
              </button>
              <button
                type="button"
                onClick={markAsSent}
                className="mt-1.5 w-full rounded-lg border border-green-600/50 bg-green-800/20 py-1.5 text-xs font-medium text-green-300 transition hover:bg-green-800/40 light:border-green-600 light:bg-green-50 light:text-green-700 light:hover:bg-green-100"
              >
                Đánh dấu đã gửi
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
