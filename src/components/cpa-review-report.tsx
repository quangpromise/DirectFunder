"use client";

import { Trophy } from "lucide-react";
import { CPA_REVIEW_VISIBLE_YEARS, yearAmountKey, yearStatusKey } from "@/lib/cpa-review-columns";
import type { CpaReviewRecord, User } from "@/lib/types";

/**
 * Tab "Báo cáo" trong CPA Review (thêm 2026-08-16) — 2 bảng xếp hạng Agent/Processor tính
 * theo THÁNG đang chọn (dùng chung `rows` đã lọc theo tháng từ trang cha) và CHỈ 3 năm đang
 * hiện trên bảng chính (CPA_REVIEW_VISIBLE_YEARS, không tính năm 2022 đang ẩn) — theo xác
 * nhận của user. "Total Case" đếm số LƯỢT năm có "Số tiền" > 0 (không phải Tổng, không tính
 * Other Refund) cộng dồn qua MỌI hồ sơ được gán cho người đó — ví dụ 1 hồ sơ có tiền ở 3 năm
 * thì tính 3, không phải 1.
 */

interface AgentStat {
  userId: string;
  name: string;
  totalCase: number;
  over1000: number;
  under1000: number;
  collected: number;
}

interface ProcessorStat {
  userId: string;
  name: string;
  totalCase: number;
}

function computeAgentStats(rows: CpaReviewRecord[], agentUsers: User[]): AgentStat[] {
  const stats = new Map<string, AgentStat>();
  for (const u of agentUsers) stats.set(u.id, { userId: u.id, name: u.name, totalCase: 0, over1000: 0, under1000: 0, collected: 0 });
  for (const row of rows) {
    const agentId = row.custom.agentUserId as string | undefined;
    if (!agentId) continue;
    const stat = stats.get(agentId);
    if (!stat) continue;
    for (const year of CPA_REVIEW_VISIBLE_YEARS) {
      const amount = row.custom[yearAmountKey(year)];
      if (typeof amount === "number" && amount > 0) {
        stat.totalCase += 1;
        if (amount > 1000) stat.over1000 += 1;
      }
      if (row.custom[yearStatusKey(year)] === "done") stat.collected += 1;
    }
  }
  for (const stat of stats.values()) stat.under1000 = stat.totalCase - stat.over1000;
  return Array.from(stats.values()).sort((a, b) => b.totalCase - a.totalCase);
}

function computeProcessorStats(rows: CpaReviewRecord[], processorUsers: User[]): ProcessorStat[] {
  const stats = new Map<string, ProcessorStat>();
  for (const u of processorUsers) stats.set(u.id, { userId: u.id, name: u.name, totalCase: 0 });
  for (const row of rows) {
    const processorId = row.custom.processorUserId as string | undefined;
    if (!processorId) continue;
    const stat = stats.get(processorId);
    if (!stat) continue;
    for (const year of CPA_REVIEW_VISIBLE_YEARS) {
      const amount = row.custom[yearAmountKey(year)];
      if (typeof amount === "number" && amount > 0) stat.totalCase += 1;
    }
  }
  return Array.from(stats.values()).sort((a, b) => b.totalCase - a.totalCase);
}

const RANK_STYLES = [
  "border-amber-400/50 bg-amber-400/10 text-amber-300", // #1 vàng
  "border-slate-300/40 bg-slate-300/10 text-slate-200", // #2 bạc
  "border-orange-500/40 bg-orange-500/10 text-orange-300", // #3 đồng
];
/** Highlight nhẹ cả HÀNG cho top 3 (khác RANK_STYLES chỉ áp cho badge thứ hạng) — theo yêu
 * cầu "3 hạng đầu sẽ highlight lên". */
const RANK_ROW_BG = ["bg-amber-400/5", "bg-slate-300/5", "bg-orange-500/5"];

function RankBadge({ rank }: { rank: number }) {
  const style = RANK_STYLES[rank - 1];
  if (!style) {
    return <span className="flex h-6 w-6 items-center justify-center text-xs text-text-faint">{rank}</span>;
  }
  return (
    <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${style}`}>
      {rank <= 3 ? <Trophy size={12} /> : rank}
    </span>
  );
}

export function CpaReviewReportView({
  rows,
  agentUsers,
  processorUsers,
}: {
  rows: CpaReviewRecord[];
  agentUsers: User[];
  processorUsers: User[];
}) {
  const agentStats = computeAgentStats(rows, agentUsers);
  const processorStats = computeProcessorStats(rows, processorUsers);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex-1 rounded-xl border border-border-strong bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-text">Báo cáo Agent</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-table-head-bg text-[10px] font-semibold uppercase tracking-wide text-table-head-text">
                  <th className="w-12 px-3 py-2 text-center"></th>
                  <th className="px-3 py-2 text-left">Agent</th>
                  <th className="px-3 py-2 text-center">Total Case</th>
                  <th className="px-3 py-2 text-center">&gt;$1000</th>
                  <th className="px-3 py-2 text-center">&lt;$1000</th>
                  <th className="px-3 py-2 text-center">Collected</th>
                </tr>
              </thead>
              <tbody>
                {agentStats.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-xs text-text-faint">
                      Chưa có Agent nào trong hệ thống.
                    </td>
                  </tr>
                )}
                {agentStats.map((s, i) => {
                  const rank = i + 1;
                  const highlighted = rank <= 3;
                  return (
                    <tr
                      key={s.userId}
                      className={`border-b border-border last:border-0 ${
                        highlighted ? RANK_ROW_BG[rank - 1] : i % 2 === 0 ? "bg-bg" : "bg-[var(--row-alt-bg)]"
                      }`}
                    >
                      <td className="px-3 py-2 text-center">
                        <RankBadge rank={rank} />
                      </td>
                      <td className={`px-3 py-2 ${highlighted ? "font-semibold text-text" : "text-text-dim"}`}>{s.name}</td>
                      <td className="px-3 py-2 text-center font-medium text-text">{s.totalCase}</td>
                      <td className="px-3 py-2 text-center text-text-dim">{s.over1000}</td>
                      <td className="px-3 py-2 text-center text-text-dim">{s.under1000}</td>
                      <td className="px-3 py-2 text-center text-text-dim">{s.collected}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex-1 rounded-xl border border-border-strong bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-text">Báo cáo Processor</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-table-head-bg text-[10px] font-semibold uppercase tracking-wide text-table-head-text">
                  <th className="w-12 px-3 py-2 text-center"></th>
                  <th className="px-3 py-2 text-left">Processor</th>
                  <th className="px-3 py-2 text-center">Total Case</th>
                </tr>
              </thead>
              <tbody>
                {processorStats.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-xs text-text-faint">
                      Chưa có Processor nào trong hệ thống.
                    </td>
                  </tr>
                )}
                {processorStats.map((s, i) => {
                  const rank = i + 1;
                  const highlighted = rank <= 3;
                  return (
                    <tr
                      key={s.userId}
                      className={`border-b border-border last:border-0 ${
                        highlighted ? RANK_ROW_BG[rank - 1] : i % 2 === 0 ? "bg-bg" : "bg-[var(--row-alt-bg)]"
                      }`}
                    >
                      <td className="px-3 py-2 text-center">
                        <RankBadge rank={rank} />
                      </td>
                      <td className={`px-3 py-2 ${highlighted ? "font-semibold text-text" : "text-text-dim"}`}>{s.name}</td>
                      <td className="px-3 py-2 text-center font-medium text-text">{s.totalCase}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
