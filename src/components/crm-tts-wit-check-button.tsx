"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n";

type CrmDocYear = "2023" | "2024" | "2025";
const YEARS: CrmDocYear[] = ["2023", "2024", "2025"];

export interface CrmTtsWitResult {
  tts: Record<CrmDocYear, string | null>;
  wit: Record<CrmDocYear, string | null>;
}

/**
 * Nút "TTS & WIT" ở cột "Check CRM" (thay cho 2 nút "Order 8821"/"TTS & WIT" đặt lệnh cho
 * Support đã ẩn khỏi bảng Hồ sơ chính, thêm 2026-08-23) — bấm để đọc trực tiếp CRM agentc3,
 * hiện popup ngày upload mới nhất của TTS/WIT cho từng năm 2023/2024/2025 (đơn giản hoá cùng
 * ngày, sau phản hồi thực tế — bỏ hẳn cơ chế Notification/so-mốc trước đó, vì người bấm không
 * thấy kết quả tức thời). Chỉ hiện khi hồ sơ đã liên kết CRM (`hasClientLink`) — component cha
 * tự hiện "—" khi chưa liên kết.
 */
export function CrmTtsWitCheckButton({
  disabled,
  onCheck,
}: {
  disabled: boolean;
  /** null nếu lỗi (đã tự alertWarn ở nơi gọi) -> không mở popup. */
  onCheck: () => Promise<CrmTtsWitResult | null>;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CrmTtsWitResult | null>(null);
  const t = useT();

  async function handleClick() {
    setChecking(true);
    try {
      const res = await onCheck();
      if (res) setResult(res);
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || checking}
        onClick={handleClick}
        className="w-full shrink-0 cursor-pointer whitespace-nowrap rounded-md border border-amber-800/60 bg-amber-900/40 px-1 py-0.5 text-center text-[10px] font-bold leading-tight text-amber-200 transition hover:bg-amber-900/60 disabled:cursor-default disabled:opacity-60 light:border-amber-300 light:bg-amber-100 light:text-amber-900 light:hover:bg-amber-200"
      >
        {checking ? t("crmTtsWit.checking") : t("crmTtsWit.button")}
      </button>

      {result &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8" onClick={() => setResult(null)}>
            <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("crmTtsWit.resultTitle")}</h3>
                <button onClick={() => setResult(null)} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={16} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">TTS</div>
                  <div className="flex flex-col gap-1">
                    {YEARS.map((year) => (
                      <div key={year} className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-xs">
                        <span className="text-text-dim">{year}</span>
                        <span className="font-medium text-text">{result.tts[year] ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">WIT</div>
                  <div className="flex flex-col gap-1">
                    {YEARS.map((year) => (
                      <div key={year} className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-xs">
                        <span className="text-text-dim">{year}</span>
                        <span className="font-medium text-text">{result.wit[year] ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
