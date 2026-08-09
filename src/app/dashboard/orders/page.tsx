"use client";

import { useMemo, useState } from "react";
import { ShieldAlert, Trash2 } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { canEditColumn, hasFeature } from "@/lib/rbac";
import { CaseRecord, OrderRecord, OrderType } from "@/lib/types";
import { getClientEntries, formatLastFirst } from "@/lib/client-name";
import { formatSsn } from "@/lib/ssn";
import { ClientLinkButton } from "@/components/client-link-button";
import { AssignMenu } from "@/components/assign-menu";
import { EditableCell } from "@/components/editable-cell";
import { ColumnSettingsDialog } from "@/components/column-settings-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { useT, useLanguage, translateColumnLabel } from "@/lib/i18n";

const TAB_LABEL: Record<OrderType, string> = {
  order8821: "Order 8821",
  orderTtsWit: "Order TTS & WIT",
};

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

export default function OrdersPage() {
  const user = useCurrentUser();
  const cases = useAppStore((s) => s.cases);
  const columns = useAppStore((s) => s.columns);
  const users = useAppStore((s) => s.users);
  const permissions = useAppStore((s) => s.featurePermissions);
  const updateClientLink = useAppStore((s) => s.updateClientLink);
  const deleteOrder = useAppStore((s) => s.deleteOrder);
  const updateOrderStatus = useAppStore((s) => s.updateOrderStatus);
  const assignOrderSupport = useAppStore((s) => s.assignOrderSupport);
  const renameColumn = useAppStore((s) => s.renameColumn);
  const setColumnEditableBy = useAppStore((s) => s.setColumnEditableBy);
  const addColumnOption = useAppStore((s) => s.addColumnOption);
  const updateColumnOption = useAppStore((s) => s.updateColumnOption);
  const removeColumnOption = useAppStore((s) => s.removeColumnOption);
  const removeColumn = useAppStore((s) => s.removeColumn);
  const [tab, setTab] = useState<OrderType>("order8821");
  const [subTab, setSubTab] = useState<SubTab>("waiting");
  const clientColumn = columns.find((c) => c.id === "clientName");
  const orderStatusColumn = columns.find((c) => c.id === "orderStatus");
  const supportUsers = users.filter((u) => u.role === "support");
  const { confirm, ConfirmDialogUI } = useConfirm();
  const t = useT();
  const { language } = useLanguage();

  // Support xem được TẤT CẢ order của mọi tài khoản; các vai trò khác (Agent,
  // Processor...) chỉ xem order do CHÍNH họ bấm đặt.
  const isSupport = user?.role === "support";

  // Order 8821 và Order TTS & WIT là 2 danh sách HOÀN TOÀN TÁCH BIỆT (lọc theo
  // order.type) — mỗi lần đặt (kể cả đặt lại) là 1 bản ghi order MỚI, giữ nguyên toàn
  // bộ order cũ trong lịch sử (không ghi đè), nên tab Order hiển thị đủ mọi lần order
  // dưới dạng nhiều row riêng biệt.
  const matchedOrders = useMemo(() => {
    if (!user) return [];
    const list: { case: CaseRecord; order: OrderRecord }[] = [];
    for (const c of cases) {
      for (const o of c.orders) {
        if (o.type !== tab) continue;
        if (!isSupport && o.placedBy !== user.id) continue;
        const isDone = o.status === "done";
        if (subTab === "done" ? !isDone : isDone) continue;
        list.push({ case: c, order: o });
      }
    }
    list.sort((a, b) => new Date(a.order.placedAt).getTime() - new Date(b.order.placedAt).getTime());
    return list;
  }, [cases, tab, subTab, isSupport, user]);

  // Hồ sơ có 2 client (Client Name điền đủ 2 dòng) tính là 2 người — tách thành 2
  // dòng riêng trong bảng Order, mỗi dòng lấy đúng SSN theo client đó, còn Phone/
  // Address/ngày đặt/tài khoản đặt vẫn dùng chung dữ liệu của hồ sơ gốc.
  const rows = useMemo(() => {
    return matchedOrders.flatMap(({ case: c, order }) =>
      getClientEntries(c).map((e) => ({
        key: `${order.id}-${e.slot}`,
        case: c,
        order,
        name: e.name,
        formatName: formatLastFirst(e.entry),
        ssn: c.ssn[e.slot],
      }))
    );
  }, [matchedOrders]);

  // Đếm chính xác theo số DÒNG thực tế sẽ hiển thị trong bảng (giống cách tính `rows`
  // ở trên) — 1 hồ sơ có đủ 2 Client Name tính là 2 dòng, chứ không chỉ đếm số bản ghi
  // order, để badge Waiting/Done luôn khớp với số hàng người dùng nhìn thấy.
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
        counts[o.type][s] += getClientEntries(c).length;
      }
    }
    return counts;
  }, [cases, isSupport, user]);

  function changeTab(next: OrderType) {
    setTab(next);
    setSubTab("waiting");
  }

  if (!user) return null;

  if (user.role !== "agent" && user.role !== "processor" && user.role !== "support") {
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

  return (
    <div className="px-4 py-6 sm:px-6">
      {ConfirmDialogUI}
      <h1 className="text-lg font-semibold tracking-tight">Order</h1>
      <p className="mt-0.5 text-xs text-text-faint">
        {isSupport ? t("orders.supportOnlyDesc") : t("orders.selfOnlyDesc")}
      </p>

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
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/15 text-amber-300"
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

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <div
          className="grid min-w-[1480px] text-sm"
          style={{
            gridTemplateColumns: "150px minmax(200px,1fr) 120px 120px 140px 180px 120px 150px 120px 130px 44px",
          }}
        >
          <div className="flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white">
            {t("orders.col.placedAt")}
          </div>
          <div className="flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white">
            {t("orders.col.clientName")}
          </div>
          <div className="flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white">
            {t("orders.col.phone")}
          </div>
          <div className="flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white">
            {t("orders.col.ssn")}
          </div>
          <div className="flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white">
            {t("orders.col.formatName")}
          </div>
          <div className="flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white">
            {t("orders.col.address")}
          </div>
          <div className="flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white">
            {t("orders.col.account")}
          </div>
          <div className="flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white">
            {t("orders.col.statusUpdatedAt")}
          </div>
          <div className="group/head flex items-center justify-center gap-1 border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-2 py-2.5 text-[10px] font-semibold uppercase tracking-normal text-white">
            <span className="min-w-0 flex-1 truncate text-center">
              {orderStatusColumn ? translateColumnLabel(language, orderStatusColumn.id, orderStatusColumn.label) : t("col.header.orderStatus")}
            </span>
            {(canEditColumnFeature || canEditOrderStatus) && orderStatusColumn && (
              <ColumnSettingsDialog
                column={orderStatusColumn}
                canManageFully={canEditColumnFeature}
                onRename={(label) => renameColumn(orderStatusColumn.id, label)}
                onSetEditableBy={(roles) => setColumnEditableBy(orderStatusColumn.id, roles)}
                onAddOption={(option) => addColumnOption(orderStatusColumn.id, option)}
                onUpdateOption={(optionId, patch) => updateColumnOption(orderStatusColumn.id, optionId, patch)}
                onRemoveOption={(optionId) => removeColumnOption(orderStatusColumn.id, optionId)}
                onDelete={() => removeColumn(orderStatusColumn.id)}
              />
            )}
          </div>
          <div className="flex items-center justify-center whitespace-nowrap border-b-2 border-r border-border border-b-accent/70 bg-bg-elevated px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-normal text-white">
            {t("orders.col.assign")}
          </div>
          <div className="border-b-2 border-b-accent/70 bg-bg-elevated px-2 py-2.5" />

          {rows.map((row, i) => {
            const c: CaseRecord = row.case;
            const o: OrderRecord = row.order;
            const isLast = i === rows.length - 1;
            // Order Status = "Done" tô nền cả row màu xanh lá đậm để dễ nhận biết đã
            // hoàn tất, không còn dùng màu hover mặc định (xám) như các row đang xử lý.
            const isDone = o.status === "done";
            const cellBg = isDone ? "bg-emerald-900/30 group-hover:bg-emerald-900/40" : "group-hover:bg-surface-hover";
            return (
              <div key={row.key} className="contents group">
                <div className={`flex items-center justify-center border-r border-border px-3 py-2.5 text-center text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  {formatOrderDate(o.placedAt)}
                </div>
                <div className={`flex min-w-0 items-center justify-center gap-1 border-r border-border px-3 py-2.5 transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  <span className="min-w-0 flex-1 truncate text-center text-xs font-medium" title={row.name || undefined}>
                    {row.name || "—"}
                  </span>
                  <ClientLinkButton
                    link={c.clientLink}
                    visible={canEditClientLink}
                    editable={canEditClientLink}
                    onCommitLink={(link) => updateClientLink(c.id, link)}
                  />
                </div>
                <div className={`flex items-center justify-center border-r border-border px-3 py-2.5 text-center text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  {c.phone || "—"}
                </div>
                <div className={`flex items-center justify-center border-r border-border px-3 py-2.5 text-center text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  {row.ssn ? formatSsn(row.ssn) : "—"}
                </div>
                <div className={`flex min-w-0 items-center justify-center border-r border-border px-3 py-2.5 text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  <span className="truncate text-center" title={row.formatName || undefined}>{row.formatName || "—"}</span>
                </div>
                <div className={`flex min-w-0 items-center justify-center border-r border-border px-3 py-2.5 text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  <span className="truncate text-center" title={c.address || undefined}>{c.address || "—"}</span>
                </div>
                <div className={`flex min-w-0 items-center justify-center border-r border-border px-3 py-2.5 text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  <span className="truncate text-center" title={users.find((u) => u.id === o.placedBy)?.name}>
                    {users.find((u) => u.id === o.placedBy)?.name ?? "—"}
                  </span>
                </div>
                <div className={`flex items-center justify-center border-r border-border px-3 py-2.5 text-center text-xs text-text-dim transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  {formatOrderDate(o.statusUpdatedAt)}
                </div>
                <div className={`flex min-w-0 items-center justify-center border-r border-border transition ${cellBg} ${isLast ? "" : "border-b"}`}>
                  <EditableCell
                    value={o.status}
                    type="select"
                    options={orderStatusColumn?.options}
                    editable={canEditOrderStatus}
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
    </div>
  );
}
