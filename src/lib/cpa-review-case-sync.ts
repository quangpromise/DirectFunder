import { prisma } from "./prisma";
import { digitsOnly } from "./ssn";
import { DEFAULT_REFUND_YEAR_STATUS_OPTIONS } from "./rbac";
import { broadcastCaseChanged } from "./pusher-server";
import type { SelectOption } from "./types";
import type { Prisma } from "@prisma/client";

/**
 * Đồng bộ 1 CHIỀU (thêm 2026-08-14, mở rộng 2026-08-15): đổi Status theo năm ở tab "CPA
 * Review" sang 1 trong các giá trị dưới đây -> tự đổi `refundYearStatus[year]` của Case
 * khớp SSN (popup "Refund by years"/mắt cạnh cột Case ở bảng Hồ sơ) sang đúng nhãn tương
 * ứng. KHÔNG đồng bộ ngược lại (sửa refundYearStatus ở bảng Hồ sơ không ảnh hưởng tab CPA
 * Review) — chỉ các giá trị liệt kê ở đây có ánh xạ, mọi giá trị Status khác của CPA Review
 * bị bỏ qua.
 */
const CPA_STATUS_TO_REFUND_YEAR_LABEL: Record<string, string> = {
  accepted: "Submitted",
  tts_refund: "Funded",
  done: "Collected",
  resubmitted: "Re-submitted",
};

/** Màu badge cho nhãn tự tạo lần đầu (nếu Admin chưa từng có sẵn nhãn này trong
 * refundYearStatusOptions) — không cần khớp màu Admin đã tuỳ biến, chỉ cần có màu hợp lý. */
const AUTO_OPTION_COLOR: Record<string, { bg: string; color: string }> = {
  Submitted: { bg: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  Funded: { bg: "rgba(34,197,94,0.15)", color: "#86efac" },
  Collected: { bg: "rgba(168,85,247,0.15)", color: "#d8b4fe" },
  "Re-submitted": { bg: "rgba(234,179,8,0.15)", color: "#fde047" },
};

function yearFromStatusKey(key: string): string | null {
  const m = /^status_(\d{4})$/.exec(key);
  return m ? m[1] : null;
}

/** Tách các key `status_<year>` trong `custom` mới ghi (chỉ những field THỰC SỰ có trong
 * request, không phải toàn bộ custom đã merge) — trả về danh sách (năm, giá trị) hợp lệ. */
export function extractChangedYearStatuses(incomingCustom: Record<string, unknown>): { year: string; status: string }[] {
  const result: { year: string; status: string }[] = [];
  for (const [key, value] of Object.entries(incomingCustom)) {
    const year = yearFromStatusKey(key);
    if (year && typeof value === "string" && CPA_STATUS_TO_REFUND_YEAR_LABEL[value]) {
      result.push({ year, status: value });
    }
  }
  return result;
}

async function findCaseIdBySsnField(ssnField: string): Promise<string | null> {
  const tokens = ssnField
    .split(/\s+/)
    .map(digitsOnly)
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const cases = await prisma.case.findMany({ select: { id: true, ssn: true } });
  for (const c of cases) {
    const ssnArr = (c.ssn as unknown as (string | null)[] | null) ?? [];
    for (const s of ssnArr) {
      if (s && tokens.includes(digitsOnly(s))) return c.id;
    }
  }
  return null;
}

/** Tìm id option có nhãn khớp (không phân biệt hoa/thường) trong refundYearStatusOptions
 * hiện tại — tự thêm mới (KHÔNG xoá/đổi option nào khác) nếu chưa có, giống cách "pending"
 * là id đặc biệt code tham chiếu trực tiếp nhưng option khác vẫn tự do (mục 4.17). */
async function ensureRefundYearStatusOptionId(label: string): Promise<string> {
  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const options = (config?.refundYearStatusOptions as unknown as SelectOption[] | null) ?? DEFAULT_REFUND_YEAR_STATUS_OPTIONS;
  const existing = options.find((o) => o.label.trim().toLowerCase() === label.toLowerCase());
  if (existing) return existing.id;

  const palette = AUTO_OPTION_COLOR[label] ?? { bg: "rgba(107,114,128,0.15)", color: "#d1d5db" };
  const newOption: SelectOption = { id: `refstatus-${label.toLowerCase()}`, label, ...palette };
  const nextOptions = [...options, newOption];
  await prisma.appConfig.update({
    where: { id: "singleton" },
    data: { refundYearStatusOptions: nextOptions as unknown as Prisma.InputJsonValue },
  });
  return newOption.id;
}

/** Thực thi đồng bộ — gọi từ PATCH /api/cpa-review/[id] sau khi lưu, chạy nền (after()),
 * không chặn response chính. Không tìm thấy Case khớp SSN nào -> bỏ qua im lặng (CPA Review
 * là bảng độc lập, không phải mọi dòng đều ứng với 1 Case có sẵn trong app). */
export async function syncCpaReviewStatusToCase(
  ssnField: string,
  changedYearStatuses: { year: string; status: string }[]
): Promise<void> {
  if (changedYearStatuses.length === 0) return;
  const caseId = await findCaseIdBySsnField(ssnField);
  if (!caseId) return;

  const patch: Record<string, string> = {};
  for (const { year, status } of changedYearStatuses) {
    const label = CPA_STATUS_TO_REFUND_YEAR_LABEL[status];
    patch[year] = await ensureRefundYearStatusOptionId(label);
  }

  // Merge NGUYÊN TỬ bằng toán tử jsonb `||` ngay trong câu UPDATE (thay vì đọc rồi ghi đè
  // toàn bộ field) — tránh mất dữ liệu nếu 2 năm bị đổi gần như cùng lúc (2 lần gọi hàm này
  // của cùng 1 hồ sơ chồng lấn nhau, lần ghi sau đọc thấy dữ liệu cũ chưa kịp cập nhật của
  // lần trước rồi ghi đè mất).
  await prisma.$executeRaw`UPDATE "cases" SET "refundYearStatus" = "refundYearStatus" || ${JSON.stringify(patch)}::jsonb WHERE id = ${caseId}`;
  await broadcastCaseChanged(caseId, null);
}
