"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app-store";

const DURATION_MS = 2000;

/**
 * Hồ sơ vừa chuyển status sang "CPA Review" -> phát video ăn mừng toàn màn hình 2 giây
 * (đúng bằng độ dài video đã cắt) rồi tự biến mất. `celebration` là nonce (timestamp)
 * đổi mỗi lần trigger — dùng ref
 * `seenRef` khởi tạo bằng giá trị đọc được lúc mount để KHÔNG tự phát lại khi giá trị cũ
 * được Zustand persist rehydrate từ lần trước (persist lưu toàn bộ state, không loại trừ
 * field này).
 */
export function StatusCelebrationOverlay() {
  const celebration = useAppStore((s) => s.celebration);
  const [visible, setVisible] = useState(false);
  const seenRef = useRef(celebration);

  useEffect(() => {
    if (celebration !== null && celebration !== seenRef.current) {
      seenRef.current = celebration;
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), DURATION_MS);
      return () => clearTimeout(timer);
    }
    seenRef.current = celebration;
  }, [celebration]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[300] flex items-center justify-center bg-black/50">
      <div className="flex h-[72vmin] w-[72vmin] items-center justify-center overflow-hidden rounded-full bg-black shadow-2xl shadow-black/60">
        {/* object-contain (thay vì object-cover) để hiện đủ toàn bộ khung hình video,
            không bị cắt viền trên/dưới — khung tròn giữ nguyên kích thước hiện tại. */}
        <video src="/status-cpa-review.mp4" autoPlay muted playsInline className="h-full w-full object-contain" />
      </div>
    </div>
  );
}
