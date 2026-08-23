"use client";

import { useId } from "react";

/**
 * Spinner dùng chung cho MỌI trạng thái loading trong app (thêm 2026-08-24) — vòng tròn hở
 * xoay, viền gradient xanh dương -> xanh lá kèm glow nhẹ, lấy cảm hứng từ hiệu ứng loading
 * của Gemini (@loading.webp: vòng tròn gradient xanh dương-xanh lá phát sáng trên nền tối).
 * Thay thế `<Loader2 className="animate-spin" />` (lucide-react) ở mọi nơi trong app — vẫn
 * dùng animation xoay `animate-spin` có sẵn của Tailwind (rẻ, chạy trên compositor) thay vì
 * tự viết keyframe riêng.
 *
 * `useId()` để mỗi instance có id gradient riêng — tránh 2 spinner cùng hiện trên 1 trang
 * (rất hay gặp: 1 nút "Đang lưu..." + 1 dòng "Đang tải..." khác) đụng id `<linearGradient>`
 * trong DOM.
 */
export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  const gradientId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`spinner-glow animate-spin ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
      </defs>
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="34 22"
        fill="none"
      />
    </svg>
  );
}
