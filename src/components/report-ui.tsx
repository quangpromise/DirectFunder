"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { ReportPeriod, currentPhoenixMonth, currentPhoenixYear } from "@/lib/report-period";
import { useT } from "@/lib/i18n";

/** Badge % tăng trưởng dùng chung cho mọi thẻ báo cáo — vàng gold khi tăng, đỏ khi
 * giảm, xám "—" khi không có dữ liệu kỳ trước để so sánh, "Mới" khi kỳ trước = 0. Tông
 * màu theo đúng phong cách BI panel vàng-đen trong Dashboard.png. */
export function GrowthBadge({ percent, label }: { percent: number | null; label?: string }) {
  const t = useT();
  if (percent === null) {
    return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-white/35">— {label}</span>;
  }
  if (percent === Infinity) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300">
        <TrendingUp size={11} /> {t("report.new")} {label}
      </span>
    );
  }
  const isFlat = Math.abs(percent) < 0.05;
  const isUp = percent > 0;
  const Icon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;
  const colorClass = isFlat ? "text-white/35" : isUp ? "text-amber-300" : "text-red-400";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${colorClass}`}>
      <Icon size={11} />
      {isFlat ? "0%" : `${isUp ? "+" : ""}${percent.toFixed(1)}%`} {label}
    </span>
  );
}

const TONE_CLASSES: Record<"amber" | "emerald" | "accent" | "red", string> = {
  amber: "border-amber-500/35 bg-gradient-to-b from-amber-500/10 to-black/40 text-amber-200",
  emerald: "border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 to-black/40 text-emerald-300",
  // "accent" = thẻ nổi bật nhất trong panel (Tổng/Giá trị) — dùng tông vàng gold đậm hơn
  // để khớp phong cách BI trong Dashboard.png, khác accent xanh dương thường dùng ở nơi khác.
  accent: "border-amber-400/50 bg-gradient-to-b from-amber-400/15 to-black/50 text-amber-100",
  red: "border-red-500/30 bg-gradient-to-b from-red-500/10 to-black/40 text-red-300",
};

const ICON_WRAP_CLASSES: Record<"amber" | "emerald" | "accent" | "red", string> = {
  amber: "bg-amber-500/15 text-amber-300",
  emerald: "bg-emerald-500/15 text-emerald-300",
  accent: "bg-amber-400/20 text-amber-200",
  red: "bg-red-500/15 text-red-300",
};

/** Thẻ số liệu kiểu BI panel vàng-đen: icon + số lớn + label, kèm badge tăng trưởng tùy
 * chọn so với kỳ trước (Hôm qua/Tháng trước/Năm trước/Kỳ trước tùy theo period đang chọn). */
export function ReportStatCard({
  icon: Icon,
  label,
  value,
  tone,
  growthPercent,
  growthLabel,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  tone: "amber" | "emerald" | "accent" | "red";
  growthPercent?: number | null;
  growthLabel?: string;
}) {
  return (
    <div className={`rounded-lg border p-2.5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl ${TONE_CLASSES[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-semibold leading-tight tracking-tight text-white">{value}</div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-white/45">{label}</div>
        </div>
        {Icon && (
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${ICON_WRAP_CLASSES[tone]}`}>
            <Icon size={13} />
          </div>
        )}
      </div>
      {growthPercent !== undefined && (
        <div className="mt-1.5 border-t border-amber-500/10 pt-1.5">
          <GrowthBadge percent={growthPercent} label={growthLabel} />
        </div>
      )}
    </div>
  );
}

/** Khung panel kiểu BI vàng-đen dùng chung cho mọi khối trong Dashboard — thanh tiêu đề
 * viền vàng gold phía trên, nền gần đen, khớp phong cách Dashboard.png. Layout gọn để
 * cả Dashboard vừa trong 1 màn hình, không cần cuộn. */
export function ReportPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-amber-500/15 bg-black/30 p-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">{title}</h2>
      {description && <p className="mt-0.5 text-[11px] text-white/35">{description}</p>}
      <div className="mt-2 border-t border-amber-500/10 pt-2">{children}</div>
    </div>
  );
}

/** Bộ chọn kỳ báo cáo dùng chung (Hôm nay/Tháng/Năm/Tùy chỉnh) cho mọi Dashboard — mỗi
 * chế độ show đúng input cần thiết (không input/tháng/năm/khoảng ngày). */
export function PeriodSelector({
  period,
  onPeriodChange,
  month,
  onMonthChange,
  year,
  onYearChange,
  customFrom,
  onCustomFromChange,
  customTo,
  onCustomToChange,
}: {
  period: ReportPeriod;
  onPeriodChange: (p: ReportPeriod) => void;
  month: string;
  onMonthChange: (m: string) => void;
  year: number;
  onYearChange: (y: number) => void;
  customFrom: string;
  onCustomFromChange: (v: string) => void;
  customTo: string;
  onCustomToChange: (v: string) => void;
}) {
  const t = useT();
  const PERIODS: { id: ReportPeriod; labelKey: string }[] = [
    { id: "today", labelKey: "report.period.today" },
    { id: "month", labelKey: "report.period.month" },
    { id: "year", labelKey: "report.period.year" },
    { id: "custom", labelKey: "report.period.custom" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex shrink-0 gap-1 rounded-lg border border-amber-500/20 bg-black/40 p-1">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              onPeriodChange(p.id);
              if (p.id === "month" && !month) onMonthChange(currentPhoenixMonth());
              if (p.id === "year" && !year) onYearChange(currentPhoenixYear());
            }}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              period === p.id
                ? "bg-gradient-to-b from-amber-400 to-amber-600 text-black shadow-[0_2px_10px_-2px_rgba(217,164,65,0.6)]"
                : "text-white/45 hover:text-amber-200"
            }`}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>

      {period === "month" && (
        <input
          type="month"
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          className="rounded-lg border border-amber-500/20 bg-black/40 px-2.5 py-1.5 text-sm text-white outline-none focus:border-amber-400"
        />
      )}

      {period === "year" && (
        <input
          type="number"
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="w-24 rounded-lg border border-amber-500/20 bg-black/40 px-2.5 py-1.5 text-sm text-white outline-none focus:border-amber-400"
        />
      )}

      {period === "custom" && (
        <>
          <label className="flex items-center gap-2 text-xs text-white/45">
            {t("orders.dashboard.fromDate")}
            <input
              type="date"
              value={customFrom}
              onChange={(e) => onCustomFromChange(e.target.value)}
              className="rounded-lg border border-amber-500/20 bg-black/40 px-2.5 py-1.5 text-sm text-white outline-none focus:border-amber-400"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-white/45">
            {t("orders.dashboard.toDate")}
            <input
              type="date"
              value={customTo}
              onChange={(e) => onCustomToChange(e.target.value)}
              className="rounded-lg border border-amber-500/20 bg-black/40 px-2.5 py-1.5 text-sm text-white outline-none focus:border-amber-400"
            />
          </label>
        </>
      )}
    </div>
  );
}
