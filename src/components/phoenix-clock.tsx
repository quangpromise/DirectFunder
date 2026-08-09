"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useLanguage } from "@/lib/i18n";

function formatPhoenix(date: Date): { time: string; dateStr: string } {
  const time = date.toLocaleTimeString("en-US", {
    timeZone: "America/Phoenix",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const dateStr = date.toLocaleDateString("en-US", {
    timeZone: "America/Phoenix",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return { time, dateStr };
}

export function PhoenixClock() {
  const [now, setNow] = useState<Date | null>(null);
  const { language } = useLanguage();

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;
  const { time, dateStr } = formatPhoenix(now);

  return (
    <div
      className="hidden items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-dim sm:flex"
      title={language === "en" ? "Phoenix, Arizona time (MST)" : "Giờ Phoenix, Arizona (MST)"}
    >
      <Clock size={13} className="shrink-0 text-text-faint" />
      <span className="font-medium tabular-nums">{time}</span>
      <span className="text-text-faint">{dateStr}</span>
      <span className="text-[10px] text-text-faint">MST</span>
    </div>
  );
}
