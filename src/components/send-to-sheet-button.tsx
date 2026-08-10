"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Send, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { REFUND_YEARS } from "@/lib/refund";

type SendResult = { ok: true } | { ok: false; error: string; needsGoogleAuth?: boolean };

/**
 * Nút nhỏ ngay sau badge Status — chỉ render khi hồ sơ đang ở trạng thái "cpa_review"
 * (điều kiện lọc ở nơi gọi, xem cases/page.tsx). Bấm vào lúc mặc định: hiện popup "Bạn
 * muốn CPA Review năm nào?" (4 nút năm + số tiền refund tương ứng, lấy từ Edit Hồ sơ —
 * CHỌN ĐƯỢC NHIỀU NĂM CÙNG LÚC, nút đã chọn đổi màu số tiền sang cam đậm) → bấm nút Gửi
 * riêng bên dưới → popup xác nhận gửi → gửi (kèm danh sách năm đã chọn, server dùng để
 * điền cột ảo "Số tiền CPA Review" = TỔNG refund của các năm đã chọn nếu Admin có cấu
 * hình cột này — xem CPA_REVIEW_MONEY_COLUMN_ID) → thành công chuyển xanh lá đậm BỀN VỮNG
 * (không tự tắt). Bấm lại lúc đang xanh: hiện popup xác nhận RIÊNG "muốn gửi lại?" — đồng
 * ý mới quay về mặc định (KHÔNG gửi lại ngay, không mở lại popup chọn năm), phải bấm thêm
 * 1 lần nữa (lúc này đã về mặc định) mới thực sự đi lại từ đầu (chọn năm → xác nhận →
 * gửi) — 2 lớp xác nhận độc lập cho 2 hành động khác nhau, khác useSuccessFlash tự tắt
 * sau 5s của các nút Order.
 */
export function SendToSheetButton({
  caseId,
  refunds,
  confirm,
  alertWarn,
  sendCaseRowToSheet,
  connectGoogleAccount,
}: {
  caseId: string;
  refunds: Record<string, number>;
  confirm: (message: string, opts?: { title?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  alertWarn: (message: string, opts?: { title?: string }) => Promise<void>;
  sendCaseRowToSheet: (caseId: string, reviewYears?: string[]) => Promise<SendResult>;
  connectGoogleAccount: () => Promise<boolean>;
}) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const t = useT();

  async function doSend(reviewYears: string[]) {
    setSending(true);
    try {
      let result = await sendCaseRowToSheet(caseId, reviewYears);
      if (!result.ok && result.needsGoogleAuth) {
        const connected = await connectGoogleAccount();
        if (!connected) return;
        result = await sendCaseRowToSheet(caseId, reviewYears);
      }
      if (result.ok) {
        setSent(true);
      } else {
        await alertWarn(result.error, { title: t("sheet.sendErrorTitle") });
      }
    } finally {
      setSending(false);
    }
  }

  async function handleClick() {
    if (sent) {
      const confirmed = await confirm(t("sheet.confirmResend"), { title: t("sheet.confirmResendTitle") });
      if (!confirmed) return;
      setSent(false);
      return;
    }
    setSelectedYears([]);
    setYearPickerOpen(true);
  }

  function toggleYear(year: string) {
    setSelectedYears((prev) => (prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]));
  }

  async function confirmYears() {
    if (selectedYears.length === 0) return;
    setYearPickerOpen(false);
    const confirmed = await confirm(t("sheet.confirmSend"), { title: t("sheet.confirmSendTitle") });
    if (!confirmed) return;
    await doSend(selectedYears);
  }

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={handleClick}
        disabled={sending}
        title={sent ? t("sheet.sentHint") : t("sheet.sendBtn")}
        aria-label={sent ? t("sheet.sentHint") : t("sheet.sendBtn")}
        className={`ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition disabled:cursor-default disabled:opacity-60 ${
          sent
            ? "border-green-600/70 bg-green-800/60 text-green-100 hover:bg-green-800/80 light:border-green-700 light:bg-green-600 light:text-white light:hover:bg-green-700"
            : "border-border bg-transparent text-text-faint hover:bg-surface-hover hover:text-text"
        }`}
      >
        {sent ? <CheckCircle2 size={11} /> : <Send size={11} />}
      </button>

      {yearPickerOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("sheet.yearPickerTitle")}</h3>
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
                        ${(refunds[year] ?? 0).toLocaleString("en-US")}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={confirmYears}
                disabled={selectedYears.length === 0}
                className="gradient-btn mt-3 w-full rounded-lg py-1.5 text-xs font-medium text-white disabled:cursor-default disabled:opacity-50"
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
