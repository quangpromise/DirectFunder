"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useSuccessFlash } from "@/lib/use-success-flash";

/**
 * Nút "TTS & WIT" ở cột "Check CRM" (thay cho 2 nút "Order 8821"/"TTS & WIT" đặt lệnh cho
 * Support đã ẩn khỏi bảng Hồ sơ chính, thêm 2026-08-23) — bấm để kiểm tra ngay CRM agentc3 xem
 * có file TTS/WIT mới hơn lần kiểm tra trước không (POST /api/agentc3-import/check-latest-tts).
 * Không có submenu chọn Client 1/2 như 2 nút cũ vì kiểm tra áp dụng cho cả hồ sơ. Chỉ hiện khi
 * hồ sơ đã liên kết CRM (`hasClientLink`) — component cha tự hiện "—" khi chưa liên kết.
 */
export function CrmTtsWitCheckButton({
  disabled,
  onCheck,
}: {
  disabled: boolean;
  /** Trả về true nếu lượt kiểm tra chạy xong (bất kể có tìm thấy gì mới hay không) -> nút
   * flash xanh 2s. false/undefined nếu lỗi (đã tự alertWarn ở nơi gọi) -> không flash. */
  onCheck: () => Promise<boolean | void>;
}) {
  const [checking, setChecking] = useState(false);
  const [justChecked, flashChecked] = useSuccessFlash();
  const t = useT();

  async function handleClick() {
    setChecking(true);
    try {
      const ok = await onCheck();
      if (ok) flashChecked();
    } finally {
      setChecking(false);
    }
  }

  return (
    <button
      type="button"
      disabled={disabled || checking || justChecked}
      onClick={handleClick}
      className={`w-full shrink-0 cursor-pointer whitespace-nowrap rounded-md border px-1 py-0.5 text-center text-[10px] font-bold leading-tight transition disabled:cursor-default ${
        justChecked
          ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-300 light:text-emerald-700"
          : "border-amber-800/60 bg-amber-900/40 text-amber-200 hover:bg-amber-900/60 light:border-amber-300 light:bg-amber-100 light:text-amber-900 light:hover:bg-amber-200"
      }`}
    >
      {justChecked ? (
        <span className="flex items-center justify-center gap-1">
          <CheckCircle2 size={12} className="shrink-0" />
          {t("crmTtsWit.checked")}
        </span>
      ) : checking ? (
        t("crmTtsWit.checking")
      ) : (
        t("crmTtsWit.button")
      )}
    </button>
  );
}
