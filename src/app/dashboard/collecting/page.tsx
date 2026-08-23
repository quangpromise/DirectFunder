"use client";

import { useState } from "react";
import { Plus, Trash2, GripVertical, Coins, ShieldAlert } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { canEditColumn, hasFeature } from "@/lib/rbac";
import { CollectingRecord, ColumnDef } from "@/lib/types";
import { EditableCell } from "@/components/editable-cell";
import { AddColumnDialog } from "@/components/add-column-dialog";
import { ColumnSettingsDialog } from "@/components/column-settings-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n";

const GRIP_COL_WIDTH = 26;
const ACTIONS_COL_WIDTH = 44;

/**
 * Bảng "Collecting" — dựng cùng kiểu grid CSS + sticky header/freeze cột đầu như bảng Hồ
 * sơ (src/app/dashboard/cases/page.tsx) để giữ đúng "look & feel", nhưng đơn giản hơn
 * NHIỀU: không có tab lọc/assign/order/SSN/refund status... (chưa có yêu cầu cụ thể cho
 * tab này — "tính năng sẽ thông báo sau", 2026-08-12). Mọi cột đều generic (lưu trong
 * CollectingRecord.custom), nên không cần nhánh switch theo col.id như RowCells của Cases
 * — 1 component EditableCell dùng chung cho toàn bộ ô.
 */
