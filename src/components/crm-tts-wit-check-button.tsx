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
 * Nút "Check log" ở cột "TTS & WIT Lastest" (thay cho 2 nút "Order 8821"/"TTS & WIT" đặt lệnh
 * cho Support đã ẩn khỏi bảng Hồ sơ chính, thêm 2026-08-23) — bấm để đọc trực tiếp CRM agentc3,
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
        className="inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-amber-800/60 bg-amber-900/40 px-2 py-1 text-center text-[10px] font-bold leading-tight text-amber-200 transition hover:bg-amber-900/60 disabled:cursor-default disabled:opacity-60 light:border-amber-300 light:bg-amber-100 light:text-amber-900 light:hover:bg-amber-200"
      >
        {checking ? t("crmTtsWit.checking") : t("crmTtsWit.button")}
      </button>

      {result &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8" onClick={() => setResult(null)}>
            <div className="popover w-full max-w-md rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("crmTtsWit.resultTitle")}</h3>
                <button onClick={() => setResult(null)} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={16} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">TTS</div>
                  <div className="flex flex-col gap-1.5">
                    {YEARS.map((year) => (
                      <div key={year} className="rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5">
                        <div className="text-[10px] leading-none text-text-dim">{year}</div>
                        <div className="mt-1 whitespace-nowrap text-xs font-medium leading-none tabular-nums text-text">
                          {result.tts[year] ?? "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">WIT</div>
                  <div className="flex flex-col gap-1.5">
                    {YEARS.map((year) => (
                      <div key={year} className="rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5">
                        <div className="text-[10px] leading-none text-text-dim">{year}</div>
                        <div className="mt-1 whitespace-nowrap text-xs font-medium leading-none tabular-nums text-text">
                          {result.wit[year] ?? "—"}
                        </div>
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
