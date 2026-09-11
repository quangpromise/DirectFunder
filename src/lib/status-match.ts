import type { SelectOption } from "./types";

/** Chuẩn hoá để so khớp status không phân biệt hoa/thường, dấu câu, số ít/nhiều — vd CRM trả
 * "Missing Doc"/"Missing Doc Process"/"Missing Docs Process" đều phải khớp đúng option "Missing
 * Docs" trong Direct Funder. Chỉ lấy 2 TỪ ĐẦU (đủ phân biệt các status hiện có, tránh khớp nhầm
 * 2 status khác nhau chỉ vì trùng 1 từ đầu như "Processing"). Dùng chung cho cả chiều NHẬP (CRM
 * → Direct Funder, `agentc3-import/fetch`) lẫn chiều GHI NGƯỢC (Update to CRM → Direct Funder,
 * thêm 2026-09-11). */
export function normalizeStatusPrefix(label: string): string {
  const words = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  return words.slice(0, 2).join(" ");
}

export function matchStatusId(rawStatus: string, options: SelectOption[] | undefined): string | null {
  if (!rawStatus.trim() || !options) return null;
  const exact = options.find((o) => o.label.trim().toLowerCase() === rawStatus.trim().toLowerCase());
  if (exact) return exact.id;
  const rawPrefix = normalizeStatusPrefix(rawStatus);
  if (!rawPrefix) return null;
  return options.find((o) => normalizeStatusPrefix(o.label) === rawPrefix)?.id ?? null;
}
