"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldAlert, Trash2, Download, Upload, Clock, CheckCircle2 } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { canEditColumn, hasFeature } from "@/lib/rbac";
import { CaseRecord, OrderRecord, OrderType } from "@/lib/types";
import { getClientEntries, formatLastFirst, fullName } from "@/lib/client-name";
import { formatSsn } from "@/lib/ssn";
import { hasWaitingOrderForSsn, missingOrderClientFields } from "@/lib/orders";
import { downloadOrderCaseTemplate, parseCaseExcelFile, formatDuplicateSsnLines } from "@/lib/excel";
import { ClientLinkButton } from "@/components/client-link-button";
import { AssignMenu } from "@/components/assign-menu";
import { OrderPlaceButton } from "@/components/order-place-button";
import { EditableCell } from "@/components/editable-cell";
import { ColumnSettingsDialog } from "@/components/column-settings-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { useAlert } from "@/components/alert-dialog";
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

const TAB_LABEL: Record<OrderType, string> = {
  order8821: "Order 8821",
  orderTtsWit: "Order TTS & WIT",
};

/** Order có clientSlot cố định (Order 8821 đặt qua popup chọn client) luôn tính đúng 1
 * dòng/1 lần đặt. Order cũ (clientSlot null, gồm cả Order TTS & WIT) tính theo số Client
 * Name đã điền như trước — xem getClientEntries. */
function orderRowCount(c: CaseRecord, o: OrderRecord): number {
  return o.clientSlot === 0 || o.clientSlot === 1 ? 1 : getClientEntries(c).length;
}

type SubTab = "waiting" | "done";

const SUB_TABS: { id: SubTab; labelKey: string }[] = [
  { id: "waiting", labelKey: "orders.sub.waiting" },
  { id: "done", labelKey: "orders.sub.done" },
];

// Hiển thị theo giờ Phoenix, Arizona — thống nhất với đồng hồ ở thanh điều hướng,
// tránh lệch ngày do timezone trình duyệt của từng người dùng khác nhau.
function formatOrderDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

// Ngày chọn tay (yyyy-mm-dd, không phải mốc thời gian) — hiển thị nguyên literal theo
// tháng/ngày/năm, KHÔNG dựng lại bằng `new Date()` để tránh lệch ngày do timezone.
function formatPlainDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return "—";
  return `${m}/${d}/${y}`;
}

function DateCell({
  value,
  editable,
  onCommit,
}: {
  value: string | null;
  editable: boolean;
  onCommit: (value: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value ?? ""), [value]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== (value ?? "")) onCommit(draft || null);
  }

  if (!editable) {
    return <div className="truncate px-2.5 py-1.5 text-center text-xs text-text-dim">{formatPlainDate(value)}</div>;
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
        className="w-full rounded-md border border-accent bg-bg-elevated px-2 py-1 text-center text-xs outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full truncate rounded-md px-2.5 py-1.5 text-center text-xs transition hover:bg-surface-hover"
    >
      {formatPlainDate(value)}
    </button>
  );
}

type OrderTypeCounts = Record<OrderType, number>;

