"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import {
  X,
  ClipboardList,
  FileText,
  Plus,
  Trash2,
  Pencil,
  FileSpreadsheet,
  RefreshCw,
  Unlink,
  HelpCircle,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { hasFeature } from "@/lib/rbac";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api-client";
import { CpaReviewMonthPicker } from "@/components/cpa-review-month-picker";
import { monthKeyLabel } from "@/lib/cpa-review-month";
import { useConfirm } from "@/components/confirm-dialog";
import { todayIsoDate } from "@/lib/date-format";
import type { ProcessorReportTaskDef } from "@/lib/types";

/** `NoticeSplitterPanel` kéo theo `pdf-lib` (nặng, xem comment trong split-pdf.ts) — trước
 * đây import tĩnh khiến `pdf-lib` bị cộng dồn vào bundle của TRANG HỒ SƠ (nơi popup "For
 * Processor" được render), dù tab "Notice Splitter" không phải ai cũng bấm tới. `next/dynamic`
 * (`ssr: false` vì panel chỉ chạy trong trình duyệt — xử lý PDF client-side, không có gì để
 * render phía server) tách hẳn thành 1 chunk riêng, chỉ tải khi tab này thực sự được chọn. */
const NoticeSplitterPanel = dynamic(
  () => import("@/components/notice-splitter-panel").then((m) => m.NoticeSplitterPanel),
  { ssr: false }
);

/** Danh sách ngày "YYYY-MM-DD" của 1 tháng, kèm chỉ số tuần (W1, W2...) tính theo tuần lịch
 * Chủ nhật-Thứ 7 (khớp cách bố cục W1/W2 trong bảng Excel gốc user cung cấp). */
function buildMonthDays(month: string): { date: string; day: number; weekIndex: number }[] {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = new Date(y, m - 1, 1).getDay(); // 0 = Chủ nhật
  const days: { date: string; day: number; weekIndex: number }[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const weekIndex = Math.floor((day - 1 + firstWeekday) / 7) + 1;
    days.push({ date: `${month}-${String(day).padStart(2, "0")}`, day, weekIndex });
  }
  return days;
}

function groupTasksBySection(tasks: ProcessorReportTaskDef[]) {
  const sorted = [...tasks].sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order);
  const sections = new Map<string, { sectionId: string; sectionLabel: string; tasks: ProcessorReportTaskDef[] }>();
  for (const task of sorted) {
    const entry = sections.get(task.sectionId) ?? { sectionId: task.sectionId, sectionLabel: task.sectionLabel, tasks: [] };
    entry.tasks.push(task);
    sections.set(task.sectionId, entry);
  }
  return Array.from(sections.values());
}

// Thu nhỏ 1 chút so với bản đầu (220/52/60/64) — kết hợp với popup rộng hơn (max-w-6xl ->
// max-w-[96vw]) để nhìn được nhiều ngày hơn trong 1 tháng mà không phải cuộn ngang liên tục
// (thêm 2026-08-31, theo yêu cầu "điều chỉnh kích cỡ text... nhỏ lại 1 chút và mở rộng pop-up").
const TASK_COL_WIDTH = 190;
const DAY_COL_WIDTH = 40;
const WEEK_COL_WIDTH = 48;
const ROW_TOTAL_COL_WIDTH = 52;

export function ForProcessorButton() {
  const user = useCurrentUser();
  const permissions = useAppStore((s) => s.featurePermissions);
  const [open, setOpen] = useState(false);
  const t = useT();

  // Nút mở popup này giờ gate bằng CẢ 2 quyền (không chỉ viewForProcessor) vì tab "Notice
  // Splitter" (2026-08-18) có nhóm role mặc định khác (Kế toán không có viewForProcessor
  // nhưng có useIrsNoticeSplitter) — thiếu điều kiện OR ở đây sẽ khiến Kế toán không bao
  // giờ mở được popup dù có quyền dùng tab Notice Splitter bên trong.
  if (
    !user ||
    (!hasFeature(permissions, "viewForProcessor", user.role) && !hasFeature(permissions, "useIrsNoticeSplitter", user.role))
  )
    return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <ClipboardList size={14} />
        {t("forProcessor.button")}
      </button>
      {open && <ForProcessorDialog onClose={() => setOpen(false)} />}
    </>
  );
}

