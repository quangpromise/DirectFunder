"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Plus, Trash2, FileText, DollarSign, GripVertical, ShieldAlert, Download, Upload, Layers, CheckCircle2 } from "lucide-react";
import { downloadCaseTemplate, parseCaseExcelFile } from "@/lib/excel";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { canEditCase, canEditColumn, canViewCase, hasFeature } from "@/lib/rbac";
import { CaseRecord, ColumnDef, SelectOption, User } from "@/lib/types";
import { EditableCell } from "@/components/editable-cell";
import { AssignMenu } from "@/components/assign-menu";
import { AddColumnDialog } from "@/components/add-column-dialog";
import { ColumnSettingsDialog } from "@/components/column-settings-dialog";
import { ClientNameCell } from "@/components/client-name-cell";
import { SsnCell } from "@/components/ssn-cell";
import { DescriptionCell } from "@/components/description-cell";
import { OrderCell } from "@/components/order-cell";
import { HistoryDialog } from "@/components/history-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { useAlert } from "@/components/alert-dialog";
import { isDuplicateSsn, digitsOnly } from "@/lib/ssn";
import { getFullName } from "@/lib/client-name";
import { hasWaitingOrderForSsn, missingOrderClientFields } from "@/lib/orders";
import { greetingPeriodFor, GreetingPeriod } from "@/lib/greeting";
import { useT, useLanguage, translateColumnLabel, translateOptionLabel } from "@/lib/i18n";
import { PeriodSelector, ReportPanel, ReportStatCard } from "@/components/report-ui";
import {
  ReportPeriod,
  currentPhoenixMonth,
  currentPhoenixYear,
  growthPercent,
  resolveReportRange,
  toPhoenixDateStr,
} from "@/lib/report-period";

const GRIP_COL_WIDTH = 26;
const CLIENT_COL_WIDTH = 210;
const AGENT_COL_WIDTH = 100;
const PROCESSOR_COL_WIDTH = 100;
const ACTIONS_COL_WIDTH = 32;

type CaseTab = "all" | "cannot_process" | "active" | "done";
/** Nhóm status thực tế dùng để lọc dữ liệu — "all" không phải 1 nhóm status, chỉ là bỏ qua lọc. */
type CaseStatusGroup = Exclude<CaseTab, "all">;

const CASE_TABS: { id: CaseTab; labelKey: string }[] = [
  { id: "all", labelKey: "cases.tab.all" },
  { id: "cannot_process", labelKey: "cases.tab.cannotProcess" },
  { id: "active", labelKey: "cases.tab.processing" },
  { id: "done", labelKey: "cases.tab.done" },
];

// Màu nền/chữ riêng cho từng tab, gợi ý đúng ý nghĩa tên tab: All trung tính theo màu
// thương hiệu, Can not Process đỏ (bị chặn), Processing vàng (đang xử lý), Done xanh lá
// (hoàn tất). Badge đậm hơn khi tab đang được chọn.
const TAB_COLORS: Record<CaseTab, { active: string; inactive: string; badgeActive: string; badgeInactive: string }> = {
  all: {
    active: "border-accent/40 bg-accent-soft text-accent",
    inactive: "border-transparent text-text-faint hover:bg-accent-soft/40 hover:text-accent",
    badgeActive: "bg-accent/20 text-accent",
    badgeInactive: "bg-accent-soft text-accent/70",
  },
  cannot_process: {
    active: "border-red-500/40 bg-red-500/15 text-red-300 light:text-red-700",
    inactive: "border-transparent text-red-400/70 hover:bg-red-500/10 hover:text-red-300 light:text-red-600 light:hover:text-red-700",
    badgeActive: "bg-red-500/20 text-red-300 light:text-red-700",
    badgeInactive: "bg-red-500/10 text-red-400/70 light:text-red-600",
  },
  active: {
    active: "border-amber-500/40 bg-amber-500/15 text-amber-300 light:text-amber-700",
    inactive: "border-transparent text-amber-400/70 hover:bg-amber-500/10 hover:text-amber-300 light:text-amber-600 light:hover:text-amber-700",
    badgeActive: "bg-amber-500/20 text-amber-300 light:text-amber-700",
    badgeInactive: "bg-amber-500/10 text-amber-400/70 light:text-amber-600",
  },
  done: {
    active: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 light:text-emerald-700",
    inactive:
      "border-transparent text-emerald-400/70 hover:bg-emerald-500/10 hover:text-emerald-300 light:text-emerald-600 light:hover:text-emerald-700",
    badgeActive: "bg-emerald-500/20 text-emerald-300 light:text-emerald-700",
    badgeInactive: "bg-emerald-500/10 text-emerald-400/70 light:text-emerald-600",
  },
};

// Status "On-Hold"/"Cancelled" -> tab Can not Process, "CPA Review"/"Approved" (Accepted)
// -> tab Done, mọi status còn lại (kể cả status tùy chỉnh thêm sau này) -> tab Processing.
const CANNOT_PROCESS_STATUS_IDS = new Set(["on_hold", "cancelled"]);
const DONE_STATUS_IDS = new Set(["cpa_review", "approved"]);

function getCaseTab(statusId: string): CaseStatusGroup {
  if (CANNOT_PROCESS_STATUS_IDS.has(statusId)) return "cannot_process";
  if (DONE_STATUS_IDS.has(statusId)) return "done";
  return "active";
}

