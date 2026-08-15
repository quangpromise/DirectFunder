"use client";

import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { useT } from "@/lib/i18n";
import { currentMonthKey, monthKeyLabel, shiftMonthKey } from "@/lib/cpa-review-month";

/**
 * Bộ chọn tháng cho tab CPA Review (thêm 2026-08-14, yêu cầu "khi chọn tháng nào sẽ ra bảng
 * của tháng đó") — mũi tên trái/phải đổi qua tháng liền trước/sau, nhãn giữa hiện tháng đang
 * chọn. Không dùng `<input type="month">` gốc trình duyệt vì style khác nhau giữa các trình
 * duyệt và khó theo Dark Mode nhất quán với phần còn lại của app.
 */
export function CpaReviewMonthPicker({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  const isCurrent = value === currentMonthKey();
  const t = useT();

  return (
    <div className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-surface px-1">
      <button
        type="button"
        onClick={() => onChange(shiftMonthKey(value, -1))}
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim transition hover:bg-surface-hover hover:text-text"
        aria-label={t("cpaReviewMonth.prev")}
        title={t("cpaReviewMonth.prev")}
      >
        <ChevronLeft size={15} />
      </button>
      <div className="flex min-w-[112px] items-center justify-center gap-1.5 px-1 text-sm font-medium text-text">
        <Calendar size={13} className="text-text-faint" />
        {monthKeyLabel(value)}
      </div>
      <button
        type="button"
        onClick={() => onChange(shiftMonthKey(value, 1))}
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim transition hover:bg-surface-hover hover:text-text"
        aria-label={t("cpaReviewMonth.next")}
        title={t("cpaReviewMonth.next")}
      >
        <ChevronRight size={15} />
      </button>
      {!isCurrent && (
        <button
          type="button"
          onClick={() => onChange(currentMonthKey())}
          className="ml-1 shrink-0 rounded-md border border-dashed border-border-strong px-2 py-1 text-[11px] text-text-faint transition hover:bg-surface-hover hover:text-text"
        >
          {t("cpaReviewMonth.today")}
        </button>
      )}
    </div>
  );
}
