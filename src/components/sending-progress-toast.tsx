"use client";

import { createPortal } from "react-dom";

/**
 * Thanh tiến trình dùng CHUNG cho mọi nút gửi/upload trong popup "Send Data" (Send to Sheet/
 * Test Sheet/Send mail CPA/Send email khách hàng/Update to CRM — thêm 2026-08-24, theo yêu cầu
 * "khi send hay upload đều phải có 1 thanh tiến trình") — trước đây bấm gửi chỉ disable nút
 * (SendToSheetButton/TestSheetButton còn ĐÓNG hẳn popup chọn năm trước khi gửi, không còn gì
 * hiện ra cho tới khi xong/lỗi), người dùng không biết app có đang chạy hay bị treo.
 *
 * Portal ra `document.body`, neo cố định GIỮA màn hình (z-[200], cao hơn mọi popup z-[100] —
 * đổi từ góc dưới sang giữa 2026-08-24 theo phản hồi thực tế, dễ chú ý hơn) — không phụ thuộc
 * popup nào đang mở/đóng, luôn hiện chừng nào `show` còn true. Có `progress` (0-100, đo được
 * thật — vd upload lên Vercel Blob qua `onUploadProgress`) thì hiện thanh chạy đúng % + số %;
 * không có thì hiện thanh trượt qua lại (indeterminate) chỉ để báo "đang chạy", không bịa số %.
 */
export function SendingProgressToast({
  show,
  label,
  progress,
}: {
  show: boolean;
  label: string;
  /** 0-100, bỏ trống nếu không đo được tiến độ thật (hiện thanh trượt vô định thay vì %). */
  progress?: number;
}) {
  if (!show || typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-4">
      <div className="popover pointer-events-auto w-full max-w-xs rounded-xl px-4 py-3 shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-text">
          <span className="truncate">{label}</span>
          {typeof progress === "number" && (
            <span className="shrink-0 tabular-nums text-text-dim">{Math.round(progress)}%</span>
          )}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
          {typeof progress === "number" ? (
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent-from to-accent-to transition-[width] duration-200 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-[progress-indeterminate_1.1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-accent-from to-accent-to" />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