function StatChip({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
        <Icon size={13} />
      </div>
      <span className="text-xs text-text-faint">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

function StatusStatChip({ option, value }: { option: SelectOption; value: number }) {
  const { language } = useLanguage();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
      <span className="text-xs text-text-faint">{translateOptionLabel(language, option.id, option.label)}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

/** Bản gold/đen của StatusStatChip, dùng riêng trong panel Dashboard để khớp tông màu
 * Dashboard.png — không đụng tới StatusStatChip gốc (vẫn dùng ở thanh toolbar Danh sách). */
function ReportStatusChip({ option, value }: { option: SelectOption; value: number }) {
  const { language } = useLanguage();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/15 bg-black/40 px-3 py-1.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
      <span className="text-xs text-white/45">{translateOptionLabel(language, option.id, option.label)}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

export default function CasesPage() {
  const user = useCurrentUser();
  const viewerRole = user?.role;
  const cases = useAppStore((s) => s.cases);
  const columns = useAppStore((s) => s.columns);
  const users = useAppStore((s) => s.users);
  const permissions = useAppStore((s) => s.featurePermissions);
  const updateCell = useAppStore((s) => s.updateCell);
  const placeOrder = useAppStore((s) => s.placeOrder);
  const addRow = useAppStore((s) => s.addRow);
  const importCases = useAppStore((s) => s.importCases);
  const deleteRow = useAppStore((s) => s.deleteRow);
  const deletionHistory = useAppStore((s) => s.deletionHistory);
  const editHistory = useAppStore((s) => s.editHistory);
  const addColumn = useAppStore((s) => s.addColumn);
  const removeColumn = useAppStore((s) => s.removeColumn);
  const renameColumn = useAppStore((s) => s.renameColumn);
  const setColumnEditableBy = useAppStore((s) => s.setColumnEditableBy);
  const addColumnOption = useAppStore((s) => s.addColumnOption);
  const updateColumnOption = useAppStore((s) => s.updateColumnOption);
  const removeColumnOption = useAppStore((s) => s.removeColumnOption);
  const assignCase = useAppStore((s) => s.assignCase);
  const reorderColumn = useAppStore((s) => s.reorderColumn);
  const reorderCase = useAppStore((s) => s.reorderCase);
  const updateClientLink = useAppStore((s) => s.updateClientLink);
  const updateSsn = useAppStore((s) => s.updateSsn);
  const updateClientName = useAppStore((s) => s.updateClientName);
  const addDescriptionReply = useAppStore((s) => s.addDescriptionReply);
  const markDescriptionRead = useAppStore((s) => s.markDescriptionRead);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // Lọc theo Processor — hiện cho Processor Leader (xem hồ sơ của cả nhóm Processor
  // mình phụ trách) và Agent (xem hồ sơ CỦA CHÍNH MÌNH đang do Processor nào xử lý).
  // Mặc định "all".
  const [processorFilter, setProcessorFilter] = useState<string>("all");
  // Lọc theo Agent đang được gán — hiện cho Agent Leader (xem hồ sơ của cả nhóm Agent
  // mình phụ trách) và Processor (xem hồ sơ CỦA CHÍNH MÌNH do Agent nào tạo/phụ trách).
  // Mặc định "all" ("Tất cả Agent") — lựa chọn thứ 2 mới là "Hồ sơ của tôi".
  const [agentFilter, setAgentFilter] = useState<string>("all");
  // Khung giờ hiện tại (sáng/chiều/tối/khuya, tính theo giờ Phoenix — xem greeting.ts)
  // dùng cho lời chào đầu trang. Khởi tạo null (thay vì tính ngay lúc render) để tránh
  // lệch giữa server/client (server không có múi giờ Phoenix của client) -> chỉ set khi
  // đã mount ở client, tự cập nhật lại mỗi phút phòng khi mở trang qua lúc giao ca.
  const [greetingPeriod, setGreetingPeriod] = useState<GreetingPeriod | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGreetingPeriod(greetingPeriodFor(new Date()));
    const id = setInterval(() => setGreetingPeriod(greetingPeriodFor(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);
  const [tab, setTab] = useState<CaseTab>("all");
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"list" | "dashboard">("list");
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("today");
  const [reportMonth, setReportMonth] = useState<string>(() => currentPhoenixMonth());
  const [reportYear, setReportYear] = useState<number>(() => currentPhoenixYear());
  const [reportFrom, setReportFrom] = useState<string>(() => toPhoenixDateStr(new Date()));
  const [reportTo, setReportTo] = useState<string>(() => toPhoenixDateStr(new Date()));
  const { confirm, ConfirmDialogUI } = useConfirm();
  const { alertWarn, AlertDialogUI } = useAlert();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Bấm vào 1 thông báo (notification bell) -> điều hướng tới đây kèm ?highlight=<caseId>
  // — reset mọi bộ lọc đang che dòng đó (tab/status/search/view) để chắc chắn dòng hiện
  // ra, rồi cuộn tới + nhấp nháy 5s (xem .row-highlight trong globals.css). Xoá query
  // param khỏi URL ngay sau khi đọc để back/refresh không nhấp nháy lại.
  useEffect(() => {
    const id = searchParams.get("highlight");
    if (!id) return;
    // Đồng bộ state từ URL (query param do điều hướng ngoài tạo ra khi bấm 1 thông báo)
    // — không phải state phái sinh từ render, nên set trực tiếp trong effect là đúng.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView("list");
    setTab("all");
    setStatusFilter("all");
    setProcessorFilter("all");
    setAgentFilter("all");
    setSearch("");
    setHighlightId(id);
    router.replace("/dashboard/cases");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Effect RIÊNG cho việc tự tắt sau 5s, chỉ phụ thuộc highlightId (không phụ thuộc
  // searchParams) — router.replace() ở effect trên đổi searchParams, khiến effect đó
  // chạy lại và cleanup huỷ mất timer nếu gộp chung, làm nhấp nháy không bao giờ tắt.
  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), 5000);
    return () => clearTimeout(timer);
  }, [highlightId]);

  useEffect(() => {
    if (!highlightId) return;
    const el = document.querySelector(`[data-row-id="${highlightId}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId]);
  const t = useT();
  const { language } = useLanguage();

  // Đọc file Excel người dùng chọn (input ẩn, xem nút "Nhập Excel") -> parse -> tạo hàng
  // loạt hồ sơ qua store.importCases -> báo lại số dòng thành công/thất bại.
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setImporting(true);
    try {
      const rows = await parseCaseExcelFile(file);
      if (rows.length === 0) {
        await alertWarn(t("cases.import.emptyFile"), { title: t("cases.import.title") });
        return;
      }
      const { success, failed } = await importCases(rows, user.id, user.role);
      await alertWarn(t("cases.import.result", { success: String(success), failed: String(failed) }), {
        title: t("cases.import.title"),
      });
    } catch (err) {
      console.error("[import] Đọc file Excel thất bại:", err);
      await alertWarn(t("cases.import.parseError"), { title: t("cases.import.title") });
    } finally {
      setImporting(false);
    }
  }

  const statusColumn = columns.find((c) => c.id === "status");
  const clientColumn = columns.find((c) => c.id === "clientName");
  const statusOptions = statusColumn?.options ?? [];
  const STATUS_COL_WIDTH = statusColumn?.width ?? 112;
  const STATUS_LEFT = GRIP_COL_WIDTH;
  const CLIENT_LEFT = STATUS_LEFT + STATUS_COL_WIDTH;

  // Agent chỉ thấy hồ sơ được gán cho mình ở cột Agent; Processor tương tự ở cột Processor;
  // Agent Leader/Processor Leader thấy hồ sơ của các thành viên trong nhóm (teamMemberIds).
  const visibleCases = useMemo(() => {
    if (!user) return [];
    return cases.filter((c) => canViewCase(user.role, user.id, c, user.teamMemberIds));
  }, [cases, user]);

  const filtered = useMemo(() => {
    return visibleCases.filter((c) => {
      if (tab !== "all" && getCaseTab(c.status) !== tab) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      // 2 bộ lọc dưới đây CHỈ áp dụng đúng role liên quan (xem khai báo state) — không
      // chặn theo role thì role không có UI cho bộ lọc này cũng bị ảnh hưởng bởi state
      // mặc định, ẩn nhầm hồ sơ.
      if ((user?.role === "processor_leader" || user?.role === "agent") && processorFilter !== "all") {
        const assignee = c.assignedProcessor ?? "unassigned";
        if (assignee !== processorFilter) return false;
      }
      if ((user?.role === "agent_leader" || user?.role === "processor") && agentFilter !== "all") {
        const assignee = c.assignedTo ?? "unassigned";
        if (assignee !== agentFilter) return false;
      }
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const qDigits = digitsOnly(search);
      return (
        getFullName(c).toLowerCase().includes(q) ||
        c.ssn.some((s) => s && (s.toLowerCase().includes(q) || (qDigits && digitsOnly(s).includes(qDigits)))) ||
        c.phone.includes(q) ||
        c.zipcode.includes(q) ||
        c.description.toLowerCase().includes(q)
      );
    });
  }, [visibleCases, search, statusFilter, processorFilter, agentFilter, tab, user?.role]);

  const stats = useMemo(() => {
    const totalMoney = visibleCases.reduce((sum, c) => sum + c.money, 0);
    const byStatus: Record<string, number> = {};
    const byTab: Record<CaseTab, number> = { all: 0, cannot_process: 0, active: 0, done: 0 };
    for (const c of visibleCases) {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      byTab[getCaseTab(c.status)] += 1;
      byTab.all += 1;
    }
    return { totalMoney, total: visibleCases.length, byStatus, byTab };
  }, [visibleCases]);

  // Khoảng ngày hiện tại + khoảng liền trước để so sánh (MoM/YoY/DoD tùy chế độ) — tính
  // chung qua resolveReportRange (xem src/lib/report-period.ts) theo period đang chọn.
  const { start: dashRangeStart, end: dashRangeEnd, prevStart, prevEnd } = useMemo(
    () =>
      resolveReportRange({
        period: reportPeriod,
        month: reportMonth,
        year: reportYear,
        customFrom: reportFrom,
        customTo: reportTo,
      }),
    [reportPeriod, reportMonth, reportYear, reportFrom, reportTo]
  );

  const growthLabelKey =
    reportPeriod === "today"
      ? "report.vsYesterday"
      : reportPeriod === "month"
        ? "report.vsPrevMonth"
        : reportPeriod === "year"
          ? "report.vsPrevYear"
          : "report.vsPrevRange";

  // Hồ sơ MỚI TẠO trong khoảng ngày đã chọn + khoảng liền trước (dựa theo createdAt) —
  // không liên quan tới bộ lọc tab/search/statusFilter đang dùng ở view Danh sách.
  const [newInRange, newInPrevRange] = useMemo(() => {
    const createdIn = (start: string, end: string) =>
      visibleCases.filter((c) => {
        const d = toPhoenixDateStr(new Date(c.createdAt));
        return d >= start && d <= end;
      });
    return [createdIn(dashRangeStart, dashRangeEnd), createdIn(prevStart, prevEnd)];
  }, [visibleCases, dashRangeStart, dashRangeEnd, prevStart, prevEnd]);

  // Hồ sơ đã chuyển sang nhóm "Hoàn tất" (CPA Review/Approved) trong khoảng ngày đã chọn
  // — dùng updatedAt làm mốc gần đúng, vì hệ thống chưa lưu riêng "ngày hoàn tất".
  const [completedInRange, completedInPrevRange] = useMemo(() => {
    const completedIn = (start: string, end: string) =>
      visibleCases.filter((c) => {
        if (!DONE_STATUS_IDS.has(c.status)) return false;
        const d = toPhoenixDateStr(new Date(c.updatedAt));
        return d >= start && d <= end;
      });
    return [completedIn(dashRangeStart, dashRangeEnd), completedIn(prevStart, prevEnd)];
  }, [visibleCases, dashRangeStart, dashRangeEnd, prevStart, prevEnd]);

  const newInRangeMoney = useMemo(() => newInRange.reduce((sum, c) => sum + c.money, 0), [newInRange]);
  const newInPrevRangeMoney = useMemo(() => newInPrevRange.reduce((sum, c) => sum + c.money, 0), [newInPrevRange]);

  const newByStatusInRange = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of newInRange) map[c.status] = (map[c.status] ?? 0) + 1;
    return map;
  }, [newInRange]);

  // Báo cáo theo từng tài khoản Agent/Processor được gán, chia 3 cột: Mới (tạo trong
  // khoảng đã chọn), Đang xử lý (đang ở nhóm status "active" ngay hiện tại, không phụ
  // thuộc khoảng ngày — phản ánh khối lượng việc đang ôm), Hoàn tất (chuyển sang nhóm
  // "done" trong khoảng đã chọn). Phân quyền riêng: tài khoản Agent/Processor CHỈ xem
  // báo cáo của chính mình, không thấy báo cáo của Agent/Processor khác; Agent Leader/
  // Processor Leader xem được báo cáo của TẤT CẢ thành viên trong nhóm mình phụ trách —
  // Manager/Accounting xem được cả 2 nhóm.
  const memberNewStats = useMemo(() => {
    const teamIds = user?.teamMemberIds;
    const staff = users.filter((u) => {
      if (viewerRole === "agent" || viewerRole === "processor") return u.id === user?.id;
      if (viewerRole === "agent_leader") return u.role === "agent" && Boolean(teamIds?.includes(u.id));
      if (viewerRole === "processor_leader") return u.role === "processor" && Boolean(teamIds?.includes(u.id));
      return u.role === "agent" || u.role === "processor";
    });
    return staff.map((u) => {
      const isMine = (c: CaseRecord) => c.assignedTo === u.id || c.assignedProcessor === u.id;
      const newCount = newInRange.filter(isMine).length;
      const processingCount = visibleCases.filter((c) => isMine(c) && getCaseTab(c.status) === "active").length;
      const completedCount = completedInRange.filter(isMine).length;
      return { id: u.id, name: u.name, role: u.role, newCount, processingCount, completedCount };
    });
  }, [users, visibleCases, newInRange, completedInRange, viewerRole, user?.id, user?.teamMemberIds]);

  if (!user) return null;

  if (user.role === "support") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <ShieldAlert size={28} className="text-text-faint" />
        <p className="text-sm text-text-dim">{t("cases.supportBlocked")}</p>
      </div>
    );
  }

  const canAddColumnFeature = hasFeature(permissions, "addColumn", user.role);
  const canEditColumnFeature = hasFeature(permissions, "editColumn", user.role);
  const canAddRowFeature = hasFeature(permissions, "addRow", user.role);
  const canAssignFeature = hasFeature(permissions, "assignCase", user.role);
  const canDeleteRowFeature = hasFeature(permissions, "deleteRow", user.role);

  const tabStatusOptions = tab === "all" ? statusOptions : statusOptions.filter((o) => getCaseTab(o.id) === tab);

  function changeTab(next: CaseTab) {
    setTab(next);
    setStatusFilter("all");
  }

  const otherColumns = columns.filter(
    (col) =>
      col.key !== "clientName" &&
      col.id !== "status" &&
      col.id !== "orderStatusOrder8821" &&
      col.id !== "orderStatusOrderTtsWit" &&
      !col.hidden
  );
  // Giao việc cột Agent hiện nhóm Agent + Agent Leader, cột Processor hiện nhóm
  // Processor + Processor Leader — không lẫn các vai trò khác vào danh sách chọn.
  const agentUsers = users.filter((u) => u.role === "agent" || u.role === "agent_leader");
  const processorUsers = users.filter((u) => u.role === "processor" || u.role === "processor_leader");
  const gridTemplateColumns = [
    `${GRIP_COL_WIDTH}px`,
    `${STATUS_COL_WIDTH}px`,
    `${CLIENT_COL_WIDTH}px`,
    ...otherColumns.map((col) => (col.key === "description" ? "minmax(122px,1fr)" : `${col.width}px`)),
    `${AGENT_COL_WIDTH}px`,
    `${PROCESSOR_COL_WIDTH}px`,
    `${ACTIONS_COL_WIDTH}px`,
  ].join(" ");

  return (
    <div className="flex h-full flex-col">
      {ConfirmDialogUI}
      {AlertDialogUI}
      <div className="flex items-center gap-1.5 border-b border-border px-4 pt-3 sm:px-6">
        {view === "list" &&
          CASE_TABS.map((ct) => {
            const colors = TAB_COLORS[ct.id];
            return (
              <button
                key={ct.id}
                onClick={() => changeTab(ct.id)}
                className={`flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3.5 py-2 text-sm font-medium transition ${
                  tab === ct.id ? colors.active : colors.inactive
                }`}
              >
                {t(ct.labelKey)}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                    tab === ct.id ? colors.badgeActive : colors.badgeInactive
                  }`}
                >
                  {stats.byTab[ct.id]}
                </span>
              </button>
            );
          })}

        <div className="ml-auto mb-1.5 flex shrink-0 gap-1.5 rounded-lg border border-border bg-surface p-1">
          <button
            onClick={() => setView("list")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              view === "list" ? "gradient-btn text-white" : "text-text-faint hover:text-text-dim"
            }`}
          >
            {t("cases.view.list")}
          </button>
          <button
            onClick={() => setView("dashboard")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              view === "dashboard" ? "gradient-btn text-white" : "text-text-faint hover:text-text-dim"
            }`}
          >
            {t("cases.view.dashboard")}
          </button>
        </div>
      </div>
      {view === "list" && (
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-base font-semibold tracking-tight sm:text-lg">
            {t("cases.greeting")} {user.name.split(" ").slice(-1)[0]}
            {greetingPeriod && <> - {t(`cases.greetingPeriod.${greetingPeriod}`)}</>}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatChip label={t("common.total")} value={String(stats.total)} icon={FileText} />
          {statusOptions.map((o) => (
            <StatusStatChip key={o.id} option={o} value={stats.byStatus[o.id] ?? 0} />
          ))}
          <StatChip label={t("common.value")} value={`$${stats.totalMoney.toLocaleString("en-US")}`} icon={DollarSign} />
        </div>
      </div>
      )}

      {view === "list" && (
      <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-1.5">
          <button
            onClick={downloadCaseTemplate}
            title={t("cases.downloadTemplate")}
            className="flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text"
          >
            <Download size={12} />
            {t("cases.downloadTemplate")}
          </button>

          {canAddRowFeature && (
            <>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden onChange={handleImportFile} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                title={t("cases.uploadExcel")}
                className="flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
              >
                <Upload size={12} />
                {importing ? t("cases.importing") : t("cases.uploadExcel")}
              </button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("common.searchPlaceholder")}
              className="w-44 rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-accent lg:w-56"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
          >
            <option value="all" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
              {t("common.allStatus")}
            </option>
            {tabStatusOptions.map((o) => (
              <option key={o.id} value={o.id} style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                {translateOptionLabel(language, o.id, o.label)}
              </option>
            ))}
          </select>

          {(user.role === "processor_leader" || user.role === "agent") && (
            <select
              value={processorFilter}
              onChange={(e) => setProcessorFilter(e.target.value)}
              className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
            >
              <option value="all" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                {t("cases.filter.allProcessors")}
              </option>
              <option value="unassigned" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                {t("orders.dashboard.unassigned")}
              </option>
              {processorUsers.map((pu) => (
                <option key={pu.id} value={pu.id} style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                  {pu.name}
                </option>
              ))}
            </select>
          )}

          {(user.role === "agent_leader" || user.role === "processor") && (
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
            >
              <option value="all" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                {t("cases.filter.allAgents")}
              </option>
              {user.role === "agent_leader" && (
                <option value={user.id} style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                  {t("cases.filter.myCases")}
                </option>
              )}
              <option value="unassigned" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                {t("orders.dashboard.unassigned")}
              </option>
              {(user.role === "agent_leader"
                ? agentUsers.filter((au) => au.id !== user.id && au.role === "agent" && user.teamMemberIds?.includes(au.id))
                : agentUsers
              ).map((au) => (
                  <option key={au.id} value={au.id} style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                    {au.name}
                  </option>
                ))}
            </select>
          )}

          {canAddColumnFeature && <AddColumnDialog onAdd={addColumn} />}
          <HistoryDialog editHistory={editHistory} deletionHistory={deletionHistory} users={users} />

          {canAddRowFeature && (
            <button
              onClick={async () => {
                if (await confirm(t("cases.addRowConfirm"), { title: t("cases.addRowTitle") })) {
                  addRow(user.id, user.role);
                }
              }}
              className="gradient-btn flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium text-white shadow-lg shadow-blue-950/30"
            >
              <Plus size={14} />
              {t("common.addRow")}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="grid text-sm" data-grid-root style={{ gridTemplateColumns }}>
          {/* Header row */}
          <div
            className="sticky top-0 z-30 border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg"
            style={{ left: 0, gridRow: "1" }}
          />
          <div
            className="group/head sticky top-0 z-30 flex items-center justify-center gap-1 border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-2 py-2.5 text-[10px] font-semibold uppercase tracking-normal text-table-head-text"
            style={{ left: STATUS_LEFT, gridRow: "1" }}
          >
            <span className="min-w-0 flex-1 truncate text-center">
              {statusColumn ? translateColumnLabel(language, statusColumn.id, statusColumn.label) : t("col.header.status")}
            </span>
            {canEditColumnFeature && statusColumn && (
              <ColumnSettingsDialog
                column={statusColumn}
                onRename={(label) => renameColumn(statusColumn.id, label)}
                onSetEditableBy={(roles) => setColumnEditableBy(statusColumn.id, roles)}
                onAddOption={(option) => addColumnOption(statusColumn.id, option)}
                onUpdateOption={(optionId, patch) => updateColumnOption(statusColumn.id, optionId, patch)}
                onRemoveOption={(optionId) => removeColumnOption(statusColumn.id, optionId)}
                onDelete={() => removeColumn(statusColumn.id)}
              />
            )}
          </div>
          <div
            className="sticky top-0 z-30 flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text"
            style={{ left: CLIENT_LEFT, gridRow: "1" }}
          >
            {t("col.header.clientName")}
          </div>
          {otherColumns.map((col) => (
            <div
              key={col.id}
              draggable={canEditColumnFeature}
              onDragStart={() => setDragColId(col.id)}
              onDragOver={(e) => canEditColumnFeature && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (canEditColumnFeature && dragColId && dragColId !== col.id) reorderColumn(dragColId, col.id);
                setDragColId(null);
              }}
              onDragEnd={() => setDragColId(null)}
              className={`group/head sticky top-0 z-20 flex items-center justify-center gap-1 border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-2 py-2.5 text-[10px] font-semibold uppercase tracking-normal text-table-head-text ${
                canEditColumnFeature ? "cursor-grab" : ""
              } ${dragColId === col.id ? "opacity-40" : ""}`}
              style={{ gridRow: "1" }}
            >
              {canEditColumnFeature && <GripVertical size={12} className="shrink-0 text-table-head-text/70" />}
              <span className="min-w-0 flex-1 truncate text-center">{translateColumnLabel(language, col.id, col.label)}</span>
              {canEditColumnFeature && (
                <ColumnSettingsDialog
                  column={col}
                  onRename={(label) => renameColumn(col.id, label)}
                  onSetEditableBy={(roles) => setColumnEditableBy(col.id, roles)}
                  onAddOption={(option) => addColumnOption(col.id, option)}
                  onUpdateOption={(optionId, patch) => updateColumnOption(col.id, optionId, patch)}
                  onRemoveOption={(optionId) => removeColumnOption(col.id, optionId)}
                  onDelete={() => removeColumn(col.id)}
                />
              )}
            </div>
          ))}
          <div
            className="sticky top-0 z-20 flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text"
            style={{ gridRow: "1" }}
          >
            {t("col.header.agent")}
          </div>
          <div
            className="sticky top-0 z-20 flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text"
            style={{ gridRow: "1" }}
          >
            {t("col.header.processor")}
          </div>
          <div className="sticky top-0 z-20 border-b-2 border-b-accent bg-table-head-bg" style={{ gridRow: "1" }} />

          {/* Body rows */}
          {filtered.map((row) => (
            <RowCells
              key={row.id}
              row={row}
              highlighted={row.id === highlightId}
              allCases={cases}
              otherColumns={otherColumns}
              statusColumn={statusColumn}
              clientColumn={clientColumn}
              statusLeft={STATUS_LEFT}
              clientLeft={CLIENT_LEFT}
              user={user}
              users={users}
              agentUsers={agentUsers}
              processorUsers={processorUsers}
              updateCell={updateCell}
              placeOrder={placeOrder}
              deleteRow={deleteRow}
              assignCase={assignCase}
              updateClientLink={updateClientLink}
              updateSsn={updateSsn}
              updateClientName={updateClientName}
              addDescriptionReply={addDescriptionReply}
              markDescriptionRead={markDescriptionRead}
              canAssignFeature={canAssignFeature}
              canDeleteRowFeature={canDeleteRowFeature}
              confirm={confirm}
              alertWarn={alertWarn}
              dragRowId={dragRowId}
              onRowDragStart={() => setDragRowId(row.id)}
              onRowDrop={() => {
                if (dragRowId && dragRowId !== row.id) reorderCase(dragRowId, row.id);
                setDragRowId(null);
              }}
              onRowDragEnd={() => setDragRowId(null)}
            />
          ))}

          {filtered.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-text-faint" style={{ gridColumn: `1 / -1` }}>
              {t("common.noRowsFound")}
            </div>
          )}
        </div>
      </div>
      </>
      )}

      {view === "dashboard" && (
        <div className="flex-1 space-y-3 overflow-auto bg-black/20 px-4 py-3 sm:px-6">
          <ReportPanel title={t("cases.dashboard.overviewTitle")} description={t("cases.dashboard.overviewDesc")}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ReportStatCard icon={Layers} label={t("common.total")} value={String(stats.total)} tone="accent" />
              <ReportStatCard
                icon={DollarSign}
                label={t("common.value")}
                value={`$${stats.totalMoney.toLocaleString("en-US")}`}
                tone="accent"
              />
              <ReportStatCard icon={CheckCircle2} label={t("cases.tab.done")} value={String(stats.byTab.done)} tone="emerald" />
            </div>
          </ReportPanel>

          <ReportPanel title={t("cases.dashboard.rangeTitle")} description={t("cases.dashboard.rangeDesc")}>
            <PeriodSelector
              period={reportPeriod}
              onPeriodChange={setReportPeriod}
              month={reportMonth}
              onMonthChange={setReportMonth}
              year={reportYear}
              onYearChange={setReportYear}
              customFrom={reportFrom}
              onCustomFromChange={setReportFrom}
              customTo={reportTo}
              onCustomToChange={setReportTo}
            />

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ReportStatCard
                icon={Plus}
                label={t("cases.dashboard.newCases")}
                value={String(newInRange.length)}
                tone="amber"
                growthPercent={growthPercent(newInRange.length, newInPrevRange.length)}
                growthLabel={t(growthLabelKey)}
              />
              <ReportStatCard
                icon={DollarSign}
                label={t("cases.dashboard.newMoney")}
                value={`$${newInRangeMoney.toLocaleString("en-US")}`}
                tone="amber"
                growthPercent={growthPercent(newInRangeMoney, newInPrevRangeMoney)}
                growthLabel={t(growthLabelKey)}
              />
              <ReportStatCard
                icon={CheckCircle2}
                label={t("cases.dashboard.completedCases")}
                value={String(completedInRange.length)}
                tone="emerald"
                growthPercent={growthPercent(completedInRange.length, completedInPrevRange.length)}
                growthLabel={t(growthLabelKey)}
              />
            </div>

            {statusOptions.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {statusOptions.map((o) => (
                  <ReportStatusChip key={o.id} option={o} value={newByStatusInRange[o.id] ?? 0} />
                ))}
              </div>
            )}
          </ReportPanel>

          <ReportPanel title={t("cases.dashboard.byMemberTitle")} description={t("cases.dashboard.byMemberDesc")}>
            <div className="max-h-48 overflow-auto rounded-xl border border-amber-500/15">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr>
                    <th className="sticky top-0 border-b-2 border-r border-amber-500/15 border-b-amber-400/60 bg-black/70 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-normal text-amber-100 backdrop-blur">
                      {t("orders.dashboard.colMember")}
                    </th>
                    <th className="sticky top-0 border-b-2 border-r border-amber-500/15 border-b-amber-400/60 bg-black/70 px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-normal text-amber-100 backdrop-blur">
                      {t("cases.dashboard.colRole")}
                    </th>
                    <th className="sticky top-0 border-b-2 border-r border-amber-500/15 border-b-amber-400/60 bg-black/70 px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-normal text-amber-100 backdrop-blur">
                      {t("cases.dashboard.newCases")}
                    </th>
                    <th className="sticky top-0 border-b-2 border-r border-amber-500/15 border-b-amber-400/60 bg-black/70 px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-normal text-amber-100 backdrop-blur">
                      {t("cases.dashboard.colProcessing")}
                    </th>
                    <th className="sticky top-0 border-b-2 border-amber-500/15 border-b-amber-400/60 bg-black/70 px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-normal text-amber-100 backdrop-blur">
                      {t("cases.dashboard.completedCases")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {memberNewStats.map((m, i) => (
                    <tr key={m.id} className="transition hover:bg-amber-500/5">
                      <td
                        className={`border-r border-amber-500/10 px-3 py-1.5 text-xs font-medium text-white ${i === memberNewStats.length - 1 ? "" : "border-b"}`}
                      >
                        {m.name}
                      </td>
                      <td
                        className={`border-r border-amber-500/10 px-3 py-1.5 text-center text-xs text-white/45 ${i === memberNewStats.length - 1 ? "" : "border-b"}`}
                      >
                        {m.role === "agent" ? "Agent" : "Processor"}
                      </td>
                      <td
                        className={`border-r border-amber-500/10 px-3 py-1.5 text-center text-xs font-semibold text-amber-200 ${i === memberNewStats.length - 1 ? "" : "border-b border-amber-500/10"}`}
                      >
                        {m.newCount}
                      </td>
                      <td
                        className={`border-r border-amber-500/10 px-3 py-1.5 text-center text-xs font-semibold text-orange-300 ${i === memberNewStats.length - 1 ? "" : "border-b border-amber-500/10"}`}
                      >
                        {m.processingCount}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-center text-xs font-semibold text-emerald-300 ${i === memberNewStats.length - 1 ? "" : "border-b border-amber-500/10"}`}
                      >
                        {m.completedCount}
                      </td>
                    </tr>
                  ))}
                  {memberNewStats.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-sm text-white/40">
                        {t("common.noRowsFound")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </ReportPanel>
        </div>
      )}
    </div>
  );
}

function RowCells({
  row,
  highlighted,
  allCases,
  otherColumns,
  statusColumn,
  clientColumn,
  statusLeft,
  clientLeft,
  user,
  users,
  agentUsers,
  processorUsers,
  updateCell,
  placeOrder,
  deleteRow,
  assignCase,
  updateClientLink,
  updateSsn,
  updateClientName,
  addDescriptionReply,
  markDescriptionRead,
  canAssignFeature,
  canDeleteRowFeature,
  confirm,
  alertWarn,
  dragRowId,
  onRowDragStart,
  onRowDrop,
  onRowDragEnd,
}: {
  row: CaseRecord;
  highlighted: boolean;
  allCases: CaseRecord[];
  otherColumns: ColumnDef[];
  statusColumn: ColumnDef | undefined;
  clientColumn: ColumnDef | undefined;
  statusLeft: number;
  clientLeft: number;
  user: User;
  users: User[];
  agentUsers: User[];
  processorUsers: User[];
  updateCell: (caseId: string, columnKey: string, value: string | number | boolean | null, isCustom: boolean) => void;
  placeOrder: (
    caseId: string,
    field: "order8821" | "orderTtsWit",
    byUserId: string,
    clientSlots?: (0 | 1)[],
    description?: string
  ) => void;
  deleteRow: (caseId: string, deletedByUserId: string) => void;
  assignCase: (caseId: string, toUserId: string | null, field: "assignedTo" | "assignedProcessor") => void;
  updateClientLink: (caseId: string, link: string | null) => void;
  updateSsn: (caseId: string, slot: 0 | 1, value: string | null) => void;
  updateClientName: (caseId: string, slot: 0 | 1, field: "firstName" | "lastName", value: string) => void;
  addDescriptionReply: (caseId: string, authorId: string, text: string) => void;
  markDescriptionRead: (caseId: string, userId: string) => void;
  canAssignFeature: boolean;
  canDeleteRowFeature: boolean;
  confirm: (message: string, opts?: { title?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  alertWarn: (message: string, opts?: { title?: string }) => Promise<void>;
  dragRowId: string | null;
  onRowDragStart: () => void;
  onRowDrop: () => void;
  onRowDragEnd: () => void;
}) {
  const t = useT();
  const clientColDef: ColumnDef = clientColumn ?? {
    id: "clientName",
    key: "clientName",
    label: "Client Name",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "support"],
  };
  const ssnColDef = otherColumns.find((c) => c.id === "ssn");
  // Agent Leader/Processor Leader chỉ sửa được hồ sơ do chính mình thêm vào hoặc đang
  // gán cho thành viên trong nhóm mình — các role khác giữ quyền sửa như cũ (đã lọc
  // đúng phạm vi từ visibleCases nên không cần giới hạn thêm theo dòng).
  const canEditRow = canEditCase(user.role, user.id, row, user.teamMemberIds);
  return (
    <div
      data-row-id={row.id}
      className={`group contents ${dragRowId === row.id ? "opacity-40" : ""} ${highlighted ? "row-highlight" : ""}`}
    >
      <div
        draggable
        onDragStart={onRowDragStart}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onRowDrop();
        }}
        onDragEnd={onRowDragEnd}
        className="sticky z-10 flex cursor-grab items-center justify-center border-b border-r border-border bg-bg text-text-faint transition-colors group-hover:bg-surface-hover active:cursor-grabbing"
        style={{ left: 0 }}
      >
        <GripVertical size={13} />
      </div>
      <div
        className="sticky z-10 flex h-full min-w-0 items-center border-b border-r border-border bg-bg transition-colors group-hover:bg-surface-hover"
        style={{ left: statusLeft }}
      >
        {statusColumn && (
          <EditableCell
            value={row.status}
            type="select"
            options={statusColumn.options}
            editable={canEditColumn(user.role, statusColumn) && canEditRow}
            onCommit={(v) => updateCell(row.id, "status", v, false)}
          />
        )}
      </div>
      <div
        className="sticky z-10 border-b border-r border-border bg-bg transition-colors group-hover:bg-surface-hover"
        style={{ left: clientLeft }}
      >
        <ClientNameCell
          clients={row.clients}
          link={row.clientLink}
          editable={canEditColumn(user.role, clientColDef) && canEditRow}
          onCommitName={(slot, field, v) => updateClientName(row.id, slot, field, v)}
          onCommitLink={(link) => updateClientLink(row.id, link)}
        />
      </div>
      {otherColumns.map((col) =>
        col.id === "ssn" ? (
          <div key={col.id} className="flex h-full items-center border-b border-r border-border transition-colors group-hover:bg-surface-hover">
            <SsnCell
              value={row.ssn}
              editable={ssnColDef ? canEditColumn(user.role, ssnColDef) && canEditRow : false}
              isDuplicate={(slot, candidate) => isDuplicateSsn(allCases, candidate, row.id, slot)}
              onCommit={(slot, v) => updateSsn(row.id, slot, v)}
            />
          </div>
        ) : col.id === "description" ? (
          <div
            key={col.id}
            className="flex h-full items-center border-b border-r border-border transition-colors group-hover:bg-surface-hover"
          >
            <DescriptionCell
              description={row.description}
              replies={row.descriptionReplies}
              unread={row.descriptionReplies.length > 0 && !row.descriptionReadBy.includes(user.id)}
              users={users}
              editable={canEditColumn(user.role, col) && canEditRow}
              onReply={(text) => addDescriptionReply(row.id, user.id, text)}
              onMarkRead={() => markDescriptionRead(row.id, user.id)}
            />
          </div>
        ) : col.id === "order" ? (
          <div key={col.id} className="border-b border-r border-border transition-colors group-hover:bg-surface-hover">
            <OrderCell
              editable={canEditColumn(user.role, col) && canEditRow}
              onOrder8821={async (slots) => {
                const label = `Order 8821 - ${slots.length === 2 ? t("order8821.both") : slots[0] === 0 ? t("order8821.client1") : t("order8821.client2")}`;
                if (hasWaitingOrderForSsn(allCases, "order8821", slots.map((s) => row.ssn[s]))) {
                  await alertWarn(t("order8821.oldNotDoneWarning"), { title: t("cases.placeOrderTitle") });
                  return false;
                }
                const missing = missingOrderClientFields(row, slots);
                if (missing.length > 0) {
                  await alertWarn(`${t("cases.missingFieldsBody", { label })}\n${missing.map((m) => `• ${m}`).join("\n")}`, {
                    title: t("cases.missingFieldsTitle"),
                  });
                  return false;
                }
                if (await confirm(t("cases.placeOrderConfirm", { label }), { title: t("cases.placeOrderTitle") })) {
                  placeOrder(row.id, "order8821", user.id, slots);
                  return true;
                }
                return false;
              }}
              onOrderTtsWit={async (slots, description) => {
                const label = `Order TTS & WIT - ${slots.length === 2 ? t("order8821.both") : slots[0] === 0 ? t("order8821.client1") : t("order8821.client2")}`;
                if (hasWaitingOrderForSsn(allCases, "orderTtsWit", slots.map((s) => row.ssn[s]))) {
                  await alertWarn(t("order8821.oldNotDoneWarning"), { title: t("cases.placeOrderTitle") });
                  return false;
                }
                const missing = missingOrderClientFields(row, slots);
                if (missing.length > 0) {
                  await alertWarn(`${t("cases.missingFieldsBody", { label })}\n${missing.map((m) => `• ${m}`).join("\n")}`, {
                    title: t("cases.missingFieldsTitle"),
                  });
                  return false;
                }
                if (await confirm(t("cases.placeOrderConfirm", { label }), { title: t("cases.placeOrderTitle") })) {
                  placeOrder(row.id, "orderTtsWit", user.id, slots, description);
                  return true;
                }
                return false;
              }}
            />
          </div>
        ) : (
          <div
            key={col.id}
            className="flex h-full items-center border-b border-r border-border transition-colors group-hover:bg-surface-hover"
          >
            <EditableCell
              value={col.custom ? row.custom[col.key] ?? null : (row as unknown as Record<string, string | number | boolean | null>)[col.key]}
              type={col.type}
              options={col.options}
              editable={canEditColumn(user.role, col) && canEditRow}
              onCommit={(v) => updateCell(row.id, col.key, v, Boolean(col.custom))}
            />
          </div>
        )
      )}
      <div className="flex h-full min-w-0 items-center border-b border-r border-border transition-colors group-hover:bg-surface-hover">
        <AssignMenu
          users={agentUsers}
          assignedTo={row.assignedTo}
          canAssign={canAssignFeature && canEditRow}
          onAssign={(uid) => assignCase(row.id, uid, "assignedTo")}
        />
      </div>
      <div className="flex h-full min-w-0 items-center border-b border-r border-border transition-colors group-hover:bg-surface-hover">
        <AssignMenu
          users={processorUsers}
          assignedTo={row.assignedProcessor}
          canAssign={canAssignFeature && canEditRow}
          onAssign={(uid) => assignCase(row.id, uid, "assignedProcessor")}
        />
      </div>
      <div className="border-b border-border transition-colors group-hover:bg-surface-hover">
        {canDeleteRowFeature && (
          <button
            onClick={async () => {
              if (
                await confirm(t("cases.deleteRowConfirm"), {
                  title: t("cases.deleteRowTitle"),
                  tone: "danger",
                })
              ) {
                deleteRow(row.id, user.id);
              }
            }}
            className="flex h-full w-full items-center justify-center py-2 text-text-faint opacity-0 transition hover:text-red-400 group-hover:opacity-100"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
