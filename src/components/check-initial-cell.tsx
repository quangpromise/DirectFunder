"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { CheckInitialValue } from "@/lib/types";
import { CHECK_INITIAL_ITEMS, EMPTY_CHECK_INITIAL } from "@/lib/check-initial";
import { useAppStore } from "@/store/app-store";
import { darkenHex } from "@/lib/color";

/** Cùng tông xanh lá với badge trạng thái "approved" (xem DEFAULT_COLUMNS trong rbac.ts,
 * option approved: color "#86efac") — đậm hơn ở Light Mode giống cách OptionBadge xử lý
 * màu badge (pastel chọn để đọc trên nền tối, cần đậm hơn trên nền sáng), để nhất quán ý
 * nghĩa "đã tick/đạt" xuyên suốt app. */
const APPROVED_GREEN = "#86efac";
/** Tông đỏ cùng độ đậm/nhạt với APPROVED_GREEN (khớp badge "cancelled" trong DEFAULT_COLUMNS)
 * — dùng cho "Back Tax Owed: Yes" (2026-08-13). */
const WARNING_RED = "#fca5a5";

/** Ô cột "Check Initial" — 5 checkbox độc lập (EL before/after 07/16, Security Check,
 * Agent guarantees SC, Bank Information), mỗi ô tick/bỏ tick lưu ngay lập tức (giống
 * EditableCell type "boolean", không cần bước xác nhận). Bypass EditableCell hoàn toàn
 * (giống cách "order"/"ssn" đã làm) vì giá trị là 1 object nhiều field, không phải string/
 * number/boolean đơn của EditableCell. Dùng <button> tự vẽ ô vuông + dấu tick (thay vì
 * input[type=checkbox] mặc định của trình duyệt) để kiểm soát được màu dấu tick/chữ khi
 * đã tick — khớp đúng màu status "approved".
 *
 * Quy tắc ẩn/hiện (2026-08-11): mặc định chỉ hiện "EL before 07/16", "EL after 07/16",
 * "Bank Information". 2 mốc EL loại trừ nhau HOÀN TOÀN — tick mốc nào thì ẨN HẲN mốc còn
 * lại (giống cơ chế Security Check/Agent guarantees SC), muốn quay lại mốc kia phải bỏ
 * tick mốc đang chọn trước. Riêng tick "EL after 07/16" còn hiện thêm "Security
 * Check"/"Agent guarantees SC" (2 checkbox này chỉ có ý nghĩa với mốc "sau 07/16"), 2
 * checkbox đó tiếp tục loại trừ nhau như rule cũ. Bỏ tick "EL after 07/16" (trực tiếp hoặc
 * gián tiếp do tick "EL before 07/16") sẽ tự xoá Security Check/Agent guarantees SC luôn,
 * tránh dữ liệu ẩn nhưng vẫn "true" gây hiểu nhầm khi xem lại. */
