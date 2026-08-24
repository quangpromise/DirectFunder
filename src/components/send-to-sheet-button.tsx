"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Send, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { REFUND_YEARS } from "@/lib/refund";
import { SendingProgressToast } from "@/components/sending-progress-toast";

type SendResult = { ok: true } | { ok: false; error: string; needsGoogleAuth?: boolean };

/**
 * Nút nhỏ ngay sau badge Status — chỉ render khi hồ sơ đang ở trạng thái "cpa_review"
 * (điều kiện lọc ở nơi gọi, xem cases/page.tsx). "Đã gửi hay chưa" (`sent`) tính THẲNG từ
 * `sheetSentAt` (prop, đọc từ CaseRecord — server lưu xuống DB khi gửi thật/Mark as sent
 * thành công) chứ KHÔNG dùng local useState nữa — nhờ vậy trạng thái xanh giữ nguyên qua
 * reload/deploy lại (trước đây chỉ ở React state nên F5 là mất).
 *
 * Bấm vào lúc mặc định: hiện popup "Bạn muốn CPA Review năm nào?" (4 nút năm + số tiền
 * refund tương ứng, lấy từ Edit Hồ sơ — CHỌN ĐƯỢC NHIỀU NĂM CÙNG LÚC, nút đã chọn đổi màu
 * số tiền sang cam đậm) → bấm nút Gửi riêng bên dưới → popup xác nhận gửi → gửi (kèm danh
 * sách năm đã chọn, server dùng để điền cột ảo "Số tiền CPA Review" = TỔNG refund của các
 * năm đã chọn nếu Admin có cấu hình cột này — xem CPA_REVIEW_MONEY_COLUMN_ID) → thành công
 * chuyển xanh lá đậm BỀN VỮNG (không tự tắt). Popup chọn năm còn có nút phụ "Mark as sent"
 * (markCaseSheetSent) — dùng khi đã gửi thủ công qua đường khác, chỉ lưu sheetSentAt mà
 * KHÔNG gọi Google Sheets API thật. Bấm lại lúc đang xanh: hiện popup xác nhận RIÊNG "muốn
 * gửi lại?" — đồng ý mới xoá sheetSentAt + quay về mặc định (KHÔNG gửi lại ngay, không mở
 * lại popup chọn năm), phải bấm thêm 1 lần nữa (lúc này đã về mặc định) mới thực sự đi
 * lại từ đầu (chọn năm → xác nhận/Mark as sent) — 2 lớp xác nhận độc lập cho 2 hành động
 * khác nhau, khác useSuccessFlash tự tắt sau 5s của các nút Order.
 */
export function SendToSheetButton({
  caseId,
  sheetSentAt,
  refunds,
  confirm,
  alertWarn,
  sendCaseRowToSheet,
  markCaseSheetSent,
  connectGoogleAccount,
}: {
  caseId: string;
  sheetSentAt: string | null;
  refunds: Record<string, number>;
  confirm: (message: string, opts?: { title?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  alertWarn: (message: string, opts?: { title?: string }) => Promise<void>;
  sendCaseRowToSheet: (caseId: string, reviewYears?: string[]) => Promise<SendResult>;
  markCaseSheetSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
  connectGoogleAccount: () => Promise<boolean>;
}) {
  const sent = Boolean(sheetSentAt);
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
      if (!result.ok) {
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
      await markCaseSheetSent(caseId, "clear");
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

  /** Đánh dấu "Đã gửi" thủ công — dùng khi CPA/Processor đã tự gửi dòng lên Google Sheet
   * qua đường khác (không qua nút Send của app) và chỉ muốn UI phản ánh đúng trạng thái,
   * KHÔNG gọi API gửi thật (không kèm reviewYears vì không có ý nghĩa ở đây). Vẫn đi vào
   * đúng vòng lặp xác nhận gửi lại như khi gửi thật (bấm lại lúc đang xanh -> hỏi "muốn
   * gửi lại?" -> đồng ý mới quay về mặc định). */
  async function markAsSent() {
    setYearPickerOpen(false);
    await markCaseSheetSent(caseId, "manual");
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
            : "border-orange-700/60 bg-orange-900/40 text-orange-200 hover:bg-orange-900/60 light:border-orange-400 light:bg-orange-100 light:text-orange-900 light:hover:bg-orange-200"
        }`}
      >
        <Send size={11} />
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
                        ${(refunds?.[year] ?? 0).toLocaleString("en-US")}
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
              <button
                type="button"
                onClick={markAsSent}
                className="mt-1.5 w-full rounded-lg border border-green-600/50 bg-green-800/20 py-1.5 text-xs font-medium text-green-300 transition hover:bg-green-800/40 light:border-green-600 light:bg-green-50 light:text-green-700 light:hover:bg-green-100"
              >
                {t("sheet.markSentBtn")}
              </button>
            </div>
          </div>,
          document.body
        )}

      <SendingProgressToast show={sending} label={t("sheet.sending")} />
    </div>
  );
}
