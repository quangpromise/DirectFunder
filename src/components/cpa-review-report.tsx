"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trophy, ChevronDown, Check } from "lucide-react";
import { CPA_REVIEW_VISIBLE_YEARS, yearAmountKey, yearStatusKey } from "@/lib/cpa-review-columns";
import type { CpaReviewRecord, User } from "@/lib/types";

/**
 * Tab "Báo cáo" trong CPA Review (thêm 2026-08-16) — 2 bảng xếp hạng Agent/Processor tính
 * theo THÁNG đang chọn (dùng chung `rows` đã lọc theo tháng từ trang cha) và CHỈ 3 năm đang
 * hiện trên bảng chính (CPA_REVIEW_VISIBLE_YEARS, không tính năm 2022 đang ẩn) — theo xác
 * nhận của user. "Total Case" đếm số LƯỢT năm có "Số tiền" > 0 (không phải Tổng, không tính
 * Other Refund) cộng dồn qua MỌI hồ sơ được gán cho người đó — ví dụ 1 hồ sơ có tiền ở 3 năm
 * thì tính 3, không phải 1.
 *
 * Bổ sung 2026-08-16 — 2 dropdown chọn Agent/Processor: MẶC ĐỊNH hiện đủ mọi người (khớp
 * hành vi cũ, không cần thao tác gì), bấm mở dropdown mới bắt đầu tự chọn lọc theo đúng
 * người đã tick — tự động vẫn hiện người MỚI thêm sau này miễn chưa từng đụng vào dropdown
 * (selection = null nghĩa là "chưa can thiệp, hiện tất cả"), khớp yêu cầu "tài khoản nào được
 * chọn mới show trong báo cáo" mà không cần chọn tay lại mỗi khi có nhân viên mới.
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

/** Dropdown multi-select dùng chung cho cả 2 bộ lọc Agent/Processor — `selected === null`
 * nghĩa là "chưa lọc, hiện tất cả" (mặc định), khác `selected` là 1 Set rỗng (đã lọc còn 0
 * người, cố ý ẩn hết). */
function MultiSelectFilter({
  label,
  users,
  selected,
  onChange,
}: {
  label: string;
  users: User[];
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  function openPopup() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ x: Math.min(rect.left, window.innerWidth - 260), y: rect.bottom + 4 });
    setOpen((o) => !o);
  }

  function toggle(id: string) {
    const base = selected ?? new Set(users.map((u) => u.id));
    const next = new Set(base);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  const isAll = selected === null;
  const count = selected ? selected.size : users.length;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={openPopup}
        className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition ${
          isAll
            ? "border-border bg-surface text-text-dim hover:bg-surface-hover hover:text-text"
            : "border-accent bg-accent-soft text-accent"
        }`}
      >
        {label}
        <span className="text-xs text-text-faint">
          ({count}/{users.length})
        </span>
        <ChevronDown size={13} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div className="popover fixed z-[100] w-60 rounded-xl p-2 shadow-2xl shadow-black/60" style={{ left: pos.x, top: pos.y }}>
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold text-text-faint">Chọn {label.toLowerCase()} hiện trong báo cáo</span>
                {!isAll && (
                  <button onClick={() => onChange(null)} className="text-[11px] font-medium text-accent hover:underline">
                    Chọn tất cả
                  </button>
                )}
              </div>
              <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                {users.length === 0 && <p className="px-2 py-2 text-xs text-text-faint">Chưa có ai.</p>}
                {users.map((u) => {
                  const checked = isAll || selected!.has(u.id);
                  return (
                    <label key={u.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(u.id)}
                        className="h-3.5 w-3.5 accent-[var(--accent)]"
                      />
                      <span className="min-w-0 flex-1 truncate">{u.name}</span>
                      {checked && <Check size={12} className="shrink-0 text-accent" />}
                    </label>
                  );
                })}
              </div>
            </div>
          </>,
          document.body
        )}
    </>
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
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string> | null>(null);
  const [selectedProcessorIds, setSelectedProcessorIds] = useState<Set<string> | null>(null);

  const visibleAgentUsers = selectedAgentIds ? agentUsers.filter((u) => selectedAgentIds.has(u.id)) : agentUsers;
  const visibleProcessorUsers = selectedProcessorIds ? processorUsers.filter((u) => selectedProcessorIds.has(u.id)) : processorUsers;

  const agentStats = computeAgentStats(rows, visibleAgentUsers);
  const processorStats = computeProcessorStats(rows, visibleProcessorUsers);

  // Hàng "Tổng" cộng dồn các cột số — CHỈ tính trên những người ĐANG hiện (tôn trọng bộ lọc
  // Agent/Processor phía trên), thêm 2026-08-16.
  const agentTotals = agentStats.reduce(
    (acc, s) => ({
      totalCase: acc.totalCase + s.totalCase,
      over1000: acc.over1000 + s.over1000,
      under1000: acc.under1000 + s.under1000,
      collected: acc.collected + s.collected,
    }),
    { totalCase: 0, over1000: 0, under1000: 0, collected: 0 }
  );
  const processorTotalCase = processorStats.reduce((sum, s) => sum + s.totalCase, 0);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectFilter label="Agent" users={agentUsers} selected={selectedAgentIds} onChange={setSelectedAgentIds} />
        <MultiSelectFilter label="Processor" users={processorUsers} selected={selectedProcessorIds} onChange={setSelectedProcessorIds} />
      </div>

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
                {/* Hàng "Tổng" — cộng dồn Total Case/>1000/<1000/Collected của MỌI Agent đang
                    hiện (theo bộ lọc phía trên), thêm 2026-08-16. */}
                {agentStats.length > 0 && (
                  <tr className="border-b-2 border-accent/40 bg-accent-soft">
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-sm font-bold text-text">Tổng</td>
                    <td className="px-3 py-2 text-center text-sm font-bold text-text">{agentTotals.totalCase}</td>
                    <td className="px-3 py-2 text-center text-sm font-bold text-text">{agentTotals.over1000}</td>
                    <td className="px-3 py-2 text-center text-sm font-bold text-text">{agentTotals.under1000}</td>
                    <td className="px-3 py-2 text-center text-sm font-bold text-text">{agentTotals.collected}</td>
                  </tr>
                )}
                {agentStats.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-xs text-text-faint">
                      {agentUsers.length === 0 ? "Chưa có Agent nào trong hệ thống." : "Không có Agent nào đang được chọn."}
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
                {processorStats.length > 0 && (
                  <tr className="border-b-2 border-accent/40 bg-accent-soft">
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-sm font-bold text-text">Tổng</td>
                    <td className="px-3 py-2 text-center text-sm font-bold text-text">{processorTotalCase}</td>
                  </tr>
                )}
                {processorStats.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-xs text-text-faint">
                      {processorUsers.length === 0 ? "Chưa có Processor nào trong hệ thống." : "Không có Processor nào đang được chọn."}
                    </td>
                  </tr>
                )}
                {/* KHÁC bảng Agent — chỉ xếp hạng theo SỐ THỨ TỰ thường (1, 2, 3...), KHÔNG
                    icon huy chương/highlight top 3, theo yêu cầu 2026-08-16. */}
                {processorStats.map((s, i) => {
                  const rank = i + 1;
                  return (
                    <tr key={s.userId} className={`border-b border-border last:border-0 ${i % 2 === 0 ? "bg-bg" : "bg-[var(--row-alt-bg)]"}`}>
                      <td className="px-3 py-2 text-center text-xs text-text-faint">{rank}</td>
                      <td className="px-3 py-2 text-text-dim">{s.name}</td>
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