export function CheckInitialCell({
  value,
  editable,
  onCommit,
}: {
  value: CheckInitialValue | undefined;
  editable: boolean;
  onCommit: (next: CheckInitialValue) => void;
}) {
  const theme = useAppStore((s) => s.theme);
  const checkedColor = theme === "light" ? darkenHex(APPROVED_GREEN, 0.4) : APPROVED_GREEN;
  const warningColor = theme === "light" ? darkenHex(WARNING_RED, 0.35) : WARNING_RED;
  const current = value ?? EMPTY_CHECK_INITIAL;
  const [backTaxExpanded, setBackTaxExpanded] = useState(false);

  function toggle(key: keyof CheckInitialValue) {
    if (!editable) return;
    const next: CheckInitialValue = { ...current, [key]: !current[key] };
    // 2 mốc EL loại trừ nhau — tick mốc này tự bỏ tick mốc kia, đồng thời xoá luôn
    // Security Check/Agent guarantees SC (chỉ có ý nghĩa khi "EL after 07/16" đang tick).
    if (key === "elBefore0716" && next.elBefore0716) {
      next.elAfter0716 = false;
    }
    if (key === "elAfter0716") {
      if (next.elAfter0716) next.elBefore0716 = false;
    }
    if (!next.elAfter0716) {
      next.securityCheck = false;
      next.agentGuaranteesSc = false;
    }
    // "Security Check" và "Agent guarantees SC" loại trừ nhau (cùng thể hiện 1 ý nghĩa: đã
    // kiểm tra bảo mật trực tiếp HOẶC Agent đứng ra bảo đảm) — tick cái này tự bỏ tick cái
    // kia ở dữ liệu, đồng thời ẨN HẲN nút kia khỏi danh sách (không chỉ hiện xám/chưa tick)
    // cho tới khi bỏ tick lại.
    if (key === "securityCheck" && next.securityCheck) next.agentGuaranteesSc = false;
    if (key === "agentGuaranteesSc" && next.agentGuaranteesSc) next.securityCheck = false;
    onCommit(next);
  }

  /** Chọn 1 trong 3 nút con Yes/No/Collected Upfront Fee — tự thu gọn lại panel sau khi
   * chọn (bấm lại nút "Back Tax Owed" để mở ra đổi lựa chọn khác). */
  function pickBackTaxOwed(next: CheckInitialValue["backTaxOwed"]) {
    if (!editable) return;
    onCommit({ ...current, backTaxOwed: next });
    setBackTaxExpanded(false);
  }

  const visibleItems = CHECK_INITIAL_ITEMS.filter((item) => {
    if (item.key === "elAfter0716" && current.elBefore0716) return false;
    if (item.key === "elBefore0716" && current.elAfter0716) return false;
    if ((item.key === "securityCheck" || item.key === "agentGuaranteesSc") && !current.elAfter0716) return false;
    if (item.key === "securityCheck" && current.agentGuaranteesSc) return false;
    if (item.key === "agentGuaranteesSc" && current.securityCheck) return false;
    return true;
  });

  return (
    <div className="flex h-full w-full items-center justify-center px-1.5 py-1">
      {/* Chiều rộng khối CỐ ĐỊNH bằng inline style (KHÔNG dùng w-fit tự co theo nội dung
          đang render) — ước lượng đủ chứa nhãn dài nhất ("Agent guarantees SC"). Nhờ cố
          định cứng, khi nhãn dài nhất bị lọc khỏi danh sách (đang ẩn do loại trừ với
          Security Check) thì width KHÔNG co lại theo nhãn còn hiện -> checkbox không bị
          thụt vào trong, cả khối vẫn nằm đúng 1 vị trí, được căn giữa nhờ justify-center
          của div cha. Nút bị ẩn LOẠI HẲN khỏi mảng render (không giữ chỗ) nên không để lại
          khoảng trống dọc — EL/Bank Information co sát lại bình thường. */}
      <div className="flex flex-col gap-0.5" style={{ width: 168 }}>
        {visibleItems.map((item) => {
          const checked = Boolean(current[item.key]);
          return (
            <button
              key={item.key}
              type="button"
              title={item.label}
              disabled={!editable}
              onClick={() => toggle(item.key)}
              className={`flex items-center gap-1 text-[10px] font-medium leading-tight transition disabled:cursor-default ${
                editable ? "cursor-pointer" : "cursor-default"
              } ${checked ? "" : "text-text-dim"}`}
              style={checked ? { color: checkedColor } : undefined}
            >
              <span
                className="flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border border-border-strong"
                style={checked ? { borderColor: checkedColor, backgroundColor: `${checkedColor}33` } : undefined}
              >
                {checked && <Check size={9} strokeWidth={3.5} style={{ color: checkedColor }} />}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}

        {/* "Back Tax Owed" (thêm 2026-08-13) — bấm vào nút chính để mở/đóng 3 nút con
            Yes/No/Collected Upfront Fee, KHÔNG tự đặt giá trị (khác 5 checkbox boolean ở
            trên). Yes tô đỏ, No tô xanh, Collected Upfront Fee tô xanh + thêm hậu tố
            "(Collected)" vào nhãn. */}
        <div>
          <button
            type="button"
            title="Back Tax Owed"
            disabled={!editable}
            onClick={() => editable && setBackTaxExpanded((v) => !v)}
            className={`flex w-full items-center gap-1 text-[10px] font-medium leading-tight transition disabled:cursor-default ${
              editable ? "cursor-pointer" : "cursor-default"
            } ${current.backTaxOwed ? "" : "text-text-dim"}`}
            style={
              current.backTaxOwed === "yes"
                ? { color: warningColor }
                : current.backTaxOwed === "no" || current.backTaxOwed === "collected"
                  ? { color: checkedColor }
                  : undefined
            }
          >
            <span
              className="flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border border-border-strong"
              style={
                current.backTaxOwed === "yes"
                  ? { borderColor: warningColor, backgroundColor: `${warningColor}33` }
                  : current.backTaxOwed === "no" || current.backTaxOwed === "collected"
                    ? { borderColor: checkedColor, backgroundColor: `${checkedColor}33` }
                    : undefined
              }
            >
              {current.backTaxOwed === "yes" && <Check size={9} strokeWidth={3.5} style={{ color: warningColor }} />}
              {(current.backTaxOwed === "no" || current.backTaxOwed === "collected") && (
                <Check size={9} strokeWidth={3.5} style={{ color: checkedColor }} />
              )}
            </span>
            <span className="truncate">Back Tax Owed{current.backTaxOwed === "collected" ? " (Collected)" : ""}</span>
          </button>
          {backTaxExpanded && editable && (
            <div className="mt-0.5 flex flex-wrap gap-1 pl-4">
              <button
                type="button"
                onClick={() => pickBackTaxOwed("yes")}
                className="rounded-full border px-1.5 py-0.5 text-[9px] font-medium leading-none transition hover:brightness-110"
                style={
                  current.backTaxOwed === "yes"
                    ? { borderColor: warningColor, backgroundColor: `${warningColor}33`, color: warningColor }
                    : { borderColor: "var(--border-strong)" }
                }
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => pickBackTaxOwed("no")}
                className="rounded-full border px-1.5 py-0.5 text-[9px] font-medium leading-none transition hover:brightness-110"
                style={
                  current.backTaxOwed === "no"
                    ? { borderColor: checkedColor, backgroundColor: `${checkedColor}33`, color: checkedColor }
                    : { borderColor: "var(--border-strong)" }
                }
              >
                No
              </button>
              <button
                type="button"
                onClick={() => pickBackTaxOwed("collected")}
                className="rounded-full border px-1.5 py-0.5 text-[9px] font-medium leading-none transition hover:brightness-110"
                style={
                  current.backTaxOwed === "collected"
                    ? { borderColor: checkedColor, backgroundColor: `${checkedColor}33`, color: checkedColor }
                    : { borderColor: "var(--border-strong)" }
                }
              >
                Collected Upfront Fee
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
