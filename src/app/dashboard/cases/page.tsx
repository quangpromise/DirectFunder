"use client";

import { useMemo, useState } from "react";
import { Search, Plus, Trash2, FileText, DollarSign, GripVertical, ShieldAlert } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { canEditColumn, canViewCase, hasFeature } from "@/lib/rbac";
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
import { isDuplicateSsn } from "@/lib/ssn";
import { getFullName } from "@/lib/client-name";
import { hasActiveOrder } from "@/lib/orders";
import { useT, useLanguage, translateColumnLabel, translateOptionLabel } from "@/lib/i18n";

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
    active: "border-red-500/40 bg-red-500/15 text-red-300",
    inactive: "border-transparent text-red-400/70 hover:bg-red-500/10 hover:text-red-300",
    badgeActive: "bg-red-500/20 text-red-300",
    badgeInactive: "bg-red-500/10 text-red-400/70",
  },
  active: {
    active: "border-amber-500/40 bg-amber-500/15 text-amber-300",
    inactive: "border-transparent text-amber-400/70 hover:bg-amber-500/10 hover:text-amber-300",
    badgeActive: "bg-amber-500/20 text-amber-300",
    badgeInactive: "bg-amber-500/10 text-amber-400/70",
  },
  done: {
    active: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    inactive: "border-transparent text-emerald-400/70 hover:bg-emerald-500/10 hover:text-emerald-300",
    badgeActive: "bg-emerald-500/20 text-emerald-300",
    badgeInactive: "bg-emerald-500/10 text-emerald-400/70",
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

export default function CasesPage() {
  const user = useCurrentUser();
  const cases = useAppStore((s) => s.cases);
  const columns = useAppStore((s) => s.columns);
  const users = useAppStore((s) => s.users);
  const permissions = useAppStore((s) => s.featurePermissions);
  const updateCell = useAppStore((s) => s.updateCell);
  const placeOrder = useAppStore((s) => s.placeOrder);
  const addRow = useAppStore((s) => s.addRow);
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
  const [tab, setTab] = useState<CaseTab>("all");
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const { confirm, ConfirmDialogUI } = useConfirm();
  const { alertWarn, AlertDialogUI } = useAlert();
  const t = useT();
  const { language } = useLanguage();

  const statusColumn = columns.find((c) => c.id === "status");
  const clientColumn = columns.find((c) => c.id === "clientName");
  const statusOptions = statusColumn?.options ?? [];
  const STATUS_COL_WIDTH = statusColumn?.width ?? 112;
  const STATUS_LEFT = GRIP_COL_WIDTH;
  const CLIENT_LEFT = STATUS_LEFT + STATUS_COL_WIDTH;

  // Agent chỉ thấy hồ sơ được gán cho mình ở cột Agent; Processor tương tự ở cột Processor.
  const visibleCases = useMemo(() => {
    if (!user) return [];
    return cases.filter((c) => canViewCase(user.role, user.id, c));
  }, [cases, user]);

  const filtered = useMemo(() => {
    return visibleCases.filter((c) => {
      if (tab !== "all" && getCaseTab(c.status) !== tab) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        getFullName(c).toLowerCase().includes(q) ||
        c.caseNumber.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.zipcode.includes(q) ||
        c.description.toLowerCase().includes(q)
      );
    });
  }, [visibleCases, search, statusFilter, tab]);

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
    (col) => col.key !== "clientName" && col.id !== "status" && col.id !== "orderStatus"
  );
  // Giao việc cột Agent chỉ hiện danh sách tài khoản nhóm Agent, cột Processor chỉ
  // hiện nhóm Processor — không lẫn các vai trò khác vào danh sách chọn.
  const agentUsers = users.filter((u) => u.role === "agent");
  const processorUsers = users.filter((u) => u.role === "processor");
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
        {CASE_TABS.map((ct) => {
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
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-base font-semibold tracking-tight sm:text-lg">
            {t("cases.greeting")} {user.name.split(" ").slice(-1)[0]} · {t("cases.title")}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatChip label={t("common.total")} value={String(stats.total)} icon={FileText} />
          {statusOptions.map((o) => (
            <StatusStatChip key={o.id} option={o} value={stats.byStatus[o.id] ?? 0} />
          ))}
          <StatChip label={t("common.value")} value={`$${stats.totalMoney.toLocaleString("en-US")}`} icon={DollarSign} />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
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
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="all">{t("common.allStatus")}</option>
            {tabStatusOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {translateOptionLabel(language, o.id, o.label)}
              </option>
            ))}
          </select>

          {canAddColumnFeature && <AddColumnDialog onAdd={addColumn} />}
          <HistoryDialog editHistory={editHistory} deletionHistory={deletionHistory} users={users} />

          {canAddRowFeature && (
            <button
              onClick={async () => {
                if (await confirm(t("cases.addRowConfirm"), { title: t("cases.addRowTitle") })) {
                  addRow(user.id, user.role);
                }
              }}
              className="gradient-btn flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium text-white shadow-lg shadow-orange-950/30"
            >
              <Plus size={14} />
              {t("common.addRow")}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="grid text-sm" style={{ gridTemplateColumns }}>
          {/* Header row */}
          <div
            className="sticky top-0 z-30 border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated"
            style={{ left: 0, gridRow: "1" }}
          />
          <div
            className="group/head sticky top-0 z-30 flex items-center justify-center gap-1 border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-2 py-2.5 text-[10px] font-semibold uppercase tracking-normal text-white"
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
            className="sticky top-0 z-30 flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white"
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
              className={`group/head sticky top-0 z-20 flex items-center justify-center gap-1 border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-2 py-2.5 text-[10px] font-semibold uppercase tracking-normal text-white ${
                canEditColumnFeature ? "cursor-grab" : ""
              } ${dragColId === col.id ? "opacity-40" : ""}`}
              style={{ gridRow: "1" }}
            >
              {canEditColumnFeature && <GripVertical size={12} className="shrink-0 text-white/70" />}
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
            className="sticky top-0 z-20 flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white"
            style={{ gridRow: "1" }}
          >
            {t("col.header.agent")}
          </div>
          <div
            className="sticky top-0 z-20 flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white"
            style={{ gridRow: "1" }}
          >
            {t("col.header.processor")}
          </div>
          <div className="sticky top-0 z-20 border-b-2 border-b-accent/70 bg-bg-elevated" style={{ gridRow: "1" }} />

          {/* Body rows */}
          {filtered.map((row) => (
            <RowCells
              key={row.id}
              row={row}
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
    </div>
  );
}

function RowCells({
  row,
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
  placeOrder: (caseId: string, field: "order8821" | "orderTtsWit", byUserId: string) => void;
  deleteRow: (caseId: string, deletedByUserId: string) => void;
  assignCase: (caseId: string, toUserId: string, field: "assignedTo" | "assignedProcessor") => void;
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
  return (
    <div className={`group contents ${dragRowId === row.id ? "opacity-40" : ""}`}>
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
            editable={canEditColumn(user.role, statusColumn)}
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
          editable={canEditColumn(user.role, clientColDef)}
          onCommitName={(slot, field, v) => updateClientName(row.id, slot, field, v)}
          onCommitLink={(link) => updateClientLink(row.id, link)}
        />
      </div>
      {otherColumns.map((col) =>
        col.id === "ssn" ? (
          <div key={col.id} className="border-b border-r border-border transition-colors group-hover:bg-surface-hover">
            <SsnCell
              value={row.ssn}
              editable={ssnColDef ? canEditColumn(user.role, ssnColDef) : false}
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
              editable={canEditColumn(user.role, col)}
              onReply={(text) => addDescriptionReply(row.id, user.id, text)}
              onMarkRead={() => markDescriptionRead(row.id, user.id)}
            />
          </div>
        ) : col.id === "order" ? (
          <div key={col.id} className="border-b border-r border-border transition-colors group-hover:bg-surface-hover">
            <OrderCell
              order8821Active={hasActiveOrder(row.orders, "order8821")}
              orderTtsWitActive={hasActiveOrder(row.orders, "orderTtsWit")}
              editable={canEditColumn(user.role, col)}
              onOrder={async (field) => {
                const label = field === "order8821" ? "Order 8821" : "Order TTS & WIT";
                const missing: string[] = [];
                if (!row.clients[0].firstName.trim()) missing.push("First Name");
                if (!row.clients[0].lastName.trim()) missing.push("Last Name");
                if (!row.phone.trim()) missing.push("Phone");
                if (!row.ssn[0]) missing.push("SSN");
                if (!row.address.trim()) missing.push("Address");
                if (missing.length > 0) {
                  await alertWarn(`${t("cases.missingFieldsBody", { label })}\n${missing.map((m) => `• ${m}`).join("\n")}`, {
                    title: t("cases.missingFieldsTitle"),
                  });
                  return;
                }
                if (await confirm(t("cases.placeOrderConfirm", { label }), { title: t("cases.placeOrderTitle") })) {
                  placeOrder(row.id, field, user.id);
                }
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
              editable={canEditColumn(user.role, col)}
              onCommit={(v) => updateCell(row.id, col.key, v, Boolean(col.custom))}
            />
          </div>
        )
      )}
      <div className="flex h-full min-w-0 items-center border-b border-r border-border transition-colors group-hover:bg-surface-hover">
        <AssignMenu
          users={agentUsers}
          assignedTo={row.assignedTo}
          canAssign={canAssignFeature}
          onAssign={(uid) => assignCase(row.id, uid, "assignedTo")}
        />
      </div>
      <div className="flex h-full min-w-0 items-center border-b border-r border-border transition-colors group-hover:bg-surface-hover">
        <AssignMenu
          users={processorUsers}
          assignedTo={row.assignedProcessor}
          canAssign={canAssignFeature}
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
