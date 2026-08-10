"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Sheet, X, GripVertical, Plus, Minus } from "lucide-react";
import { ColumnDef, DateFormat, GoogleSheetConfig } from "@/lib/types";
import { useT, useLanguage, translateColumnLabel } from "@/lib/i18n";
import { extractSheetId } from "@/lib/sheet-id";
import { BLANK_COLUMN_ID, SEND_DATE_COLUMN_ID, CPA_REVIEW_MONEY_COLUMN_ID, refundYearColumnId } from "@/lib/sheet-row-columns";
import { REFUND_YEARS } from "@/lib/refund";

/** 1 dòng trong danh sách "Đã chọn" — `key` chỉ để React/kéo-thả phân biệt từng lần
 * chọn, KHÔNG lưu xuống server; lưu là `colId` lặp lại nhiều lần trong mảng string[]
 * (GoogleSheetConfig.columnIds cho phép trùng id — xem handleSave). */
interface SelectedItem {
  key: string;
  colId: string;
}

let keySeq = 0;
function nextKey(colId: string): string {
  keySeq += 1;
  return `${colId}-${keySeq}`;
}

/**
 * Dialog Admin cấu hình Google Sheet đích + cột nào/thứ tự nào được đẩy vào dòng mới khi
 * bấm nút "Send" ở cột Status (chỉ hiện khi status = cpa_review) — đặt trên trang Phân
 * quyền cạnh CpaEmailDefaultsDialog, theo đúng khung modal đó. Danh sách cột chia 2 vùng:
 * "Đã chọn" (kéo-thả sắp thứ tự, đúng thứ tự sẽ ghi vào các ô A/B/C... của dòng mới) và
 * "Cột khác" (bấm + để thêm vào cuối danh sách đã chọn — 1 cột có thể bấm thêm NHIỀU
 * LẦN, vd để lặp lại SSN ở 2 vị trí, hoặc thêm nhiều ô "Để trống" liên tiếp).
 */
