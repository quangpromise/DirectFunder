import { prisma } from "@/lib/prisma";

/**
 * Theo dõi mức dùng Gemini free tier (`gemini-3.5-flash-lite`) so với hạn mức thật — dùng cho
 * bảng "Rate Limit" trong popup "Get Files" (xem `.claude/skills/crm-tts-wit-compare/SKILL.md`).
 * Hạn mức lấy đúng theo giá trị người dùng cung cấp (khớp free tier Google AI Studio hiện tại):
 * - RPM (request/phút): 15 — cửa sổ TRƯỢT 60 giây gần nhất (Google tính rate limit theo kiểu
 *   sliding window dựa trên timestamp request, không phải theo phút đồng hồ cố định).
 * - TPM (token/phút): 250.000 — cùng cửa sổ trượt 60 giây.
 * - RPD (request/ngày): 500 — reset lúc NỬA ĐÊM theo múi giờ Pacific Time (America/Los_Angeles,
 *   đúng hành vi reset quota hằng ngày thật của Google AI API — KHÁC múi giờ UTC/local server).
 */

export const GEMINI_RPM_LIMIT = 15;
export const GEMINI_TPM_LIMIT = 250_000;
export const GEMINI_RPD_LIMIT = 500;

const RETENTION_MS = 2 * 24 * 60 * 60 * 1000; // giữ 2 ngày — đủ dư cho cửa sổ RPD 1 ngày Pacific

/** Ghi 1 dòng usage sau MỖI lần gọi Gemini thành công — best-effort (không throw): lỗi ghi log
 * không nên làm hỏng kết quả so sánh đã có sẵn từ Gemini. */
export async function logGeminiUsage(totalTokens: number): Promise<void> {
  try {
    await prisma.geminiUsageLog.create({ data: { totalTokens: Math.max(0, Math.trunc(totalTokens)) } });
  } catch (err) {
    console.error("[gemini-usage] Ghi log usage thất bại (bỏ qua, không chặn kết quả chính):", err);
  }
}

/** Offset (phút) giữa UTC và Pacific Time TẠI THỜI ĐIỂM `date` — tự đúng cho cả PDT (UTC-7)
 * lẫn PST (UTC-8) tuỳ mùa, không hard-code 1 offset cố định. */
function pacificOffsetMinutes(date: Date): number {
  const asUtc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const asPacific = new Date(date.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return Math.round((asUtc.getTime() - asPacific.getTime()) / 60_000);
}

/** Mốc UTC tương ứng với 00:00:00 NGÀY HÔM NAY theo múi giờ Pacific — dùng làm điểm bắt đầu
 * cửa sổ RPD (Google reset quota hằng ngày đúng lúc này). */
function startOfPacificDayUtc(now: Date): Date {
  const offsetMin = pacificOffsetMinutes(now);
  const pacificClockAsUtc = new Date(now.getTime() - offsetMin * 60_000);
  const midnightPacificAsUtc = Date.UTC(
    pacificClockAsUtc.getUTCFullYear(),
    pacificClockAsUtc.getUTCMonth(),
    pacificClockAsUtc.getUTCDate()
  );
  return new Date(midnightPacificAsUtc + offsetMin * 60_000);
}

export interface RateLimitStat {
  used: number;
  limit: number;
}

export interface GeminiUsageSummary {
  rpm: RateLimitStat;
  tpm: RateLimitStat;
  rpd: RateLimitStat;
  /** Thời điểm RPD reset kế tiếp (00:00 Pacific ngày mai) — hiện cho người dùng biết còn bao
   * lâu nữa hạn mức ngày được làm mới. */
  rpdResetsAt: string;
}

export async function getGeminiUsageSummary(): Promise<GeminiUsageSummary> {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60_000);
  const dayStart = startOfPacificDayUtc(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [lastMinuteRows, todayCount] = await Promise.all([
    prisma.geminiUsageLog.findMany({
      where: { requestedAt: { gte: oneMinuteAgo } },
      select: { totalTokens: true },
    }),
    prisma.geminiUsageLog.count({ where: { requestedAt: { gte: dayStart } } }),
  ]);

  const tpmUsed = lastMinuteRows.reduce((sum, r) => sum + r.totalTokens, 0);

  return {
    rpm: { used: lastMinuteRows.length, limit: GEMINI_RPM_LIMIT },
    tpm: { used: tpmUsed, limit: GEMINI_TPM_LIMIT },
    rpd: { used: todayCount, limit: GEMINI_RPD_LIMIT },
    rpdResetsAt: dayEnd.toISOString(),
  };
}

/** Dọn log cũ hơn 2 ngày — piggyback cron/blob-cleanup (cùng lý do các piggyback khác trong
 * repo, không đăng ký thêm Cron Job riêng). */
export async function cleanupOldGeminiUsageLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const result = await prisma.geminiUsageLog.deleteMany({ where: { requestedAt: { lt: cutoff } } });
  return result.count;
}
