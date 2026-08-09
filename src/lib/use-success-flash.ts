"use client";

import { useEffect, useState } from "react";

const SUCCESS_DISPLAY_MS = 5000;

/** Bật cờ "vừa thành công" trong 5s rồi tự tắt — dùng chung cho các nút Order (8821 /
 * TTS & WIT) hiện dấu tick xanh tạm thời sau khi đặt order thành công. */
export function useSuccessFlash(durationMs = SUCCESS_DISPLAY_MS) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(false), durationMs);
    return () => clearTimeout(timer);
  }, [active, durationMs]);

  return [active, () => setActive(true)] as const;
}