type ForProcessorTab = "report" | "document" | "noticeSplitter";

function ForProcessorDialog({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser();
  const permissions = useAppStore((s) => s.featurePermissions);
  const t = useT();

  const canViewReport = user ? hasFeature(permissions, "viewForProcessor", user.role) : false;
  const canViewNoticeSplitter = user ? hasFeature(permissions, "useIrsNoticeSplitter", user.role) : false;
  // Report/Document mặc định nếu có quyền (giữ hành vi cũ) — nếu không (vd Kế toán chỉ có
  // useIrsNoticeSplitter), mở thẳng tab Notice Splitter thay vì 1 tab họ không thấy được.
  const [tab, setTab] = useState<ForProcessorTab>(canViewReport ? "report" : "noticeSplitter");

  if (!user || typeof document === "undefined") return null;
  const isLeaderView = user.role === "processor_leader" || user.role === "manager";

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-6">
      <div className="popover flex h-full w-full max-w-[96vw] flex-col rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <ClipboardList size={15} className="text-accent" />
              {t("forProcessor.title")}
            </h3>
            <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
              {canViewReport && (
                <>
                  <button
                    onClick={() => setTab("report")}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                      tab === "report" ? "gradient-btn text-white" : "text-text-faint hover:text-text-dim"
                    }`}
                  >
                    {t("forProcessor.tabReport")}
                  </button>
                  <button
                    onClick={() => setTab("document")}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                      tab === "document" ? "gradient-btn text-white" : "text-text-faint hover:text-text-dim"
                    }`}
                  >
                    {t("forProcessor.tabDocument")}
                  </button>
                </>
              )}
              {canViewNoticeSplitter && (
                <button
                  onClick={() => setTab("noticeSplitter")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    tab === "noticeSplitter" ? "gradient-btn text-white" : "text-text-faint hover:text-text-dim"
                  }`}
                >
                  {t("forProcessor.tabNoticeSplitter")}
                </button>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "report" && canViewReport && (isLeaderView ? <ProcessorLeaderReportGrid /> : <ProcessorSelfReportGrid userId={user.id} />)}
          {tab === "document" && canViewReport && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <FileText size={28} className="text-text-faint" />
              <p className="text-sm text-text-dim">{t("forProcessor.documentComingSoon")}</p>
            </div>
          )}
          {tab === "noticeSplitter" && canViewNoticeSplitter && <NoticeSplitterPanel />}
        </div>
      </div>
    </div>,
    document.body
  );
}

function SectionRows({
  sections,
  renderCell,
  computeSectionTotal,
  columns,
  renderRowTotal,
  computeSectionRowTotal,
  highlightColIndex,
}: {
  sections: ReturnType<typeof groupTasksBySection>;
  renderCell: (taskId: string, colIndex: number) => React.ReactNode;
  computeSectionTotal: (taskIds: string[], colIndex: number) => number;
  columns: { key: string; width: number; sticky?: boolean }[];
  /** Cột "Tổng" riêng, đặt NGAY SAU cột Task/tên section (trước các cột ngày/tuần) — khác
   * cột TOTAL cuối bảng (nếu có, xem ProcessorLeaderReportGrid) vốn tổng theo processor.
   * Optional: chỉ render khi có truyền vào (ProcessorSelfReportGrid dùng, tổng theo NGÀY
   * trong tháng cho từng task; ProcessorLeaderReportGrid không dùng vì đã có cột TOTAL riêng
   * ở cuối theo đúng ý nghĩa khác). */
  renderRowTotal?: (taskId: string) => React.ReactNode;
  computeSectionRowTotal?: (taskIds: string[]) => number;
  /** Index cột khớp NGÀY HÔM NAY (chỉ có ý nghĩa ở ProcessorSelfReportGrid, cột theo ngày trong
   * tháng — thêm 2026-08-30 theo yêu cầu "hệ thống đang chạy ngày tháng nào sẽ highlight cột của
   * ngày tháng đó") — tô nền nhẹ khác màu cho MỌI cell (kể cả dòng tổng theo section) thuộc cột
   * này, giúp Processor dễ nhận ra đang nhập liệu đúng ngày. `undefined`/không khớp cột nào
   * (đang xem tháng khác tháng hiện tại) = không tô gì. */
  highlightColIndex?: number;
}) {
  const t = useT();
  return (
    <>
      {sections.map((section, sIdx) => (
        <div key={section.sectionId} className="contents">
          <div
            className="sticky z-10 flex items-center gap-1 border-b border-r border-border-strong bg-surface px-2 py-1 text-[11px] font-semibold text-text"
            style={{ left: 0 }}
          >
            {sIdx + 1} {section.sectionLabel}
          </div>
          {renderRowTotal && computeSectionRowTotal && (
            <div className="flex items-center justify-center border-b border-r border-border-strong bg-accent-soft text-[11px] font-semibold text-red-400 light:text-red-600">
              {computeSectionRowTotal(section.tasks.map((tk) => tk.id)) || ""}
            </div>
          )}
          {columns.map((col, colIndex) => (
            <div
              key={col.key}
              className={`flex items-center justify-center border-b border-r border-border text-[11px] font-semibold text-red-400 light:text-red-600 ${
                colIndex === highlightColIndex ? "bg-accent-soft" : "bg-surface"
              }`}
            >
              {computeSectionTotal(
                section.tasks.map((tk) => tk.id),
                colIndex
              ) || ""}
            </div>
          ))}

          {section.tasks.map((task) => (
            <div key={task.id} className="contents">
              <div
                className="sticky z-10 flex items-center border-b border-r border-border bg-bg px-2 py-1 pl-5 text-[11px] italic text-text-dim"
                style={{ left: 0 }}
              >
                <span className="truncate">{task.label}</span>
              </div>
              {renderRowTotal && (
                <div className="flex h-full items-center justify-center border-b border-r border-border bg-accent-soft text-[11px] font-medium text-text">
                  {renderRowTotal(task.id)}
                </div>
              )}
              {columns.map((col, colIndex) => (
                <div
                  key={col.key}
                  className={`border-b border-r border-border ${colIndex === highlightColIndex ? "bg-accent-soft/40" : ""}`}
                >
                  {renderCell(task.id, colIndex)}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {sections.length === 0 && (
        <div className="col-span-full flex items-center justify-center px-4 py-10 text-sm text-text-faint" style={{ gridColumn: "1 / -1" }}>
          {t("processorReport.noTasks")}
        </div>
      )}
    </>
  );
}

function TaskManageDialog() {
  const tasks = useAppStore((s) => s.processorReportTasks);
  const addTask = useAppStore((s) => s.addProcessorReportTask);
  const renameTask = useAppStore((s) => s.renameProcessorReportTask);
  const deleteTask = useAppStore((s) => s.deleteProcessorReportTask);
  const [open, setOpen] = useState(false);
  const [newSectionLabel, setNewSectionLabel] = useState("");
  const [newTaskLabel, setNewTaskLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const { confirm, ConfirmDialogUI } = useConfirm();
  const t = useT();

  const sections = useMemo(() => groupTasksBySection(tasks), [tasks]);
  const [sectionId, setSectionId] = useState<string>("");

  function handleAdd() {
    if (!newTaskLabel.trim()) return;
    const existing = sections.find((s) => s.sectionId === sectionId);
    const sectionLabel = existing?.sectionLabel ?? newSectionLabel.trim();
    if (!sectionLabel) return;
    const id = existing ? existing.sectionId : sectionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    addTask(id, sectionLabel, newTaskLabel.trim());
    setNewTaskLabel("");
  }

  return (
    <>
      {ConfirmDialogUI}
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <Pencil size={12} />
        {t("processorReport.manageTasksBtn")}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-lg flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("processorReport.manageTasksTitle")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>
              <div className="mt-3 flex max-h-[50vh] flex-col gap-2 overflow-y-auto px-5">
                {sections.map((section) => (
                  <div key={section.sectionId} className="rounded-lg border border-border p-2">
                    <p className="mb-1 text-xs font-semibold text-text">{section.sectionLabel}</p>
                    {section.tasks.map((task) => (
                      <div key={task.id} className="flex items-center gap-1.5 py-0.5">
                        {editingId === task.id ? (
                          <input
                            autoFocus
                            value={editingLabel}
                            onChange={(e) => setEditingLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                renameTask(task.id, editingLabel.trim() || task.label);
                                setEditingId(null);
                              }
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            onBlur={() => {
                              renameTask(task.id, editingLabel.trim() || task.label);
                              setEditingId(null);
                            }}
                            className="flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs outline-none focus:border-accent"
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-xs text-text-dim">{task.label}</span>
                        )}
                        <button
                          onClick={() => {
                            setEditingId(task.id);
                            setEditingLabel(task.label);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={async () => {
                            if (await confirm(t("processorReport.deleteTaskConfirm"), { tone: "danger" })) deleteTask(task.id);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint hover:bg-red-500/15 hover:text-red-400"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-col gap-2 border-t border-border px-5 py-4">
                <p className="text-xs font-medium text-text">{t("processorReport.addTaskTitle")}</p>
                <select
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  className="rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs outline-none focus:border-accent"
                >
                  <option value="">{t("processorReport.newSectionOption")}</option>
                  {sections.map((s) => (
                    <option key={s.sectionId} value={s.sectionId}>
                      {s.sectionLabel}
                    </option>
                  ))}
                </select>
                {!sectionId && (
                  <input
                    value={newSectionLabel}
                    onChange={(e) => setNewSectionLabel(e.target.value)}
                    placeholder={t("processorReport.newSectionLabel")}
                    className="rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs outline-none focus:border-accent"
                  />
                )}
                <div className="flex gap-2">
                  <input
                    value={newTaskLabel}
                    onChange={(e) => setNewTaskLabel(e.target.value)}
                    placeholder={t("processorReport.newTaskLabel")}
                    className="flex-1 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs outline-none focus:border-accent"
                  />
                  <button
                    onClick={handleAdd}
                    className="gradient-btn flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-medium text-white"
                  >
                    <Plus size={12} />
                    {t("common.add")}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function ProcessorSelfReportGrid({ userId }: { userId: string }) {
  const month = useAppStore((s) => s.processorReportSelectedMonth);
  const setMonth = useAppStore((s) => s.setProcessorReportSelectedMonth);
  const tasks = useAppStore((s) => s.processorReportTasks);
  const entries = useAppStore((s) => s.processorReportEntries);
  const fetchEntries = useAppStore((s) => s.fetchProcessorReportEntries);
  const upsertEntry = useAppStore((s) => s.upsertProcessorReportEntry);
  const permissions = useAppStore((s) => s.featurePermissions);
  const role = useCurrentUser()?.role;
  const t = useT();

  useEffect(() => {
    fetchEntries(month);
  }, [month, fetchEntries]);

  const days = useMemo(() => buildMonthDays(month), [month]);
  const sections = useMemo(() => groupTasksBySection(tasks), [tasks]);
  const weekIndexes = useMemo(() => Array.from(new Set(days.map((d) => d.weekIndex))), [days]);

  const columns = useMemo(() => {
    const cols: { key: string; width: number; kind: "day" | "week"; date?: string; weekIndex?: number }[] = [];
    for (const w of weekIndexes) {
      for (const d of days.filter((x) => x.weekIndex === w)) {
        cols.push({ key: d.date, width: DAY_COL_WIDTH, kind: "day", date: d.date });
      }
      cols.push({ key: `w${w}`, width: WEEK_COL_WIDTH, kind: "week", weekIndex: w });
    }
    return cols;
  }, [days, weekIndexes]);
  // Highlight cột NGÀY HÔM NAY (giờ Phoenix, khớp quy ước "hôm nay" dùng chung toàn app — xem
  // todayIsoDate) — chỉ khớp khi đang xem ĐÚNG tháng hiện tại, tháng khác không cột nào khớp
  // (findIndex trả -1, coi như không highlight gì, đúng ý nghĩa "hôm nay" không tồn tại ở đó).
  const today = useMemo(() => todayIsoDate(), []);
  const todayColIndex = useMemo(() => {
    const idx = columns.findIndex((c) => c.kind === "day" && c.date === today);
    return idx >= 0 ? idx : undefined;
  }, [columns, today]);

  const valueByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.userId !== userId) continue;
      map.set(`${e.taskId}:${e.date}`, e.value);
    }
    return map;
  }, [entries, userId]);

  function dayValue(taskId: string, date: string): number {
    return valueByKey.get(`${taskId}:${date}`) ?? 0;
  }
  function weekValue(taskId: string, weekIndex: number): number {
    return days.filter((d) => d.weekIndex === weekIndex).reduce((sum, d) => sum + dayValue(taskId, d.date), 0);
  }
  // Tổng cả tháng cho 1 task — cộng dồn dayValue mọi ngày trong tháng đang xem, hiện ở cột
  // "Tổng" ngay sau cột Task (yêu cầu 2026-08-20).
  function monthTotal(taskId: string): number {
    return days.reduce((sum, d) => sum + dayValue(taskId, d.date), 0);
  }

  const gridTemplateColumns = [`${TASK_COL_WIDTH}px`, `${ROW_TOTAL_COL_WIDTH}px`, ...columns.map((c) => `${c.width}px`)].join(
    " "
  );
  const canManageTasks = role ? hasFeature(permissions, "manageProcessorReportTasks", role) : false;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <CpaReviewMonthPicker value={month} onChange={setMonth} />
        {canManageTasks && <TaskManageDialog />}
      </div>
      <div className="flex-1 overflow-auto">
        <div className="grid text-sm" style={{ gridTemplateColumns }}>
          <div className="sticky left-0 top-0 z-30 table-head-cell px-2 py-1.5 text-[10px] font-semibold uppercase text-table-head-text">
            {t("processorReport.tasksHeader")}
          </div>
          <div className="sticky top-0 z-20 flex items-center justify-center border-b border-r border-border-strong bg-accent-soft px-1 py-1.5 text-[10px] font-semibold text-table-head-text">
            {t("processorReport.totalHeader")}
          </div>
          {columns.map((col, colIndex) => (
            <div
              key={col.key}
              className={`sticky top-0 z-20 flex items-center justify-center border-b border-r border-border-strong px-1 py-1.5 text-[10px] font-semibold text-table-head-text ${
                colIndex === todayColIndex
                  ? "bg-accent text-white"
                  : col.kind === "week"
                    ? "bg-accent-soft"
                    : "bg-table-head-bg"
              }`}
            >
              {col.kind === "day" ? col.date!.slice(8, 10) : `W${col.weekIndex}`}
            </div>
          ))}

          <SectionRows
            sections={sections}
            columns={columns}
            highlightColIndex={todayColIndex}
            computeSectionRowTotal={(taskIds) => taskIds.reduce((sum, id) => sum + monthTotal(id), 0)}
            renderRowTotal={(taskId) => monthTotal(taskId) || ""}
            computeSectionTotal={(taskIds, colIndex) => {
              const col = columns[colIndex];
              if (col.kind === "day") return taskIds.reduce((sum, id) => sum + dayValue(id, col.date!), 0);
              return taskIds.reduce((sum, id) => sum + weekValue(id, col.weekIndex!), 0);
            }}
            renderCell={(taskId, colIndex) => {
              const col = columns[colIndex];
              if (col.kind === "week") {
                return (
                  <div className="flex h-full items-center justify-center bg-surface text-[11px] font-medium text-text-dim">
                    {weekValue(taskId, col.weekIndex!) || ""}
                  </div>
                );
              }
              const value = dayValue(taskId, col.date!);
              return (
                <input
                  type="number"
                  min={0}
                  defaultValue={value || ""}
                  key={`${taskId}:${col.date}:${value}`}
                  onBlur={(e) => {
                    const next = Number(e.target.value) || 0;
                    if (next !== value) upsertEntry(taskId, col.date!, next);
                  }}
                  className="no-spinner h-full w-full bg-transparent px-1 text-center text-[11px] outline-none focus:bg-accent-soft"
                />
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Popup "Hướng dẫn" cấu hình đồng bộ 2 chiều Sheet cho bảng tổng hợp Processor Leader —
 * cùng cấu trúc từng bước với CpaReviewSyncGuideDialog (src/components/cpa-review-sync-guide-dialog.tsx)
 * nhưng bớt 2 bước không áp dụng ở đây (không có bước "nhập dữ liệu có sẵn"/"ánh xạ tên" vì
 * connect luôn GHI layout mới, không đọc dữ liệu có sẵn trên Sheet). */
function ProcessorReportSyncGuideDialog({ month }: { month: string }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<{
    serviceAccountConfigured: boolean;
    serviceAccountEmail: string | null;
    appsScript: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const t = useT();

  useEffect(() => {
    if (!open || info) return;
    api
      .getProcessorReportSyncInfo(month)
      .then(setInfo, () => setInfo({ serviceAccountConfigured: false, serviceAccountEmail: null, appsScript: null }));
  }, [open, info, month]);

  function copyEmail() {
    if (!info?.serviceAccountEmail) return;
    navigator.clipboard.writeText(info.serviceAccountEmail).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function copyScript() {
    if (!info?.appsScript) return;
    navigator.clipboard.writeText(info.appsScript).then(() => {
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 1500);
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2 text-[11px] text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <HelpCircle size={12} />
        {t("processorReportGuide.button")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-xl flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("processorReportGuide.title")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5 pb-5 text-sm text-text-dim">
                {info && !info.serviceAccountConfigured && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{t("processorReportGuide.missingServiceAccount")}</span>
                  </div>
                )}

                <GuideStep n={1} title={t("processorReportGuide.step1.title")}>
                  <p>{t("processorReportGuide.step1.text", { month: monthKeyLabel(month) })}</p>
                  <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5">
                    <code className="min-w-0 flex-1 truncate text-xs text-text">
                      {info?.serviceAccountEmail ?? t("processorReportGuide.loading")}
                    </code>
                    <button
                      onClick={copyEmail}
                      disabled={!info?.serviceAccountEmail}
                      className="shrink-0 text-text-faint transition hover:text-text disabled:opacity-40"
                      title={t("processorReportGuide.copy")}
                      aria-label={t("processorReportGuide.copyEmailAria")}
                    >
                      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    </button>
                  </div>
                </GuideStep>

                <GuideStep n={2} title={t("processorReportGuide.step2.title")}>
                  <p>{t("processorReportGuide.step2.text", { btn: t("processorReportSheet.connectBtn") })}</p>
                </GuideStep>

                <GuideStep n={3} title={t("processorReportGuide.step3.title")}>
                  <p>{t("processorReportGuide.step3.text")}</p>
                  {info?.appsScript && (
                    <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5">
                      <span className="text-[11px] text-text-faint">{t("processorReportGuide.step3.alreadyConnected")}</span>
                      <button
                        onClick={copyScript}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-dim transition hover:bg-surface-hover hover:text-text"
                      >
                        {scriptCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        {scriptCopied ? t("processorReportGuide.copied") : t("processorReportGuide.copyScript")}
                      </button>
                    </div>
                  )}
                </GuideStep>

                <GuideStep n={4} title={t("processorReportGuide.step4.title")}>
                  <p>{t("processorReportGuide.step4.text")}</p>
                </GuideStep>

                <GuideStep n={5} title={t("processorReportGuide.step5.title")}>
                  <p>{t("processorReportGuide.step5.text")}</p>
                </GuideStep>

                <p className="mt-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-faint">
                  {t("processorReportGuide.footnote")}
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function GuideStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text">{title}</p>
        <div className="mt-0.5 text-xs leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

/** Sheet link không được lưu nguyên văn (chỉ lưu sheetId/gid tách sẵn từ lúc kết nối) —
 * dựng lại đúng dạng URL chuẩn từ 2 giá trị đó để hiển thị link đã kết nối trong dialog. */
function buildSheetLink(sheetId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${gid}`;
}

/** Nút "Kết nối Sheet"/"Đã kết nối Sheet" thu gọn cạnh "Hướng dẫn" — bấm vào mới mở dialog
 * xem thông tin/đổi link, cùng UX với CpaReviewSheetConfigDialog (thay vì hiện sẵn 1 khối
 * luôn mở trên màn hình như trước, theo yêu cầu "thu gọn lại như nút Sheet Connected ở CPA
 * Review"). */
function ProcessorReportSheetConfigDialog({ month }: { month: string }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [changingLink, setChangingLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{
    connected: { sheetId: string; gid: string; tabName: string; connectedAt: string } | null;
    appsScript: string | null;
  } | null>(null);
  const connect = useAppStore((s) => s.connectProcessorReportSheet);
  const resync = useAppStore((s) => s.resyncProcessorReportSheet);
  const disconnect = useAppStore((s) => s.disconnectProcessorReportSheet);
  const t = useT();

  async function loadInfo() {
    const result = await api.getProcessorReportSyncInfo(month);
    setInfo({ connected: result.connected, appsScript: result.appsScript });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function handleConnect() {
    if (!link.trim()) return;
    setBusy(true);
    setError(null);
    const result = await connect(link.trim(), month);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLink("");
    setChangingLink(false);
    await loadInfo();
  }

  async function handleResync() {
    setBusy(true);
    setError(null);
    const result = await resync(month);
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  async function handleDisconnect() {
    setBusy(true);
    await disconnect(month);
    setBusy(false);
    await loadInfo();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2 text-[11px] text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <FileSpreadsheet size={12} />
        {info?.connected ? t("processorReportSheet.connectedBtn") : t("processorReportSheet.connectBtn")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-lg flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">
                  {t("processorReportSheet.dialogTitlePrefix")} <span className="text-accent">{monthKeyLabel(month)}</span>
                </h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5 pb-5">
                {!info?.connected ? (
                  <>
                    <p className="text-xs text-text-faint">
                      {t("processorReportSheet.pasteLinkText", { month: monthKeyLabel(month) })}
                    </p>
                    <input
                      value={link}
                      onChange={(e) => setLink(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/...#gid=..."
                      className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                    />
                    <button
                      onClick={handleConnect}
                      disabled={busy || !link.trim()}
                      className="gradient-btn flex h-9 items-center justify-center rounded-lg text-sm font-medium text-white disabled:cursor-default disabled:opacity-60"
                    >
                      {busy ? t("processorReportSheet.connecting") : t("processorReportSheet.connectAction")}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-dim">
                      <p>
                        {t("processorReportSheet.connectedTabPrefix")}{" "}
                        <span className="font-medium text-text">{info.connected.tabName}</span>
                      </p>
                      <a
                        href={buildSheetLink(info.connected.sheetId, info.connected.gid)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block truncate text-accent underline-offset-2 hover:underline"
                      >
                        {buildSheetLink(info.connected.sheetId, info.connected.gid)}
                      </a>
                      <p className="mt-0.5 text-text-faint">
                        {t("processorReportSheet.connectedAtPrefix")} {new Date(info.connected.connectedAt).toLocaleString("vi-VN")}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleResync}
                        disabled={busy}
                        className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface text-sm text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
                      >
                        <RefreshCw size={14} />
                        {t("processorReportSheet.resyncBtn")}
                      </button>
                      <button
                        onClick={() => setChangingLink((v) => !v)}
                        disabled={busy}
                        className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
                      >
                        <FileSpreadsheet size={14} />
                        {t("processorReportSheet.changeLinkBtn")}
                      </button>
                      <button
                        onClick={handleDisconnect}
                        disabled={busy}
                        className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-red-400 transition hover:bg-red-500/10 disabled:cursor-default disabled:opacity-60"
                      >
                        <Unlink size={14} />
                        {t("processorReportSheet.disconnectBtn")}
                      </button>
                    </div>

                    {changingLink && (
                      <div className="rounded-lg border border-border bg-bg-elevated p-3">
                        <p className="mb-2 text-xs text-text-faint">
                          {t("processorReportSheet.changeLinkText", { month: monthKeyLabel(month) })}
                        </p>
                        <input
                          value={link}
                          onChange={(e) => setLink(e.target.value)}
                          placeholder="https://docs.google.com/spreadsheets/d/...#gid=..."
                          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                        />
                        <button
                          onClick={handleConnect}
                          disabled={busy || !link.trim()}
                          className="gradient-btn mt-2 flex h-9 w-full items-center justify-center rounded-lg text-sm font-medium text-white disabled:cursor-default disabled:opacity-60"
                        >
                          {busy ? t("processorReportSheet.connecting") : t("processorReportSheet.reconnectAction")}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {info?.appsScript && (
                  <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-text-dim">
                    <p className="font-medium text-text">{t("processorReportSheet.scriptLabel")}</p>
                    <textarea
                      readOnly
                      value={info.appsScript}
                      rows={8}
                      onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                      className="mt-2 w-full resize-none rounded-md border border-border bg-bg-elevated p-2 font-mono text-[10px] leading-snug text-text outline-none"
                    />
                  </div>
                )}

                {error && <p className="text-xs text-red-400">{error}</p>}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function ProcessorLeaderReportGrid() {
  const month = useAppStore((s) => s.processorReportSelectedMonth);
  const setMonth = useAppStore((s) => s.setProcessorReportSelectedMonth);
  const tasks = useAppStore((s) => s.processorReportTasks);
  const summary = useAppStore((s) => s.processorReportSummary);
  const fetchSummary = useAppStore((s) => s.fetchProcessorReportSummary);
  const permissions = useAppStore((s) => s.featurePermissions);
  const role = useCurrentUser()?.role;
  const t = useT();

  useEffect(() => {
    fetchSummary(month);
  }, [month, fetchSummary]);

  const sections = useMemo(() => groupTasksBySection(tasks), [tasks]);
  const processors = summary.processors;
  const columns = useMemo(
    () => [...processors.map((p) => ({ key: p.id, width: 96 })), { key: "__total__", width: 96 }],
    [processors]
  );

  const valueByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of summary.entries) map.set(`${e.taskId}:${e.userId}`, e.value);
    return map;
  }, [summary.entries]);

  function cellValue(taskId: string, processorId: string): number {
    return valueByKey.get(`${taskId}:${processorId}`) ?? 0;
  }
  function totalValue(taskId: string): number {
    return processors.reduce((sum, p) => sum + cellValue(taskId, p.id), 0);
  }

  const gridTemplateColumns = [`${TASK_COL_WIDTH}px`, ...columns.map((c) => `${c.width}px`)].join(" ");
  const canManageTasks = role ? hasFeature(permissions, "manageProcessorReportTasks", role) : false;
  const canManageSheet = role ? hasFeature(permissions, "manageProcessorReportSheet", role) : false;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <CpaReviewMonthPicker value={month} onChange={setMonth} />
        <div className="flex items-center gap-1.5">
          {canManageTasks && <TaskManageDialog />}
          {canManageSheet && (
            <>
              <ProcessorReportSyncGuideDialog month={month} />
              <ProcessorReportSheetConfigDialog month={month} />
            </>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="grid text-sm" style={{ gridTemplateColumns }}>
          <div className="sticky left-0 top-0 z-30 table-head-cell px-2 py-1.5 text-[10px] font-semibold uppercase text-table-head-text">
            {t("processorReport.tasksHeader")}
          </div>
          {processors.map((p) => (
            <div
              key={p.id}
              className="sticky top-0 z-20 flex items-center justify-center table-head-cell px-1 py-1.5 text-[10px] font-semibold text-table-head-text"
            >
              {p.name}
            </div>
          ))}
          <div className="sticky top-0 z-20 flex items-center justify-center border-b border-r border-border-strong bg-accent-soft px-1 py-1.5 text-[10px] font-semibold text-table-head-text">
            {t("processorReport.totalHeader")}
          </div>

          <SectionRows
            sections={sections}
            columns={columns}
            computeSectionTotal={(taskIds, colIndex) => {
              const col = columns[colIndex];
              if (col.key === "__total__") return taskIds.reduce((sum, id) => sum + totalValue(id), 0);
              return taskIds.reduce((sum, id) => sum + cellValue(id, col.key), 0);
            }}
            renderCell={(taskId, colIndex) => {
              const col = columns[colIndex];
              const value = col.key === "__total__" ? totalValue(taskId) : cellValue(taskId, col.key);
              return (
                <div
                  className={`flex h-full items-center justify-center text-[11px] ${
                    col.key === "__total__" ? "bg-accent-soft font-medium text-text" : "text-text-dim"
                  }`}
                >
                  {value || ""}
                </div>
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}