export function GoogleSheetConfigDialog({
  config,
  columns,
  onSave,
}: {
  config: GoogleSheetConfig | null;
  columns: ColumnDef[];
  onSave: (next: GoogleSheetConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sheetIdInput, setSheetIdInput] = useState("");
  const [items, setItems] = useState<SelectedItem[]>([]);
  // Mặc định "mdy2" (mm/dd/yy) — khớp mặc định server dùng khi Admin chưa từng lưu cấu
  // hình (xem route.ts), tránh trường hợp Admin bấm Lưu mà chưa đụng dropdown vẫn vô tình
  // lưu "iso" (ISO đầy đủ, khó đọc hơn cho mục đích gửi CPA Review).
  const [dateFormat, setDateFormat] = useState<DateFormat>("mdy2");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const t = useT();
  const { language } = useLanguage();

  // Cột ảo "Ngày gửi" — không tham chiếu dữ liệu hồ sơ, giá trị luôn là ngày hiện tại lúc
  // bấm Send (server tự tính, xem SEND_DATE_COLUMN_ID trong send-to-sheet/route.ts).
  // "Để trống" — chừa 1 ô trống, dùng khi thứ tự cột trên Sheet thật có khoảng cách so
  // với dữ liệu app đẩy lên. Cả 2 khai báo như ColumnDef giả để tái dùng nguyên vẹn UI
  // kéo-thả sẵn có, không cần code riêng.
  const sendDateColumn: ColumnDef = {
    id: SEND_DATE_COLUMN_ID,
    key: SEND_DATE_COLUMN_ID,
    label: t("sheetConfig.sendDateColumnLabel"),
    type: "date",
    editableBy: [],
  };
  const blankColumn: ColumnDef = {
    id: BLANK_COLUMN_ID,
    key: BLANK_COLUMN_ID,
    label: t("sheetConfig.blankColumnLabel"),
    type: "text",
    editableBy: [],
  };
  // 4 cột ảo theo từng năm refund ("2022".."2025") — lấy đúng 1 năm trong row.refunds
  // (object nhiều năm, không có ColumnDef phẳng riêng cho từng năm — xem refund.ts),
  // nhãn hiển thị luôn là chính năm đó, không cần dịch đa ngôn ngữ.
  const refundYearColumns: ColumnDef[] = REFUND_YEARS.map((year) => ({
    id: refundYearColumnId(year),
    key: refundYearColumnId(year),
    label: year,
    type: "currency",
    editableBy: [],
  }));
  // Cột ảo "Số tiền CPA Review" — KHÁC 4 cột năm cố định ở trên: giá trị không cố định
  // theo năm nào, mà lấy theo năm người dùng CHỌN NGAY LÚC BẤM SEND (popup "Bạn muốn CPA
  // Review năm nào?" ở SendToSheetButton, xem CPA_REVIEW_MONEY_COLUMN_ID).
  const cpaReviewMoneyColumn: ColumnDef = {
    id: CPA_REVIEW_MONEY_COLUMN_ID,
    key: CPA_REVIEW_MONEY_COLUMN_ID,
    label: t("sheetConfig.cpaReviewMoneyColumnLabel"),
    type: "currency",
    editableBy: [],
  };
  // 3 cột "status"/"orderStatusOrder8821"/"orderStatusOrderTtsWit" đều hiển thị nhãn
  // "Status" giống nhau (2 cột sau chỉ dùng riêng cho tab Order, không liên quan dữ liệu
  // hồ sơ chung) — ẩn cả 3 khỏi picker này để tránh nhầm lẫn khi Admin cấu hình Sheet.
  // "address"/"description"/"caseLabel"/"money"/"order" cũng ẩn khỏi picker — theo yêu
  // cầu Admin, các trường này không nên đẩy lên Sheet (caseLabel/money nay tự tính từ
  // refunds nên đã có sẵn 4 cột năm cụ thể hơn thay thế).
  const HIDDEN_COLUMN_IDS = [
    "status",
    "orderStatusOrder8821",
    "orderStatusOrderTtsWit",
    "address",
    "description",
    "caseLabel",
    "money",
    "order",
  ];
  // "dateOfBirth" là cột hidden (không hiện trong bảng Hồ sơ, chỉ dùng làm nguồn quyền cho
  // popup "Edit Hồ sơ" — xem rbac.ts) nên bị lọc bởi `!c.hidden` bên dưới; thêm lại thủ
  // công vì Admin cần đẩy DOB lên Sheet dù cột này không hiện ngoài bảng chính.
  const dobColumn = columns.find((c) => c.id === "dateOfBirth");
  const visibleColumns = [
    sendDateColumn,
    blankColumn,
    ...refundYearColumns,
    cpaReviewMoneyColumn,
    ...(dobColumn ? [dobColumn] : []),
    ...columns.filter((c) => !c.hidden && !HIDDEN_COLUMN_IDS.includes(c.id)),
  ];
  const columnById = new Map(visibleColumns.map((c) => [c.id, c]));
  // "dateOfBirth" LUÔN mm/dd/yyyy cố định (xem formatDateOfBirth trong sheet-row-columns),
  // không theo dropdown Date format này — loại khỏi điều kiện hiện dropdown để khỏi gây
  // hiểu lầm là đổi được định dạng DOB qua đây.
  const hasDateColumn = items.some((it) => {
    const col = columnById.get(it.colId);
    return col?.type === "date" && col.id !== "dateOfBirth";
  });

  function openDialog() {
    setSheetIdInput(config?.sheetId ?? "");
    setItems((config?.columnIds ?? []).filter((id) => columnById.has(id)).map((id) => ({ key: nextKey(id), colId: id })));
    setDateFormat(config?.dateFormat ?? "mdy2");
    setOpen(true);
  }

  function addColumn(colId: string) {
    setItems((prev) => [...prev, { key: nextKey(colId), colId }]);
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  function reorder(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    setItems((prev) => {
      const next = [...prev];
      const fromIdx = next.findIndex((it) => it.key === fromKey);
      const toIdx = next.findIndex((it) => it.key === toKey);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }

  function handleSave() {
    onSave({ sheetId: extractSheetId(sheetIdInput), columnIds: items.map((it) => it.colId), dateFormat });
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={openDialog}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <Sheet size={14} />
        {t("sheetConfig.triggerBtn")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-lg flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("sheetConfig.title")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5">
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("sheetConfig.sheetIdLabel")}</label>
                  <input
                    value={sheetIdInput}
                    onChange={(e) => setSheetIdInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("sheetConfig.selectedLabel")}</label>
                  <div className="flex flex-col gap-1 rounded-lg border border-border bg-bg-elevated p-1.5">
                    {items.length === 0 && (
                      <p className="px-2 py-1.5 text-xs text-text-faint">{t("sheetConfig.emptySelected")}</p>
                    )}
                    {items.map((it) => {
                      const col = columnById.get(it.colId);
                      if (!col) return null;
                      return (
                        <div
                          key={it.key}
                          draggable
                          onDragStart={() => setDragKey(it.key)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragKey) reorder(dragKey, it.key);
                            setDragKey(null);
                          }}
                          onDragEnd={() => setDragKey(null)}
                          className="flex cursor-grab items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-sm active:cursor-grabbing"
                        >
                          <GripVertical size={13} className="shrink-0 text-text-faint" />
                          <span className="min-w-0 flex-1 truncate">
                            {col.id === BLANK_COLUMN_ID ? (
                              <span className="italic text-text-faint">{translateColumnLabel(language, col.id, col.label)}</span>
                            ) : (
                              translateColumnLabel(language, col.id, col.label)
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeItem(it.key)}
                            className="shrink-0 rounded p-0.5 text-text-faint hover:bg-surface-hover hover:text-red-400"
                            aria-label={t("sheetConfig.removeColumn")}
                          >
                            <Minus size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {hasDateColumn && (
                  <div>
                    <label className="mb-1 block text-xs text-text-dim">{t("sheetConfig.dateFormatLabel")}</label>
                    <select
                      value={dateFormat}
                      onChange={(e) => setDateFormat(e.target.value as DateFormat)}
                      className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                    >
                      <option value="iso">{t("sheetConfig.dateFormatIso")}</option>
                      <option value="mdy2">{t("sheetConfig.dateFormatMdy2")}</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("sheetConfig.availableLabel")}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {visibleColumns.map((col) => (
                      <button
                        key={col.id}
                        type="button"
                        onClick={() => addColumn(col.id)}
                        className="flex items-center gap-1 rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text"
                        title={t("sheetConfig.addAgainHint")}
                      >
                        <Plus size={11} />
                        {translateColumnLabel(language, col.id, col.label)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-2 px-5 pb-5">
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover"
                >
                  {t("common.cancel")}
                </button>
                <button onClick={handleSave} className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white">
                  {t("sheetConfig.saveBtn")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