export default function OrdersPage() {
  const user = useCurrentUser();
  const cases = useAppStore((s) => s.cases);
  const columns = useAppStore((s) => s.columns);
  const users = useAppStore((s) => s.users);
  const permissions = useAppStore((s) => s.featurePermissions);
  const updateClientLink = useAppStore((s) => s.updateClientLink);
  const deleteOrder = useAppStore((s) => s.deleteOrder);
  const updateOrderStatus = useAppStore((s) => s.updateOrderStatus);
  const updateOrderMilestoneDate = useAppStore((s) => s.updateOrderMilestoneDate);
  const assignOrderSupport = useAppStore((s) => s.assignOrderSupport);
  const placeOrder = useAppStore((s) => s.placeOrder);
  const renameColumn = useAppStore((s) => s.renameColumn);
  const setColumnEditableBy = useAppStore((s) => s.setColumnEditableBy);
  const addColumnOption = useAppStore((s) => s.addColumnOption);
  const updateColumnOption = useAppStore((s) => s.updateColumnOption);
  const removeColumnOption = useAppStore((s) => s.removeColumnOption);
  const removeColumn = useAppStore((s) => s.removeColumn);
  const importCases = useAppStore((s) => s.importCases);
  const [tab, setTab] = useState<OrderType>("order8821");
  const [subTab, setSubTab] = useState<SubTab>("waiting");
  // 2 bộ lọc riêng cho Tab Waiting của nhóm Support — lọc theo Status (trạng thái xử
  // lý, dùng đúng danh sách options của cột Status thuộc tab order8821/orderTtsWit
  // đang xem) và theo Assigner (tài khoản Support được giao) — mặc định "all" (không
  // lọc). Không áp dụng cho tab Done vì lúc đó mọi order đều đã status="done".
  const [waitingStatusFilter, setWaitingStatusFilter] = useState<string>("all");
  const [waitingAssigneeFilter, setWaitingAssigneeFilter] = useState<string>("all");
  const [view, setView] = useState<"list" | "dashboard">("list");
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("today");
  const [reportMonth, setReportMonth] = useState<string>(() => currentPhoenixMonth());
  const [reportYear, setReportYear] = useState<number>(() => currentPhoenixYear());
  const [reportFrom, setReportFrom] = useState<string>(() => toPhoenixDateStr(new Date()));
  const [reportTo, setReportTo] = useState<string>(() => toPhoenixDateStr(new Date()));
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clientColumn = columns.find((c) => c.id === "clientName");
  const orderStatusColumnId = tab === "order8821" ? "orderStatusOrder8821" : "orderStatusOrderTtsWit";
  const orderStatusColumn = columns.find((c) => c.id === orderStatusColumnId);
  const orderColumn = columns.find((c) => c.id === "order");
  const supportUsers = users.filter((u) => u.role === "support");
  const { confirm, ConfirmDialogUI } = useConfirm();
  const { alertWarn, AlertDialogUI } = useAlert();
  const t = useT();
  const { language } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [highlightCaseId, setHighlightCaseId] = useState<string | null>(null);

  // Bấm vào thông báo -> điều hướng tới đây kèm ?highlight=<caseId> (xem notification-
  // bell.tsx) — tự chọn đúng tab/subTab đang có order của hồ sơ đó (ưu tiên order còn
  // Waiting), rồi cuộn tới + nhấp nháy 5s toàn bộ dòng thuộc hồ sơ đó.
  useEffect(() => {
    const id = searchParams.get("highlight");
    if (!id) return;
    const kase = cases.find((c) => c.id === id);
    const orders = kase?.orders ?? [];
    const target = orders.find((o) => o.status !== "done") ?? orders[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView("list");
    if (target) {
      setTab(target.type);
      setSubTab(target.status === "done" ? "done" : "waiting");
    }
    setHighlightCaseId(id);
    router.replace("/dashboard/orders");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Effect RIÊNG cho việc tự tắt sau 5s — xem giải thích tương tự trong cases/page.tsx
  // (router.replace() đổi searchParams khiến effect đọc URL chạy lại, nếu gộp chung thì
  // cleanup sẽ huỷ mất timer, làm nhấp nháy không bao giờ tắt).
  useEffect(() => {
    if (!highlightCaseId) return;
    const timer = setTimeout(() => setHighlightCaseId(null), 5000);
    return () => clearTimeout(timer);
  }, [highlightCaseId]);

  useEffect(() => {
    if (!highlightCaseId) return;
    const el = document.querySelector(`[data-row-case-id="${highlightCaseId}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightCaseId, tab, subTab]);

  // Support xem được TẤT CẢ order của mọi tài khoản; các vai trò khác (Agent,
  // Processor...) chỉ xem order do CHÍNH họ bấm đặt.
  const isSupport = user?.role === "support";

  // Tải Excel mẫu / Nhập Excel — CHỈ nhóm Support thấy 2 nút này (xem điều kiện
  // isSupport khi render). Tạo hồ sơ mới với 5 trường Support quan tâm (Client Name,
  // Phone, SSN, Address — "Format Name" chỉ tham khảo, tự tính khi hiển thị), dùng
  // chung store.importCases với trang Hồ sơ.
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
      const { success, failed, duplicateSsn, duplicates } = await importCases(rows, user.id, user.role);
      const lines = [
        t("cases.import.result", {
          success: String(success),
          failed: String(failed),
          duplicateSsn: String(duplicateSsn),
        }),
        ...formatDuplicateSsnLines(duplicates, t),
      ];
      await alertWarn(lines.join("\n"), { title: t("cases.import.title") });
    } catch (err) {
      console.error("[import] Đọc file Excel thất bại:", err);
      await alertWarn(t("cases.import.parseError"), { title: t("cases.import.title") });
    } finally {
      setImporting(false);
    }
  }

  // Order 8821 và Order TTS & WIT là 2 danh sách HOÀN TOÀN TÁCH BIỆT (lọc theo
  // order.type) — mỗi lần đặt (kể cả đặt lại) là 1 bản ghi order MỚI, giữ nguyên toàn
  // bộ order cũ trong lịch sử (không ghi đè), nên tab Order hiển thị đủ mọi lần order
  // dưới dạng nhiều row riêng biệt.
  const matchedOrders = useMemo(() => {
    if (!user) return [];
    const list: { case: CaseRecord; order: OrderRecord }[] = [];
    const applyWaitingFilters = isSupport && subTab === "waiting";
    for (const c of cases) {
      for (const o of c.orders) {
        if (o.type !== tab) continue;
        if (!isSupport && o.placedBy !== user.id) continue;
        const isDone = o.status === "done";
        if (subTab === "done" ? !isDone : isDone) continue;
        if (applyWaitingFilters) {
          if (waitingStatusFilter !== "all" && o.status !== waitingStatusFilter) continue;
          if (waitingAssigneeFilter !== "all") {
            const assignee = o.assignedSupport ?? "unassigned";
            if (assignee !== waitingAssigneeFilter) continue;
          }
        }
        list.push({ case: c, order: o });
      }
    }
    list.sort((a, b) => new Date(a.order.placedAt).getTime() - new Date(b.order.placedAt).getTime());
    return list;
  }, [cases, tab, subTab, isSupport, user, waitingStatusFilter, waitingAssigneeFilter]);

  // Order 8821 đặt qua popup chọn client (clientSlot 0/1) -> 1 order = ĐÚNG 1 dòng, lấy
  // Client Name/SSN theo đúng slot đã chọn lúc đặt (không phụ thuộc dữ liệu Client Name
  // đã điền đủ hay chưa TẠI THỜI ĐIỂM xem sau này). Order cũ (clientSlot null, gồm cả
  // Order TTS & WIT) vẫn giữ hành vi cũ: hồ sơ có 2 client -> tách 2 dòng theo
  // getClientEntries, Phone/Address/ngày đặt/tài khoản đặt dùng chung dữ liệu hồ sơ gốc.
  const rows = useMemo(() => {
    return matchedOrders.flatMap(({ case: c, order }) => {
      if (order.clientSlot === 0 || order.clientSlot === 1) {
        const slot = order.clientSlot;
        return [
          {
            key: `${order.id}-${slot}`,
            case: c,
            order,
            slot,
            name: fullName(c.clients[slot]),
            formatName: formatLastFirst(c.clients[slot]),
            ssn: c.ssn[slot],
          },
        ];
      }
      return getClientEntries(c).map((e) => ({
        key: `${order.id}-${e.slot}`,
        case: c,
        order,
        slot: e.slot,
        name: e.name,
        formatName: formatLastFirst(e.entry),
        ssn: c.ssn[e.slot],
      }));
    });
  }, [matchedOrders]);

  // Đếm chính xác theo số DÒNG thực tế sẽ hiển thị trong bảng (giống cách tính `rows`
  // ở trên) — order có clientSlot cố định tính đúng 1 dòng; order cũ/Order TTS & WIT
  // (clientSlot null) tính theo số Client Name đã điền như trước, để badge Waiting/Done
  // luôn khớp với số hàng người dùng nhìn thấy.
  const subTabCounts = useMemo(() => {
    const counts: Record<OrderType, Record<SubTab, number>> = {
      order8821: { waiting: 0, done: 0 },
      orderTtsWit: { waiting: 0, done: 0 },
    };
    if (!user) return counts;
    for (const c of cases) {
      for (const o of c.orders) {
        if (!isSupport && o.placedBy !== user.id) continue;
        const s: SubTab = o.status === "done" ? "done" : "waiting";
        counts[o.type][s] += orderRowCount(c, o);
      }
    }
    return counts;
  }, [cases, isSupport, user]);

  // Dashboard báo cáo (chỉ Support) — đếm TOÀN BỘ order (không lọc theo placedBy, giống
  // isSupport ở trên) chia theo loại 8821 / TTS & WIT, không phụ thuộc tab/subTab đang
  // chọn ở view Danh sách.
  const unfinishedCounts = useMemo(() => {
    const counts: OrderTypeCounts = { order8821: 0, orderTtsWit: 0 };
    for (const c of cases) {
      for (const o of c.orders) {
        if (o.status === "done") continue;
        counts[o.type] += orderRowCount(c, o);
      }
    }
    return counts;
  }, [cases]);

  // Khoảng ngày hiện tại + khoảng liền trước để so sánh (MoM/YoY/DoD tùy chế độ) — tính
  // chung qua resolveReportRange (xem src/lib/report-period.ts) theo period đang chọn.
  const { start: rangeStart, end: rangeEnd, prevStart, prevEnd } = useMemo(
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

  const [completedCounts, completedCountsPrev] = useMemo(() => {
    const countCompleted = (start: string, end: string) => {
      const counts: OrderTypeCounts = { order8821: 0, orderTtsWit: 0 };
      for (const c of cases) {
        for (const o of c.orders) {
          if (o.status !== "done") continue;
          const doneDate = toPhoenixDateStr(new Date(o.statusUpdatedAt ?? o.placedAt));
          if (doneDate < start || doneDate > end) continue;
          counts[o.type] += orderRowCount(c, o);
        }
      }
      return counts;
    };
    return [countCompleted(rangeStart, rangeEnd), countCompleted(prevStart, prevEnd)];
  }, [cases, rangeStart, rangeEnd, prevStart, prevEnd]);

  // Cùng số liệu như 2 khối trên nhưng chia theo TỪNG tài khoản Support đang được giao
  // việc (o.assignedSupport) — "unassigned" gom các order chưa giao ai để không mất số
  // liệu. Dùng key riêng "unassigned" (không phải id thật) nên tra danh sách supportUsers
  // ở dưới không bao giờ trùng.
  const memberStats = useMemo(() => {
    const stats: Record<string, { unfinished: OrderTypeCounts; completed: OrderTypeCounts }> = {};
    const ensure = (key: string) =>
      stats[key] ?? (stats[key] = { unfinished: { order8821: 0, orderTtsWit: 0 }, completed: { order8821: 0, orderTtsWit: 0 } });
    for (const c of cases) {
      for (const o of c.orders) {
        const entry = ensure(o.assignedSupport ?? "unassigned");
        const count = orderRowCount(c, o);
        if (o.status !== "done") {
          entry.unfinished[o.type] += count;
        } else {
          const doneDate = toPhoenixDateStr(new Date(o.statusUpdatedAt ?? o.placedAt));
          if (doneDate >= rangeStart && doneDate <= rangeEnd) entry.completed[o.type] += count;
        }
      }
    }
    return stats;
  }, [cases, rangeStart, rangeEnd]);

  function changeTab(next: OrderType) {
    setTab(next);
    setSubTab("waiting");
  }

  if (!user) return null;

  if (!hasFeature(permissions, "viewOrders", user.role)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <ShieldAlert size={28} className="text-text-faint" />
        <p className="text-sm text-text-dim">{t("orders.accessDenied")}</p>
      </div>
    );
  }

  const canEditClientLink = clientColumn ? canEditColumn(user.role, clientColumn) : false;
  const canAssignSupport = hasFeature(permissions, "assignSupport", user.role);
  const canEditOrderStatus = orderStatusColumn ? canEditColumn(user.role, orderStatusColumn) : false;
  const canEditColumnFeature = hasFeature(permissions, "editColumn", user.role);
  const canPlaceOrder = orderColumn ? canEditColumn(user.role, orderColumn) : false;
  // Ở tab Order TTS & WIT, bổ sung thêm 1 cột "Order 8821" ngay trước cột Status để đặt
  // luôn order 8821 cho khách mà không cần quay lại trang Hồ sơ — dùng đúng logic kiểm
  // tra thiếu trường + xác nhận + placeOrder giống hệt trang Hồ sơ.
  const showOrder8821Col = tab === "orderTtsWit";
  // Order TTS & WIT bắt buộc nhập Description lúc đặt order (popup chọn client) — hiện
  // cột này để xem lại nội dung đã nhập, Order 8821 không có field này (luôn null).
  const showDescriptionCol = tab === "orderTtsWit";
  // Format Name không cần thiết ở tab Order 8821 (chỉ dùng cho TTS & WIT) — ẩn ở đó.
  // Address không cần thiết ở tab Order TTS & WIT (chỉ dùng cho Order 8821) — ẩn ở đó.
  const showFormatNameCol = tab !== "order8821";
  const showAddressCol = tab !== "orderTtsWit";

  return (
    <div className="px-4 py-6 sm:px-6">
      {ConfirmDialogUI}
      {AlertDialogUI}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Order</h1>
          <p className="mt-0.5 text-xs text-text-faint">
            {isSupport ? t("orders.supportOnlyDesc") : t("orders.selfOnlyDesc")}
          </p>
        </div>
        {isSupport && (
          <div className="flex shrink-0 gap-1.5 rounded-lg border border-border bg-surface p-1">
            <button
              onClick={() => setView("list")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                view === "list" ? "gradient-btn text-white" : "text-text-faint hover:text-text-dim"
              }`}
            >
              {t("orders.view.list")}
            </button>
            <button
              onClick={() => setView("dashboard")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                view === "dashboard" ? "gradient-btn text-white" : "text-text-faint hover:text-text-dim"
              }`}
            >
              {t("orders.view.dashboard")}
            </button>
          </div>
        )}
      </div>

      {view === "dashboard" && isSupport && (
        <div className="mt-3 space-y-2.5 rounded-2xl bg-black/20 p-3">
          <ReportPanel title={t("orders.dashboard.unfinishedTitle")} description={t("orders.dashboard.unfinishedDesc")}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ReportStatCard icon={Clock} label={TAB_LABEL.order8821} value={String(unfinishedCounts.order8821)} tone="amber" />
              <ReportStatCard icon={Clock} label={TAB_LABEL.orderTtsWit} value={String(unfinishedCounts.orderTtsWit)} tone="amber" />
              <ReportStatCard
                icon={Clock}
                label={t("orders.dashboard.total")}
                value={String(unfinishedCounts.order8821 + unfinishedCounts.orderTtsWit)}
                tone="accent"
              />
            </div>
          </ReportPanel>

          <ReportPanel title={t("orders.dashboard.completedTitle")} description={t("orders.dashboard.completedDesc")}>
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
                icon={CheckCircle2}
                label={TAB_LABEL.order8821}
                value={String(completedCounts.order8821)}
                tone="emerald"
                growthPercent={growthPercent(completedCounts.order8821, completedCountsPrev.order8821)}
                growthLabel={t(growthLabelKey)}
              />
              <ReportStatCard
                icon={CheckCircle2}
                label={TAB_LABEL.orderTtsWit}
                value={String(completedCounts.orderTtsWit)}
                tone="emerald"
                growthPercent={growthPercent(completedCounts.orderTtsWit, completedCountsPrev.orderTtsWit)}
                growthLabel={t(growthLabelKey)}
              />
              <ReportStatCard
                icon={CheckCircle2}
                label={t("orders.dashboard.total")}
                value={String(completedCounts.order8821 + completedCounts.orderTtsWit)}
                tone="accent"
                growthPercent={growthPercent(
                  completedCounts.order8821 + completedCounts.orderTtsWit,
                  completedCountsPrev.order8821 + completedCountsPrev.orderTtsWit
                )}
                growthLabel={t(growthLabelKey)}
              />
            </div>
          </ReportPanel>

          <ReportPanel title={t("orders.dashboard.byMemberTitle")} description={t("orders.dashboard.byMemberDesc")}>
            <div className="max-h-48 overflow-auto rounded-xl border border-amber-500/15">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr>
                    <th rowSpan={2} className="border-b-2 border-r border-amber-500/15 border-b-amber-400/60 bg-black/40 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-normal text-amber-100">
                      {t("orders.dashboard.colMember")}
                    </th>
                    <th colSpan={3} className="border-b border-r border-amber-500/15 bg-black/40 px-3 py-1 text-center text-[10px] font-semibold uppercase tracking-normal text-amber-300">
                      {t("orders.dashboard.colUnfinished")}
                    </th>
                    <th colSpan={3} className="border-b border-amber-500/15 border-b-amber-400/60 bg-black/40 px-3 py-1 text-center text-[10px] font-semibold uppercase tracking-normal text-emerald-300">
                      {t("orders.dashboard.colCompleted")}
                    </th>
                  </tr>
                  <tr>
                    <th className="border-b-2 border-r border-amber-500/15 border-b-amber-400/60 bg-black/40 px-2 py-1 text-center text-[10px] font-medium text-white/45">{TAB_LABEL.order8821}</th>
                    <th className="border-b-2 border-r border-amber-500/15 border-b-amber-400/60 bg-black/40 px-2 py-1 text-center text-[10px] font-medium text-white/45">{TAB_LABEL.orderTtsWit}</th>
                    <th className="border-b-2 border-r border-amber-500/15 border-b-amber-400/60 bg-black/40 px-2 py-1 text-center text-[10px] font-medium text-white/45">{t("orders.dashboard.colSubTotal")}</th>
                    <th className="border-b-2 border-r border-amber-500/15 border-b-amber-400/60 bg-black/40 px-2 py-1 text-center text-[10px] font-medium text-white/45">{TAB_LABEL.order8821}</th>
                    <th className="border-b-2 border-r border-amber-500/15 border-b-amber-400/60 bg-black/40 px-2 py-1 text-center text-[10px] font-medium text-white/45">{TAB_LABEL.orderTtsWit}</th>
                    <th className="border-b-2 border-amber-500/15 border-b-amber-400/60 bg-black/40 px-2 py-1 text-center text-[10px] font-medium text-white/45">{t("orders.dashboard.colSubTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...supportUsers.map((u) => ({ key: u.id, name: u.name })),
                    ...(memberStats.unassigned ? [{ key: "unassigned", name: t("orders.dashboard.unassigned") }] : []),
                  ].map((row, i, arr) => {
                    const s = memberStats[row.key] ?? {
                      unfinished: { order8821: 0, orderTtsWit: 0 },
                      completed: { order8821: 0, orderTtsWit: 0 },
                    };
                    const isLast = i === arr.length - 1;
                    return (
                      <tr key={row.key} className="transition hover:bg-amber-500/5">
                        <td className={`border-r border-amber-500/10 px-3 py-1.5 text-xs font-medium text-white ${isLast ? "" : "border-b"}`}>{row.name}</td>
                        <td className={`border-r border-amber-500/10 px-2 py-1.5 text-center text-xs text-white/45 ${isLast ? "" : "border-b"}`}>{s.unfinished.order8821}</td>
                        <td className={`border-r border-amber-500/10 px-2 py-1.5 text-center text-xs text-white/45 ${isLast ? "" : "border-b"}`}>{s.unfinished.orderTtsWit}</td>
                        <td className={`border-r border-amber-500/10 px-2 py-1.5 text-center text-xs font-semibold text-amber-200 ${isLast ? "" : "border-b"}`}>{s.unfinished.order8821 + s.unfinished.orderTtsWit}</td>
                        <td className={`border-r border-amber-500/10 px-2 py-1.5 text-center text-xs text-white/45 ${isLast ? "" : "border-b"}`}>{s.completed.order8821}</td>
                        <td className={`border-r border-amber-500/10 px-2 py-1.5 text-center text-xs text-white/45 ${isLast ? "" : "border-b"}`}>{s.completed.orderTtsWit}</td>
                        <td className={`px-2 py-1.5 text-center text-xs font-semibold text-emerald-300 ${isLast ? "" : "border-b border-amber-500/10"}`}>{s.completed.order8821 + s.completed.orderTtsWit}</td>
                      </tr>
                    );
                  })}
                  {supportUsers.length === 0 && !memberStats.unassigned && (
                    <tr>
                      <td colSpan={7} className="px-6 py-10 text-center text-sm text-white/40">
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

      {(view === "list" || !isSupport) && (
      <>
      <div className="mt-5 flex gap-1.5 border-b border-border">
        {(Object.keys(TAB_LABEL) as OrderType[]).map((t) => (
          <button
            key={t}
            onClick={() => changeTab(t)}
            className={`flex items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-sm font-medium transition ${
              tab === t ? "border-b-2 border-accent text-accent" : "text-text-faint hover:text-text-dim"
            }`}
          >
            {TAB_LABEL[t]}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                tab === t ? "bg-accent-soft text-accent" : "bg-surface text-text-faint"
              }`}
            >
              {subTabCounts[t].waiting}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-1.5">
        {SUB_TABS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSubTab(s.id)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              subTab === s.id
                ? s.id === "done"
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 light:text-emerald-700"
                  : "border-amber-500/40 bg-amber-500/15 text-amber-300 light:text-amber-700"
                : "border-border text-text-faint hover:text-text-dim"
            }`}
          >
            {t(s.labelKey)}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                subTab === s.id ? "bg-black/20" : "bg-surface text-text-faint"
              }`}
            >
              {subTabCounts[tab][s.id]}
            </span>
          </button>
        ))}
      </div>

      {isSupport && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5">
          {subTab === "waiting" ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={waitingStatusFilter}
                onChange={(e) => setWaitingStatusFilter(e.target.value)}
                className="h-7 rounded-md border border-border bg-surface px-2 text-xs text-text-dim outline-none focus:border-accent"
              >
                <option value="all" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                  {t("common.allStatus")}
                </option>
                {(orderStatusColumn?.options ?? []).map((o) => (
                  <option key={o.id} value={o.id} style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                    {translateOptionLabel(language, o.id, o.label)}
                  </option>
                ))}
              </select>
              <select
                value={waitingAssigneeFilter}
                onChange={(e) => setWaitingAssigneeFilter(e.target.value)}
                className="h-7 rounded-md border border-border bg-surface px-2 text-xs text-text-dim outline-none focus:border-accent"
              >
                <option value="all" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                  {t("orders.filter.allAssignees")}
                </option>
                <option value="unassigned" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                  {t("orders.dashboard.unassigned")}
                </option>
                {supportUsers.map((su) => (
                  <option key={su.id} value={su.id} style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                    {su.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div />
          )}
          <div className="hidden items-center gap-1.5 sm:flex">
          <button
            onClick={downloadOrderCaseTemplate}
            title={t("cases.downloadTemplate")}
            className="flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text"
          >
            <Download size={12} />
            {t("cases.downloadTemplate")}
          </button>
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
          </div>
        </div>
      )}

      <div className="mt-2 max-h-[65vh] overflow-auto rounded-xl border border-border-strong">
        <div
          className={`grid text-sm ${tab === "order8821" ? "min-w-[1310px]" : "min-w-[1340px]"}`}
          style={{
            // Order 8821: giữ nguyên layout gốc (Client Name co giãn theo màn hình).
            // Order TTS & WIT: nén các cột phụ lại (Client Name cố định, truncate + tooltip
            // như các cột khác), dồn phần co giãn (1fr) sang Format Name — cột duy nhất BẮT
            // BUỘC hiển thị đầy đủ không bị cắt chữ theo yêu cầu — để vừa 1 màn hình mà
            // Format Name vẫn luôn thấy trọn vẹn, kể cả khi màn hình rộng ra thêm.
            gridTemplateColumns:
              tab === "order8821"
                ? "110px minmax(180px,1fr) 110px 110px 220px 110px 110px 110px 110px 100px 36px"
                : "100px 140px 95px 95px minmax(150px,1fr) 95px 90px 90px 160px 64px 95px 90px 34px",
          }}
        >
          <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
            {t("orders.col.placedAt")}
          </div>
          <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
            {t("orders.col.clientName")}
          </div>
          <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
            {t("orders.col.phone")}
          </div>
          <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
            {t("orders.col.ssn")}
          </div>
          {showFormatNameCol && (
            <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
              {t("orders.col.formatName")}
            </div>
          )}
          {showAddressCol && (
            <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
              {t("orders.col.address")}
            </div>
          )}
          <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
            {t("orders.col.account")}
          </div>
          <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
            {tab === "order8821" ? t("orders.col.signDate") : t("orders.col.downloadedDate")}
          </div>
          <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
            {t("orders.col.statusUpdatedAt")}
          </div>
          {showDescriptionCol && (
            <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
              {t("orders.col.description")}
            </div>
          )}
          {showOrder8821Col && (
            <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-1 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
              8821
            </div>
          )}
          <div className="group/head sticky top-0 z-20 flex items-center justify-center gap-1 border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-2 py-2.5 text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
            <span className="min-w-0 flex-1 truncate text-center">
              {orderStatusColumn ? translateColumnLabel(language, orderStatusColumn.id, orderStatusColumn.label) : t("col.header.orderStatus")}
            </span>
            {(canEditColumnFeature || canEditOrderStatus) && orderStatusColumn && (
              <ColumnSettingsDialog
                column={orderStatusColumn}
                canManageFully={canEditColumnFeature}
                canManageOptions={canEditColumnFeature || canEditOrderStatus}
                onRename={(label) => renameColumn(orderStatusColumn.id, label)}
                onSetEditableBy={(roles) => setColumnEditableBy(orderStatusColumn.id, roles)}
                onAddOption={(option) => addColumnOption(orderStatusColumn.id, option)}
                onUpdateOption={(optionId, patch) => updateColumnOption(orderStatusColumn.id, optionId, patch)}
                onRemoveOption={(optionId) => removeColumnOption(orderStatusColumn.id, optionId)}
                onDelete={() => removeColumn(orderStatusColumn.id)}
              />
            )}
          </div>
          <div className="flex items-center justify-center sticky top-0 z-20 whitespace-nowrap border-b-2 border-r border-border-strong border-b-accent bg-table-head-bg px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-table-head-text">
            {t("orders.col.assign")}
          </div>
          <div className="sticky top-0 z-20 border-b-2 border-b-accent bg-table-head-bg px-2 py-2.5" />

          {rows.map((row, i) => {
            const c: CaseRecord = row.case;
            const o: OrderRecord = row.order;
            const isLast = i === rows.length - 1;
            // Order Status = "Done" tô nền cả row màu xanh lá đậm để dễ nhận biết đã
            // hoàn tất, không còn dùng màu hover mặc định (xám) như các row đang xử lý.
            const isDone = o.status === "done";
            const cellBg = isDone ? "bg-emerald-900/30 group-hover:bg-emerald-900/40" : "group-hover:bg-surface-hover";
            return (
              <div
                key={row.key}
                data-row-case-id={c.id}
                className={`contents group ${c.id === highlightCaseId ? "row-highlight" : ""}`}
              >
                <div className={`flex items-center justify-center border-r border-border px-3 py-2.5 text-center text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  {formatOrderDate(o.placedAt)}
                </div>
                <div className={`flex min-w-0 items-center justify-center gap-1 border-r border-border px-3 py-2.5 transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  <span
                    className={`min-w-0 flex-1 truncate text-center text-[11px] font-semibold ${c.clientLink ? "text-blue-400" : "text-text"}`}
                    title={row.name || undefined}
                  >
                    {row.name || "—"}
                  </span>
                  <ClientLinkButton
                    link={c.clientLink}
                    editable={canEditClientLink}
                    onCommitLink={(link) => updateClientLink(c.id, link)}
                  />
                </div>
                <div className={`flex flex-col items-center justify-center gap-0.5 border-r border-border px-3 py-2.5 text-center text-[11px] font-semibold text-text transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  <span>{c.phone || <span className="font-normal text-text-faint">—</span>}</span>
                  {c.phone2 && <span>{c.phone2}</span>}
                </div>
                <div className={`flex items-center justify-center border-r border-border px-3 py-2.5 text-center text-[11px] font-semibold text-text transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  {row.ssn ? formatSsn(row.ssn) : <span className="font-normal text-text-faint">—</span>}
                </div>
                {showFormatNameCol && (
                  <div className={`flex items-center justify-center border-r border-border px-3 py-2.5 text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                    <span className="whitespace-normal break-words text-center">{row.formatName || "—"}</span>
                  </div>
                )}
                {showAddressCol && (
                  <div className={`flex min-w-0 items-center justify-center border-r border-border px-3 py-2.5 text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                    <span className="whitespace-normal break-words text-center">{c.address || "—"}</span>
                  </div>
                )}
                <div className={`flex min-w-0 items-center justify-center border-r border-border px-3 py-2.5 text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  <span className="truncate text-center" title={users.find((u) => u.id === o.placedBy)?.name}>
                    {users.find((u) => u.id === o.placedBy)?.name ?? "—"}
                  </span>
                </div>
                <div className={`flex min-w-0 items-center justify-center border-r border-border transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  <DateCell
                    value={o.milestoneDate}
                    editable={canEditOrderStatus}
                    onCommit={(v) => updateOrderMilestoneDate(c.id, o.id, v)}
                  />
                </div>
                <div className={`flex items-center justify-center border-r border-border px-3 py-2.5 text-center text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  {formatOrderDate(o.statusUpdatedAt)}
                </div>
                {showDescriptionCol && (
                  <div className={`flex min-w-0 items-center justify-center border-r border-border px-3 py-2.5 text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                    <span className="whitespace-normal break-words text-center" title={o.description ?? undefined}>
                      {o.description || "—"}
                    </span>
                  </div>
                )}
                {showOrder8821Col && (
                  <div className={`flex min-w-0 items-center justify-center border-r border-border px-1 py-1.5 transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                    <OrderPlaceButton
                      label={t("order8821.button")}
                      placedLabel={t("order8821.placed")}
                      disabled={!canPlaceOrder}
                      onConfirm={async () => {
                        // Dòng này đã ứng với ĐÚNG 1 client cụ thể (row.slot, xác định qua
                        // SSN của order TTS & WIT) — không cần popup chọn lại, chỉ hỏi xác
                        // nhận thẳng theo tên client đó.
                        if (hasWaitingOrderForSsn(cases, "order8821", [row.ssn])) {
                          await alertWarn(t("order8821.oldNotDoneWarning"), { title: t("cases.placeOrderTitle") });
                          return false;
                        }
                        const missing = missingOrderClientFields(c, [row.slot]);
                        if (missing.length > 0) {
                          await alertWarn(
                            `${t("cases.missingFieldsBody", { label: `Order 8821 (${row.name || "—"})` })}\n${missing.map((m) => `• ${m}`).join("\n")}`,
                            { title: t("cases.missingFieldsTitle") }
                          );
                          return false;
                        }
                        if (await confirm(t("order8821.confirmForClient", { name: row.name || "—" }), { title: t("cases.placeOrderTitle") })) {
                          placeOrder(c.id, "order8821", user.id, [row.slot]);
                          return true;
                        }
                        return false;
                      }}
                    />
                  </div>
                )}
                <div
                  className={`flex min-w-0 items-center justify-center border-r border-border transition ${cellBg} ${isLast ? "" : "border-b"}`}
                  title={canEditOrderStatus && !o.assignedSupport ? t("orders.statusLockedNoAssignee") : undefined}
                >
                  <EditableCell
                    value={o.status}
                    type="select"
                    options={orderStatusColumn?.options}
                    editable={canEditOrderStatus && Boolean(o.assignedSupport)}
                    onCommit={(v) => updateOrderStatus(c.id, o.id, v as string | null)}
                  />
                </div>
                <div className={`flex min-w-0 items-center justify-center border-r border-border px-1 py-1.5 transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  <AssignMenu
                    users={supportUsers}
                    assignedTo={o.assignedSupport}
                    canAssign={canAssignSupport}
                    onAssign={(uid) => assignOrderSupport(c.id, o.id, uid)}
                  />
                </div>
                <div className={`flex items-center justify-center px-2 py-2.5 transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  <button
                    onClick={async () => {
                      if (
                        await confirm(t("orders.deleteRowConfirm", { name: row.name || "—", tab: TAB_LABEL[tab] }), {
                          title: t("orders.deleteRowTitle"),
                          tone: "danger",
                        })
                      ) {
                        deleteOrder(c.id, o.id);
                      }
                    }}
                    className="rounded p-1 text-text-faint opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                    title={t("orders.deleteRow")}
                    aria-label={t("orders.deleteRow")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}

          {rows.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-text-faint" style={{ gridColumn: "1 / -1" }}>
              {t("orders.emptyState", { tab: TAB_LABEL[tab], sub: t(subTab === "done" ? "orders.sub.done" : "orders.sub.waiting") })}
            </div>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
