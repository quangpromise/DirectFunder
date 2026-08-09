"use client";

import { CheckCircle2 } from "lucide-react";
import { useSuccessFlash } from "@/lib/use-success-flash";

/**
 * Nút đặt order ĐƠN GIẢN (không popup chọn client) — dùng khi client đã xác định sẵn
 * theo ngữ cảnh (vd. cột Order 8821 phụ trong tab Order TTS & WIT, mỗi dòng đã ứng với
 * đúng 1 client cụ thể). onConfirm tự lo toàn bộ xác nhận + validate + đặt order, trả
 * về true khi thành công -> nút hiện tick xanh 5s rồi tự quay về mặc định.
 */
export function OrderPlaceButton({
  label,
  placedLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  placedLabel: string;
  disabled: boolean;
  onConfirm: () => Promise<boolean | void> | boolean | void;
}) {
  const [justPlaced, flashPlaced] = useSuccessFlash();

  async function handleClick() {
    const success = await onConfirm();
    if (success) flashPlaced();
  }

  return (
    <button
      disabled={disabled || justPlaced}
      onClick={handleClick}
      className={`w-full shrink-0 cursor-pointer whitespace-nowrap rounded-md border px-1.5 py-1 text-center text-[10px] font-bold leading-tight transition disabled:cursor-default ${
        justPlaced
          ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-300 light:text-emerald-700"
          : "border-border bg-transparent text-text-faint hover:bg-surface-hover"
      }`}
    >
      {justPlaced ? (
        <span className="flex items-center justify-center gap-1">
          <CheckCircle2 size={12} className="shrink-0" />
          {placedLabel}
        </span>
      ) : (
        label
      )}
    </button>
  );
}