export default function CollectingPage() {
  const user = useCurrentUser();
  const rows = useAppStore((s) => s.collectingRecords);
  const columns = useAppStore((s) => s.collectingColumns);
  const featurePermissions = useAppStore((s) => s.featurePermissions);
  const updateCollectingCell = useAppStore((s) => s.updateCollectingCell);
  const addCollectingRow = useAppStore((s) => s.addCollectingRow);
  const deleteCollectingRow = useAppStore((s) => s.deleteCollectingRow);
  const reorderCollectingRow = useAppStore((s) => s.reorderCollectingRow);
  const addCollectingColumn = useAppStore((s) => s.addCollectingColumn);
  const removeCollectingColumn = useAppStore((s) => s.removeCollectingColumn);
  const renameCollectingColumn = useAppStore((s) => s.renameCollectingColumn);
  const setCollectingColumnEditableBy = useAppStore((s) => s.setCollectingColumnEditableBy);
  const setCollectingColumnHiddenFromGrid = useAppStore((s) => s.setCollectingColumnHiddenFromGrid);
  const addCollectingColumnOption = useAppStore((s) => s.addCollectingColumnOption);
  const updateCollectingColumnOption = useAppStore((s) => s.updateCollectingColumnOption);
  const removeCollectingColumnOption = useAppStore((s) => s.removeCollectingColumnOption);
  const reorderCollectingColumn = useAppStore((s) => s.reorderCollectingColumn);
  const { confirm, ConfirmDialogUI } = useConfirm();
  const t = useT();

  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);

  if (!user) return null;

  // Xem tab này giờ cấu hình được qua trang Phân quyền (viewCollecting, 2026-08-13) — trước
  // đây chỉ ẩn khỏi nav (top-nav.tsx roles hard-code), route vẫn truy cập trực tiếp được nếu
  // biết URL. Chặn thẳng ở đây để đúng nghĩa "phân quyền xem", không chỉ ẩn UI.
  if (!hasFeature(featurePermissions, "viewCollecting", user.role)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <ShieldAlert size={28} className="text-text-faint" />
        <p className="text-sm text-text-dim">{t("users.accessDenied")}</p>
      </div>
    );
  }

  const canAddColumnFeature = hasFeature(featurePermissions, "addCollectingColumn", user.role);
  const canEditColumnFeature = hasFeature(featurePermissions, "editCollectingColumn", user.role);
  const canAddRowFeature = hasFeature(featurePermissions, "addCollectingRow", user.role);
  const canDeleteRowFeature = hasFeature(featurePermissions, "deleteCollectingRow", user.role);

  const [firstColumn, ...restColumns] = columns;
  const otherColumns = restColumns.filter((col) => !col.hiddenFromGrid);
  const FIRST_COL_LEFT = GRIP_COL_WIDTH;
  const FIRST_COL_WIDTH = firstColumn?.width ?? 120;

  const gridTemplateColumns = [
    `${GRIP_COL_WIDTH}px`,
    ...(firstColumn ? [`${FIRST_COL_WIDTH}px`] : []),
    ...otherColumns.map((col) => `${col.width}px`),
    `${ACTIONS_COL_WIDTH}px`,
  ].join(" ");

  function renderColumnHeader(col: ColumnDef, opts: { sticky?: number; draggable?: boolean; hideable?: boolean }) {
    return (
      <div
        key={col.id}
        draggable={opts.draggable && canEditColumnFeature}
        onDragStart={() => opts.draggable && setDragColId(col.id)}
        onDragOver={(e) => opts.draggable && canEditColumnFeature && e.preventDefault()}
        onDrop={(e) => {
          if (!opts.draggable) return;
          e.preventDefault();
          if (canEditColumnFeature && dragColId && dragColId !== col.id) reorderCollectingColumn(dragColId, col.id);
          setDragColId(null);
        }}
        onDragEnd={() => opts.draggable && setDragColId(null)}
        className={`group/head sticky top-0 z-20 flex items-center justify-center gap-1 border-b border-r border-border-strong bg-table-head-bg px-2 py-2.5 text-[10px] font-semibold uppercase tracking-normal text-table-head-text ${
          opts.draggable && canEditColumnFeature ? "cursor-grab" : ""
        } ${dragColId === col.id ? "opacity-40" : ""}`}
        style={{ left: opts.sticky, gridRow: "1", zIndex: opts.sticky !== undefined ? 30 : 20 }}
      >
        {opts.draggable && canEditColumnFeature && <GripVertical size={12} className="shrink-0 text-table-head-text/70" />}
        <span className="min-w-0 flex-1 truncate text-center">{col.label}</span>
        {canEditColumnFeature && (
          <ColumnSettingsDialog
            column={col}
            onRename={(label) => renameCollectingColumn(col.id, label)}
            onSetEditableBy={(roles) => setCollectingColumnEditableBy(col.id, roles)}
            onSetHidden={opts.hideable === false ? undefined : (hidden) => setCollectingColumnHiddenFromGrid(col.id, hidden)}
            onAddOption={(option) => addCollectingColumnOption(col.id, option)}
            onUpdateOption={(optionId, patch) => updateCollectingColumnOption(col.id, optionId, patch)}
            onRemoveOption={(optionId) => removeCollectingColumnOption(col.id, optionId)}
            onDelete={() => removeCollectingColumn(col.id)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {ConfirmDialogUI}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <Coins size={18} className="text-accent" />
          <h1 className="text-lg font-semibold text-text">{t("nav.collecting")}</h1>
        </div>
        <div className="flex items-center gap-2">
          {canAddColumnFeature && <AddColumnDialog onAdd={addCollectingColumn} />}
          {canAddRowFeature && (
            <button
              onClick={() => addCollectingRow()}
              className="gradient-btn flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium text-white shadow-lg shadow-blue-950/30"
            >
              <Plus size={14} />
              {t("common.addRow")}
            </button>
          )}
        </div>
      </div>

      {/* Bo góc + viền cho cả khối bảng (thêm 2026-08-24, làm mới layout kiểu Apple) — đồng
          bộ với bảng Hồ sơ/Orders/CPA Review. */}
      <div className="flex-1 overflow-auto rounded-xl border border-border-strong">
        <div className="grid text-sm" style={{ gridTemplateColumns }}>
          {/* Header row */}
          <div
            className="sticky top-0 z-30 border-b border-r border-border-strong bg-table-head-bg"
            style={{ left: 0, gridRow: "1" }}
          />
          {firstColumn && renderColumnHeader(firstColumn, { sticky: FIRST_COL_LEFT, hideable: false })}
          {otherColumns.map((col) => renderColumnHeader(col, { draggable: true }))}
          <div className="sticky top-0 z-20 border-b bg-table-head-bg" style={{ gridRow: "1" }} />

          {/* Body rows */}
          {rows.length === 0 && (
            <div
              className="col-span-full flex items-center justify-center px-4 py-10 text-sm text-text-faint"
              style={{ gridColumn: `1 / -1` }}
            >
              {t("collecting.empty")}
            </div>
          )}
          {rows.map((row) => (
            <CollectingRow
              key={row.id}
              row={row}
              firstColumn={firstColumn}
              otherColumns={otherColumns}
              firstColLeft={FIRST_COL_LEFT}
              userRole={user.role}
              canDeleteRowFeature={canDeleteRowFeature}
              dragRowId={dragRowId}
              onRowDragStart={() => setDragRowId(row.id)}
              onRowDrop={() => {
                if (dragRowId && dragRowId !== row.id) reorderCollectingRow(dragRowId, row.id);
                setDragRowId(null);
              }}
              onRowDragEnd={() => setDragRowId(null)}
              onCommitCell={(key, value) => updateCollectingCell(row.id, key, value)}
              onDelete={async () => {
                if (await confirm(t("collecting.deleteRowConfirm"), { title: t("collecting.deleteRowTitle"), tone: "danger" })) {
                  deleteCollectingRow(row.id);
                }
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CollectingRow({
  row,
  firstColumn,
  otherColumns,
  firstColLeft,
  userRole,
  canDeleteRowFeature,
  dragRowId,
  onRowDragStart,
  onRowDrop,
  onRowDragEnd,
  onCommitCell,
  onDelete,
}: {
  row: CollectingRecord;
  firstColumn: ColumnDef | undefined;
  otherColumns: ColumnDef[];
  firstColLeft: number;
  userRole: Parameters<typeof canEditColumn>[0];
  canDeleteRowFeature: boolean;
  dragRowId: string | null;
  onRowDragStart: () => void;
  onRowDrop: () => void;
  onRowDragEnd: () => void;
  onCommitCell: (key: string, value: string | number | boolean | null) => void;
  onDelete: () => void;
}) {
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
        <GripVertical size={12} />
      </div>
      {firstColumn && (
        <div
          className="sticky z-10 border-b border-r border-border bg-bg transition-colors group-hover:bg-surface-hover"
          style={{ left: firstColLeft }}
        >
          <EditableCell
            value={row.custom[firstColumn.key] ?? null}
            type={firstColumn.type}
            options={firstColumn.options}
            editable={canEditColumn(userRole, firstColumn)}
            onCommit={(v) => onCommitCell(firstColumn.key, v)}
          />
        </div>
      )}
      {otherColumns.map((col) => (
        <div key={col.id} className="border-b border-r border-border transition-colors group-hover:bg-surface-hover">
          <EditableCell
            value={row.custom[col.key] ?? null}
            type={col.type}
            options={col.options}
            editable={canEditColumn(userRole, col)}
            onCommit={(v) => onCommitCell(col.key, v)}
          />
        </div>
      ))}
      <div className="flex items-center justify-center border-b border-border">
        {canDeleteRowFeature && (
          <button
            onClick={onDelete}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition hover:bg-red-500/15 hover:text-red-400"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
