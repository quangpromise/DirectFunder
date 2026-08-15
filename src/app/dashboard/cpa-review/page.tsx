"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldAlert, Plus, Trash2, ExternalLink, StickyNote, FileSpreadsheet, X, Filter, EyeOff } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { hasFeature } from "@/lib/rbac";
import {
  CPA_REVIEW_COLUMNS,
  CPA_REVIEW_YEARS,
  CPA_REVIEW_VISIBLE_YEARS,
  yearEfileDateKey,
  yearStatusKey,
  yearAmountKey,
  yearAdjustmentKey,
  yearNoteKey,
  caseStatusOptionsForCrmSource,
} from "@/lib/cpa-review-columns";
import { EditableCell } from "@/components/editable-cell";
import { AssignMenu } from "@/components/assign-menu";
import { useConfirm } from "@/components/confirm-dialog";
import { CpaReviewRecord } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { columnIndexToLetter as letterFor } from "@/lib/spreadsheet-letters";
import { CpaReviewStatusOptionsButton } from "@/components/cpa-review-status-options-button";
import { CpaReviewMonthPicker } from "@/components/cpa-review-month-picker";
import { CpaReviewSheetConfigDialog } from "@/components/cpa-review-sheet-config-dialog";
import { CpaReviewSyncGuideDialog } from "@/components/cpa-review-sync-guide-dialog";
import { monthKeyLabel } from "@/lib/cpa-review-month";

// Số cột LƯU TRỮ mỗi năm trong CPA_REVIEW_COLUMNS (Ngày E-file/Status/Số tiền/Điều chỉnh) —
// dùng để tính offset slice tới nhóm cột đuôi (Note/Processor/.../EL Date). Luôn tính theo
// CPA_REVIEW_YEARS (4 năm, kể cả 2022 đang ẩn) vì mảng CPA_REVIEW_COLUMNS không đổi theo
// việc ẩn/hiện UI. "Tổng" (cột Q, công thức Sheet) KHÔNG nằm trong mảng này — tính riêng
// (xem TotalCell bên dưới), nên không cộng vào con số này.
const YEAR_COLUMN_COUNT = 4;

// Danh sách cột "đuôi" cho phép ẩn/hiện cho MỌI user (thêm 2026-08-15) — chỉ gồm Note/
// Processor/Agent (không nằm trong CPA_REVIEW_COLUMNS, xử lý riêng ở UI) + các cột đuôi
// còn lại trong CPA_REVIEW_COLUMNS (CRM Source/FC Date/Processing Date/EL Date). KHÔNG gồm
// 6 cột đóng băng A-F hay khối năm — cấu trúc header colSpan/rowSpan cố định của khối năm
// (xem yearHeaderStyle) sẽ vỡ nếu cho phép ẩn từng cột con riêng lẻ.
const HIDEABLE_TAIL_COLUMNS: { key: string; label: string }[] = [
  { key: "note", label: "Note" },
  { key: "processorUserId", label: "Processor" },
  { key: "agentUserId", label: "Agent" },
  ...CPA_REVIEW_COLUMNS.slice(6 + CPA_REVIEW_YEARS.length * YEAR_COLUMN_COUNT + 1).map((c) => ({ key: c.key, label: c.label })),
];

// Freeze cột A-F + gutter khi cuộn ngang (thêm 2026-08-14, yêu cầu "khi scroll sang phải
// thì các cột này giữ nguyên") — độ rộng cố định tính "gọn" (yêu cầu "fix cho vừa column
// cho gọn"), dùng chung cho cả 3 hàng tiêu đề lẫn dữ liệu để offset trái luôn khớp nhau.
const GUTTER_WIDTH = 34;
const STICKY_COLUMN_WIDTHS: Record<string, number> = {
  intakeDate: 80,
  name: 128,
  phone: 92,
  ssn: 86,
  dob: 80,
  zipcode: 56,
};
const STICKY_COLUMN_KEYS = ["intakeDate", "name", "phone", "ssn", "dob", "zipcode"];
function stickyLeft(key: string): number {
  let left = GUTTER_WIDTH;
  for (const k of STICKY_COLUMN_KEYS) {
    if (k === key) return left;
    left += STICKY_COLUMN_WIDTHS[k];
  }
  return left;
}
// `position: sticky` trên chính <thead> KHÔNG nằm trong đặc tả CSS Tables (chỉ <td>/<th>
// mới được hỗ trợ chính thức) — trộn lẫn sticky ở <thead> với sticky-trái trên từng <th>
// con (như bản trước) gây lỗi chồng lấn/mất dính khi cuộn dọc (2026-08-14, "row 1,2 của cột
// A đến F biến mất"). Sửa triệt để: BỎ hẳn sticky ở <thead>, đóng băng dọc TỪNG Ô tiêu đề
// riêng lẻ (kể cả các cột không đóng băng ngang) với `top` = tổng chiều cao thật các hàng
// tiêu đề phía trên nó — đo bằng ref/ResizeObserver (xem HEADER_ROW_HEIGHTS/useHeaderOffsets
// trong component) thay vì đoán cứng số px, để không lệch khi đổi font-size/padding sau này.
function stickyColStyle(key: string, z: number, top?: number): React.CSSProperties {
  const width = STICKY_COLUMN_WIDTHS[key];
  return {
    position: "sticky",
    left: stickyLeft(key),
    top,
    width,
    minWidth: width,
    maxWidth: width,
    zIndex: z,
  };
}
/** Ô tiêu đề THƯỜNG (không đóng băng ngang) nhưng vẫn cần đóng băng dọc riêng — thay cho
 * việc dựa vào sticky ở <thead> (không đáng tin cậy, xem giải thích ở trên). */
function headTopStyle(top: number, z: number): React.CSSProperties {
  return { position: "sticky", top, zIndex: z };
}
function gutterHeadStyle(top: number): React.CSSProperties {
  return { position: "sticky", left: 0, top, width: GUTTER_WIDTH, minWidth: GUTTER_WIDTH, zIndex: 40 };
}
const GUTTER_STYLE_BODY: React.CSSProperties = { position: "sticky", left: 0, width: GUTTER_WIDTH, minWidth: GUTTER_WIDTH, zIndex: 10 };

// Màu nền XEN KẼ THEO VÒNG LẶP 2 màu (KHÔNG phải mỗi năm 1 màu riêng — đã sửa lại
// 2026-08-14 theo phản hồi "hightlight vòng lặp chứ ko mỗi cột mỗi màu") cho từng khối năm
// — áp cho cả 5 cột con (Ngày/Status/Số tiền/Other Refund/Tổng) lẫn 2 hàng tiêu đề của đúng
// năm đó, để nhận ra ranh giới giữa các năm khi nhìn lướt qua bảng. Độ mờ rất thấp để không
// ảnh hưởng độ đọc chữ/badge màu sẵn có bên trong (Status/Tổng...).
const YEAR_TINT_LOOP = ["bg-blue-500/[0.06]", "bg-slate-500/[0.07]"];
function yearTintFor(year: string): string {
  const idx = CPA_REVIEW_VISIBLE_YEARS.indexOf(year as (typeof CPA_REVIEW_VISIBLE_YEARS)[number]);
  return YEAR_TINT_LOOP[idx % YEAR_TINT_LOOP.length] ?? "";
}
// Bản RGBA của YEAR_TINT_LOOP, dùng riêng cho Ô TIÊU ĐỀ đóng băng dọc (KHÔNG dùng className
// bg-*/opacity như body) — vì các ô đó cần nền ĐẶC (opaque) để không lộ chữ dòng dữ liệu bên
// dưới khi cuộn dọc (bug 2026-08-14: "row 1,2 biến mất" ở mọi cột trừ A-F, do các ô tiêu đề
// đó trước đây chỉ có nền trong suốt). 2 lớp linear-gradient chồng nhau (tint rồi tới nền đặc
// --table-head-bg) mô phỏng đúng màu tint nhìn thấy trên body nhưng vẫn đặc hoàn toàn.
const YEAR_TINT_RGBA_LOOP = ["rgba(59,130,246,0.06)", "rgba(100,116,139,0.07)"];
function yearHeaderStyle(year: string, top: number, z: number): React.CSSProperties {
  const idx = CPA_REVIEW_VISIBLE_YEARS.indexOf(year as (typeof CPA_REVIEW_VISIBLE_YEARS)[number]);
  const tint = YEAR_TINT_RGBA_LOOP[idx % YEAR_TINT_RGBA_LOOP.length] ?? "transparent";
  return {
    position: "sticky",
    top,
    zIndex: z,
    backgroundImage: `linear-gradient(${tint}, ${tint}), linear-gradient(var(--table-head-bg), var(--table-head-bg))`,
  };
}

/**
 * Tab "CPA Review" (thêm 2026-08-14) — bảng ĐỘC LẬP HOÀN TOÀN với Case (yêu cầu user:
 * "đây là tab riêng biệt không liên quan gì đến màn hình hồ sơ, vui lòng không liên kết
 * bất cứ gì"). Cấu trúc cột cố định khớp đúng A-AH của Google Sheet thật đã khảo sát (xem
 * `src/lib/cpa-review-columns.ts`), dữ liệu lưu trong `CpaReviewRecord.custom`, đồng bộ 2
 * chiều qua Service Account nếu Admin đã kết nối (trang Phân quyền, xem
 * deployment-database-sync.md mục 4.22). Cùng "khung bảng" đơn giản như tab "Collecting"
 * (không freeze cột/kéo-thả), chỉ khác cột cố định thay vì admin tự thêm/xoá.
 */
export default function CpaReviewPage() {
  const user = useCurrentUser();
  const allRows = useAppStore((s) => s.cpaReviewRecords);
  const users = useAppStore((s) => s.users);
  const featurePermissions = useAppStore((s) => s.featurePermissions);
  const updateCpaReviewCell = useAppStore((s) => s.updateCpaReviewCell);
  const addCpaReviewRow = useAppStore((s) => s.addCpaReviewRow);
  const deleteCpaReviewRow = useAppStore((s) => s.deleteCpaReviewRow);
  const statusOptions = useAppStore((s) => s.cpaReviewStatusOptions);
  const hiddenColumns = useAppStore((s) => s.cpaReviewHiddenColumns);
  const toggleHiddenColumn = useAppStore((s) => s.toggleCpaReviewHiddenColumn);
  // Cột "CRM Source" LUÔN lấy options động theo đúng options hiện tại của cột "Status" trên
  // bảng Hồ sơ chính (Case) — không có danh sách riêng nào lưu ở đây (thêm 2026-08-14, yêu
  // cầu "khi nào màn hình hồ sơ có thêm trường gì thì CRM đều có thêm trường đó"). Không có
  // giá trị mặc định nào được set trước -> ô luôn trống ("—") cho tới khi người dùng tự chọn.
  const caseColumns = useAppStore((s) => s.columns);
  const crmSourceOptions = caseStatusOptionsForCrmSource(caseColumns);
  const selectedMonth = useAppStore((s) => s.cpaReviewSelectedMonth);
  const setSelectedMonth = useAppStore((s) => s.setCpaReviewSelectedMonth);
  const sheetConfigMap = useAppStore((s) => s.cpaReviewSheetConfig);
  const { confirm, ConfirmDialogUI } = useConfirm();
  const t = useT();

  // Mỗi tháng 1 bảng dữ liệu riêng (thêm 2026-08-14, yêu cầu "chọn tháng nào sẽ ra bảng của
  // tháng đó") — lọc client-side từ toàn bộ cpaReviewRecords đã nạp sẵn (khối lượng dữ liệu
  // nhiều tháng vẫn nhỏ, không cần fetch riêng theo tháng/đổi kiến trúc hydrate).
  const rows = allRows.filter((r) => r.month === selectedMonth);
  const isMonthConnected = Boolean(sheetConfigMap[selectedMonth]);

  // Đo chiều cao THẬT của 2 hàng tiêu đề đầu (hàng chữ cái + hàng nhóm năm) để tính `top`
  // cho từng ô tiêu đề tự đóng băng dọc riêng lẻ (xem stickyColStyle/headTopStyle ở trên) —
  // không đoán cứng số px vì phụ thuộc font-size/padding thực tế lúc render.
  const row1Ref = useRef<HTMLTableRowElement>(null);
  const row2Ref = useRef<HTMLTableRowElement>(null);
  const row3Ref = useRef<HTMLTableRowElement>(null);
  const [headerOffset, setHeaderOffset] = useState({ row2: 0, row3: 0, row4: 0 });

  useLayoutEffect(() => {
    function measure() {
      const h1 = row1Ref.current?.getBoundingClientRect().height ?? 0;
      const h2 = row2Ref.current?.getBoundingClientRect().height ?? 0;
      const h3 = row3Ref.current?.getBoundingClientRect().height ?? 0;
      setHeaderOffset((prev) =>
        prev.row2 === h1 && prev.row3 === h1 + h2 && prev.row4 === h1 + h2 + h3
          ? prev
          : { row2: h1, row3: h1 + h2, row4: h1 + h2 + h3 }
      );
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Hàng lọc theo cột (thêm 2026-08-15, yêu cầu "thêm row 3 mặc định, mỗi cột là filter của
  // cột đó") — đặt NGAY DƯỚI 2 hàng tiêu đề, đúng vị trí dòng số 3 trên Sheet thật (dòng 1-3
  // dành riêng cho tiêu đề, dữ liệu thật bắt đầu từ dòng 4 — xem "row < 4 return" trong
  // buildAppsScript). Trước đây app chỉ có 2 hàng tiêu đề (dữ liệu hiện thành "dòng 3"), lệch
  // 1 dòng so với quy ước thật của Sheet — thêm hàng lọc này vừa có filter vừa khớp đúng số
  // dòng thật. Key filter TRÙNG với key trong `custom` (vd `status_2024`, `crmSource`,
  // `processorUserId`) — so khớp CHÍNH XÁC (dropdown) với cột kiểu select/assign, so khớp
  // CHỨA (text, không phân biệt hoa/thường) với các cột còn lại. Cột "Tổng" mỗi năm là công
  // thức tự tính (không lưu trong custom) nên KHÔNG có ô lọc riêng.
  // Ẩn mặc định (yêu cầu 2026-08-15 "ẩn row này đi") — bấm nút "Lọc" ở toolbar mới hiện ra.
  // Số dòng gutter (i+4) KHÔNG đổi dù ẩn/hiện — luôn khớp đúng dòng 4 thật của Sheet (dòng 1-3
  // dành riêng cho tiêu đề), dòng 3 chỉ đơn giản là không render ra khi ẩn, không phải đổi lại
  // quy ước đánh số. Dòng mới (thêm tay/"Test Sheet") nối vào CUỐI danh sách (xem
  // nextAppendCpaReviewSortOrder) — KHÔNG lên đầu (đã thử rồi đảo lại cùng ngày vì làm số
  // "row" trong app lệch khỏi số dòng thật trên Sheet, xem giải thích ở đó).
  const [showFilterRow, setShowFilterRow] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const hasActiveFilters = Object.values(filters).some(Boolean);
  function setFilter(key: string, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }
  // Tắt hàng lọc thì xoá luôn bộ lọc đang áp — tránh tình trạng lọc "vô hình" (ẩn hàng lọc đi
  // nhưng bảng vẫn thiếu dòng do bộ lọc cũ còn hiệu lực, không có gì báo cho biết).
  function toggleFilterRow() {
    setShowFilterRow((v) => {
      if (v) setFilters({});
      return !v;
    });
  }
  const filteredRows = rows.filter((row) => {
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      if (key === "processorUserId" || key === "agentUserId" || key === "crmSource" || key.startsWith("status_")) {
        if (((row.custom[key] as string | undefined) ?? "") !== value) return false;
        continue;
      }
      const cell = row.custom[key];
      const text = cell == null ? "" : String(cell);
      if (!text.toLowerCase().includes(value.trim().toLowerCase())) return false;
    }
    return true;
  });

  if (!user) return null;

  // Cùng nguyên tắc "phân quyền xem" thật (chặn cả gõ thẳng URL) như tab Collecting.
  if (!hasFeature(featurePermissions, "viewCpaReview", user.role)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <ShieldAlert size={28} className="text-text-faint" />
        <p className="text-sm text-text-dim">{t("users.accessDenied")}</p>
      </div>
    );
  }

  const canAdd = hasFeature(featurePermissions, "addCpaReviewRow", user.role);
  const canDelete = hasFeature(featurePermissions, "deleteCpaReviewRow", user.role);
  const canManageStatus = hasFeature(featurePermissions, "manageCpaReviewSheet", user.role);
  const agentUsers = users.filter((u) => u.role === "agent" || u.role === "agent_leader");
  const processorUsers = users.filter((u) => u.role === "processor" || u.role === "processor_leader");

  // Ẩn/hiện cột "đuôi" cho MỌI user (thêm 2026-08-15, yêu cầu "ẩn hiện cột ở tất cả màn hình
  // có table") — chỉ áp dụng cho 7 cột đuôi (Note/Processor/Agent/CRM Source/FC Date/
  // Processing Date/EL Date), KHÔNG áp dụng cho 6 cột đóng băng A-F hay khối năm (cấu trúc
  // header phức tạp — colSpan/rowSpan cố định 4 subcột/năm, xem yearHeaderStyle) để tránh phá
  // vỡ layout đóng băng/sticky đã có.
  const hiddenColumnsSet = new Set(hiddenColumns);
  const tailColumnsAll = CPA_REVIEW_COLUMNS.slice(6 + CPA_REVIEW_YEARS.length * YEAR_COLUMN_COUNT + 1);
  const tailColumns = tailColumnsAll.filter((c) => !hiddenColumnsSet.has(c.key));
  const showNoteColumn = !hiddenColumnsSet.has("note");
  const showProcessorColumn = !hiddenColumnsSet.has("processorUserId");
  const showAgentColumn = !hiddenColumnsSet.has("agentUserId");

  // Tổng số cột dữ liệu (không tính cột số dòng/nút xoá) — dùng để vẽ hàng chữ cái kiểu
  // Google Sheet (A, B, C...) khớp đúng số cột thật đang render bên dưới.
  const totalDataColumns =
    CPA_REVIEW_COLUMNS.slice(0, 6).length +
    CPA_REVIEW_VISIBLE_YEARS.length * 5 +
    (showNoteColumn ? 1 : 0) +
    (showProcessorColumn ? 1 : 0) +
    (showAgentColumn ? 1 : 0) +
    tailColumns.length;

  // Đếm số dòng có "Tổng" (Số tiền + Điều chỉnh) > 0 mỗi năm — hiện ngay trong ô tiêu đề
  // cột "Tổng", khớp đúng công thức COUNTIF Google Sheet đặt ở dòng 1 cùng vị trí cột này
  // trên Sheet thật (đã xác nhận qua khảo sát trực tiếp Sheet ngày 2026-08-14). Yêu cầu
  // "Cột K sẽ sum tổng số input ở cột đó, ko phải tổng số tiền" — nghĩa là ĐẾM số dòng có
  // dữ liệu, không phải cộng dồn số tiền.
  const totalCountByYear: Record<string, number> = {};
  for (const year of CPA_REVIEW_VISIBLE_YEARS) {
    totalCountByYear[year] = rows.filter((r) => {
      const amount = r.custom[yearAmountKey(year)];
      const adjustment = r.custom[yearAdjustmentKey(year)];
      const total = (typeof amount === "number" ? amount : 0) + (typeof adjustment === "number" ? adjustment : 0);
      return total > 0;
    }).length;
  }

  async function handleDelete(rowId: string) {
    if (await confirm(t("collecting.deleteRowConfirm"), { title: t("collecting.deleteRowTitle"), tone: "danger" })) {
      deleteCpaReviewRow(rowId);
    }
  }

  return (
    <div className="flex h-full flex-col px-4 py-6 sm:px-6">
      {ConfirmDialogUI}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t("nav.cpaReview")}</h1>
          <p className="mt-0.5 text-xs text-text-faint">
            Bảng độc lập theo TỪNG THÁNG, khớp đúng cấu trúc Google Sheet CPA Review — đồng bộ 2 chiều nếu đã kết nối
            (nút &quot;Kết nối Sheet&quot; cạnh bộ chọn tháng).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CpaReviewMonthPicker value={selectedMonth} onChange={setSelectedMonth} />
          {canManageStatus && (
            <>
              <CpaReviewSyncGuideDialog month={selectedMonth} />
              <CpaReviewSheetConfigDialog month={selectedMonth} />
            </>
          )}
          {canManageStatus && <CpaReviewStatusOptionsButton />}
          {canManageStatus && (
            <ColumnVisibilityButton hiddenColumns={hiddenColumnsSet} onToggle={toggleHiddenColumn} />
          )}
          <button
            onClick={toggleFilterRow}
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition ${
              showFilterRow
                ? "border-accent bg-accent-soft text-accent"
                : "border-border bg-surface text-text-dim hover:bg-surface-hover hover:text-text"
            }`}
          >
            <Filter size={14} />
            Lọc
            {hasActiveFilters && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
          </button>
          {canAdd && (
            <button
              onClick={addCpaReviewRow}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
            >
              <Plus size={14} />
              {t("common.add")}
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 && !isMonthConnected && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-3 text-xs text-text-faint">
          <FileSpreadsheet size={15} className="shrink-0 text-text-dim" />
          <span>
            Chưa có dữ liệu/kết nối Sheet cho <span className="font-medium text-text">{monthKeyLabel(selectedMonth)}</span>
            {canManageStatus ? " — dán link Sheet của tháng này qua nút \"Kết nối Sheet\" ở trên, hoặc bấm \"Hướng dẫn\" nếu chưa từng làm." : "."}
          </span>
        </div>
      )}

      {rows.length > 0 && filteredRows.length === 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-3 text-xs text-text-faint">
          <span>
            Không có dòng nào khớp bộ lọc hiện tại —{" "}
            <button onClick={() => setFilters({})} className="font-medium text-accent hover:underline">
              xoá tất cả bộ lọc
            </button>
            .
          </span>
        </div>
      )}

      <div className="mt-4 flex-1 overflow-auto rounded-xl border border-border-strong">
        {/* border-separate (KHÔNG border-collapse) — bắt buộc để position:sticky trên
            <td>/<th> hoạt động đúng khi cuộn NGANG, tránh lỗi cột A-F "dính" luôn cả khi
            cuộn DỌC (trình duyệt tính sai containing-block của sticky khi border-collapse),
            sửa 2026-08-14. border-spacing-0 giữ nguyên giao diện liền mí như cũ. */}
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          {/* Đã bỏ sticky ở <thead> (không đáng tin cậy trên <table>, xem giải thích ở
              stickyColStyle) — MỖI ô tiêu đề (kể cả cột không đóng băng ngang) giờ tự
              `position: sticky` dọc riêng với `top` đo thật qua headerOffset. */}
          <thead className="bg-table-head-bg text-table-head-text">
            {/* Hàng chữ cái kiểu Google Sheet (A, B, C...) — thêm 2026-08-14 theo yêu cầu
                "cột thứ tự sắp xếp bắt đầu từ A như Google Sheet". Hàng này KHÔNG tính là 1
                dòng số (yêu cầu "không tính dòng đầu") — 3 hàng con phía dưới (nhóm năm +
                tiêu đề cột con + hàng lọc, thêm 2026-08-15) mới là dòng 1/2/3 thật, dữ liệu
                bắt đầu từ dòng 4, khớp đúng quy ước Sheet thật. */}
            <tr ref={row1Ref}>
              <th className="border-b border-r border-border bg-table-head-bg" style={gutterHeadStyle(0)} />
              {Array.from({ length: totalDataColumns }).map((_, i) => {
                const stickyKey = i < 6 ? CPA_REVIEW_COLUMNS[i]?.key : undefined;
                return (
                  <th
                    key={`col-letter-${i}`}
                    className="whitespace-nowrap border-b border-r border-border bg-table-head-bg px-2.5 py-1 text-center text-[10px] font-normal text-text-faint"
                    style={stickyKey ? stickyColStyle(stickyKey, 30, 0) : headTopStyle(0, 20)}
                  >
                    {letterFor(i)}
                  </th>
                );
              })}
            </tr>
            {/* Hàng tiêu đề nhóm năm — thêm 2026-08-14 theo yêu cầu "cột G,H,I,J nhóm lại
                thành 1 chỉ ở Head Table, đặt tên 2023" (giống cách Google Sheet thật merge 1
                ô tiêu đề trên đầu mỗi khối năm thay vì lặp lại "2023 Ngày"/"2023 Status"...
                ở từng cột con). Cột "Tổng" mỗi năm (rowSpan xuống hàng dưới) hiện kèm số đếm
                dòng có dữ liệu (COUNTIF-style, khớp đúng công thức thật trên Sheet), KHÔNG
                phải tổng số tiền. Đây là DÒNG SỐ 1 thật (gutter "1") — hàng con bên dưới
                (tiêu đề cột con Ngày/Status/...) là DÒNG SỐ 2, khớp đúng cách Google Sheet
                đếm dòng (2 dòng tiêu đề = dòng 1, 2; dữ liệu bắt đầu dòng 3). */}
            <tr ref={row2Ref}>
              <th
                className="border-b border-r border-border bg-table-head-bg text-center text-[10px] font-normal text-text-faint"
                style={gutterHeadStyle(headerOffset.row2)}
              >
                1
              </th>
              {CPA_REVIEW_COLUMNS.slice(0, 6).map((col) => (
                <th
                  key={col.key}
                  rowSpan={2}
                  className="whitespace-nowrap border-b border-r border-border bg-table-head-bg px-2 py-2 text-center text-[11px] font-semibold"
                  style={stickyColStyle(col.key, 30, headerOffset.row2)}
                >
                  {/* Cột Intake Date: bỏ hẳn label chữ, chỉ hiện số tổng cộng số lượng (KHÔNG
                      phải tổng tiền) cộng dồn "Tổng" (đếm số dòng có Tổng > 0) của cả 3 năm,
                      KHÔNG có dấu ngoặc đơn — theo yêu cầu 2026-08-15 ("bỏ text intake đi và
                      số sum ko có ()"). Các cột A-F còn lại vẫn hiện label chữ như cũ. */}
                  {col.key === "intakeDate" ? (
                    // To gấp đôi (text-[11px] mặc định -> text-[22px]) theo yêu cầu 2026-08-15.
                    <span className="text-[22px] font-semibold leading-none text-amber-400">
                      {CPA_REVIEW_VISIBLE_YEARS.reduce((sum, year) => sum + (totalCountByYear[year] ?? 0), 0)}
                    </span>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
              {CPA_REVIEW_VISIBLE_YEARS.flatMap((year) => [
                <th
                  key={`${year}-group`}
                  colSpan={4}
                  style={yearHeaderStyle(year, headerOffset.row2, 20)}
                  className="whitespace-nowrap border-b border-r border-border px-2.5 py-2 text-center text-xs font-semibold"
                >
                  {year}
                </th>,
                <th
                  key={`${year}-total`}
                  rowSpan={2}
                  style={yearHeaderStyle(year, headerOffset.row2, 20)}
                  className="whitespace-nowrap border-b border-r border-border px-2.5 py-2 text-center text-xs font-semibold"
                >
                  Tổng
                  <span className="ml-1 font-semibold text-red-400">({totalCountByYear[year] ?? 0})</span>
                </th>,
              ])}
              {showNoteColumn && (
                <th
                  rowSpan={2}
                  style={headTopStyle(headerOffset.row2, 20)}
                  className="whitespace-nowrap border-b border-r border-border bg-table-head-bg px-2.5 py-2 text-center text-xs font-semibold"
                >
                  Note
                </th>
              )}
              {showProcessorColumn && (
                <th
                  rowSpan={2}
                  style={headTopStyle(headerOffset.row2, 20)}
                  className="whitespace-nowrap border-b border-r border-border bg-table-head-bg px-2.5 py-2 text-center text-xs font-semibold"
                >
                  Processor
                </th>
              )}
              {showAgentColumn && (
                <th
                  rowSpan={2}
                  style={headTopStyle(headerOffset.row2, 20)}
                  className="whitespace-nowrap border-b border-r border-border bg-table-head-bg px-2.5 py-2 text-center text-xs font-semibold"
                >
                  Agent
                </th>
              )}
              {tailColumns.map((col) => (
                <th
                  key={col.key}
                  rowSpan={2}
                  style={headTopStyle(headerOffset.row2, 20)}
                  className="whitespace-nowrap border-b border-r border-border bg-table-head-bg px-2.5 py-2 text-center text-xs font-semibold"
                >
                  {col.label}
                </th>
              ))}
            </tr>
            <tr ref={row3Ref}>
              <th
                className="border-b border-r border-border bg-table-head-bg text-center text-[10px] font-normal text-text-faint"
                style={gutterHeadStyle(headerOffset.row3)}
              >
                2
              </th>
              {CPA_REVIEW_VISIBLE_YEARS.flatMap((year) => [
                <th
                  key={`${year}-date`}
                  style={yearHeaderStyle(year, headerOffset.row3, 20)}
                  className="whitespace-nowrap border-b border-r border-border px-2.5 py-2 text-center text-xs font-semibold"
                >
                  Ngày
                </th>,
                <th
                  key={`${year}-status`}
                  style={yearHeaderStyle(year, headerOffset.row3, 20)}
                  className="whitespace-nowrap border-b border-r border-border px-2.5 py-2 text-center text-xs font-semibold"
                >
                  Status
                </th>,
                <th
                  key={`${year}-amount`}
                  style={yearHeaderStyle(year, headerOffset.row3, 20)}
                  className="whitespace-nowrap border-b border-r border-border px-2.5 py-2 text-center text-xs font-semibold"
                >
                  Số tiền
                </th>,
                <th
                  key={`${year}-adjustment`}
                  style={yearHeaderStyle(year, headerOffset.row3, 20)}
                  className="whitespace-nowrap border-b border-r border-border px-2.5 py-2 text-center text-xs font-semibold"
                >
                  Other Refund
                </th>,
              ])}
            </tr>
            {/* Hàng lọc theo cột — DÒNG SỐ 3 thật (gutter "3"), khớp đúng quy ước Sheet thật
                (dòng 1-3 dành cho tiêu đề, dữ liệu bắt đầu dòng 4 — xem "row < 4 return" trong
                buildAppsScript), thêm 2026-08-15. Ẩn mặc định (bấm nút "Lọc" ở toolbar để
                hiện) — số dòng gutter dữ liệu vẫn luôn tính từ 4 dù ẩn/hiện hàng này. */}
            {showFilterRow && (
            <tr>
              <th
                className="border-b border-r border-border bg-table-head-bg text-center text-[10px] font-normal text-text-faint"
                style={gutterHeadStyle(headerOffset.row4)}
              >
                {hasActiveFilters ? (
                  <button
                    onClick={() => setFilters({})}
                    className="flex h-full w-full items-center justify-center text-accent transition hover:text-red-400"
                    title="Xoá tất cả bộ lọc"
                  >
                    <X size={11} />
                  </button>
                ) : (
                  "3"
                )}
              </th>
              {CPA_REVIEW_COLUMNS.slice(0, 6).map((col) => (
                <th
                  key={`${col.key}-filter`}
                  className="border-b border-r border-border bg-table-head-bg p-0 text-left font-normal"
                  style={stickyColStyle(col.key, 30, headerOffset.row4)}
                >
                  <FilterInput value={filters[col.key] ?? ""} onChange={(v) => setFilter(col.key, v)} />
                </th>
              ))}
              {CPA_REVIEW_VISIBLE_YEARS.flatMap((year) => [
                <th
                  key={`${year}-date-filter`}
                  style={yearHeaderStyle(year, headerOffset.row4, 20)}
                  className="border-b border-r border-border p-0 text-left font-normal"
                >
                  <FilterInput value={filters[yearEfileDateKey(year)] ?? ""} onChange={(v) => setFilter(yearEfileDateKey(year), v)} />
                </th>,
                <th
                  key={`${year}-status-filter`}
                  style={yearHeaderStyle(year, headerOffset.row4, 20)}
                  className="border-b border-r border-border p-0 text-left font-normal"
                >
                  <FilterSelect
                    value={filters[yearStatusKey(year)] ?? ""}
                    onChange={(v) => setFilter(yearStatusKey(year), v)}
                    options={statusOptions}
                  />
                </th>,
                <th
                  key={`${year}-amount-filter`}
                  style={yearHeaderStyle(year, headerOffset.row4, 20)}
                  className="border-b border-r border-border p-0 text-left font-normal"
                >
                  <FilterInput value={filters[yearAmountKey(year)] ?? ""} onChange={(v) => setFilter(yearAmountKey(year), v)} />
                </th>,
                <th
                  key={`${year}-adjustment-filter`}
                  style={yearHeaderStyle(year, headerOffset.row4, 20)}
                  className="border-b border-r border-border p-0 text-left font-normal"
                >
                  <FilterInput
                    value={filters[yearAdjustmentKey(year)] ?? ""}
                    onChange={(v) => setFilter(yearAdjustmentKey(year), v)}
                  />
                </th>,
                // Cột "Tổng" — công thức tự tính, không lưu trong custom -> không có ô lọc.
                <th
                  key={`${year}-total-filter`}
                  style={yearHeaderStyle(year, headerOffset.row4, 20)}
                  className="border-b border-r border-border bg-table-head-bg"
                />,
              ])}
              {showNoteColumn && (
                <th className="border-b border-r border-border bg-table-head-bg p-0 text-left font-normal" style={headTopStyle(headerOffset.row4, 20)}>
                  <FilterInput value={filters.note ?? ""} onChange={(v) => setFilter("note", v)} />
                </th>
              )}
              {showProcessorColumn && (
                <th className="border-b border-r border-border bg-table-head-bg p-0 text-left font-normal" style={headTopStyle(headerOffset.row4, 20)}>
                  <FilterSelect
                    value={filters.processorUserId ?? ""}
                    onChange={(v) => setFilter("processorUserId", v)}
                    options={processorUsers.map((u) => ({ id: u.id, label: u.name }))}
                  />
                </th>
              )}
              {showAgentColumn && (
                <th className="border-b border-r border-border bg-table-head-bg p-0 text-left font-normal" style={headTopStyle(headerOffset.row4, 20)}>
                  <FilterSelect
                    value={filters.agentUserId ?? ""}
                    onChange={(v) => setFilter("agentUserId", v)}
                    options={agentUsers.map((u) => ({ id: u.id, label: u.name }))}
                  />
                </th>
              )}
              {tailColumns.map((col) => (
                <th
                  key={`${col.key}-filter`}
                  className="border-b border-r border-border bg-table-head-bg p-0 text-left font-normal"
                  style={headTopStyle(headerOffset.row4, 20)}
                >
                  {col.key === "crmSource" ? (
                    <FilterSelect value={filters.crmSource ?? ""} onChange={(v) => setFilter("crmSource", v)} options={crmSourceOptions} />
                  ) : (
                    <FilterInput value={filters[col.key] ?? ""} onChange={(v) => setFilter(col.key, v)} />
                  )}
                </th>
              ))}
            </tr>
            )}
          </thead>
          <tbody>
            {filteredRows.map((row: CpaReviewRecord, i) => {
              const rowBg = i % 2 === 0 ? "bg-bg" : "bg-[var(--row-alt-bg)]";
              return (
              <tr key={row.id} className={rowBg}>
                <td className={`group border-b border-r border-border p-0 align-middle ${rowBg}`} style={GUTTER_STYLE_BODY}>
                  {/* Số dòng từ trên xuống (giống gutter Google Sheet) — ẩn đi, thay bằng
                      nút xoá khi hover, theo yêu cầu 2026-08-14. 3 hàng tiêu đề (chữ cái
                      không tính, "1"/"2"/"3" có tính) khớp đúng quy ước Sheet thật (dòng 1-3
                      dành cho tiêu đề, dữ liệu bắt đầu dòng 4), thêm 2026-08-15. */}
                  <div className="relative flex h-full w-full items-center justify-center">
                    <span className="text-[11px] text-text-faint transition-opacity [tr:hover_&]:opacity-0">{i + 4}</span>
                    {canDelete && (
                      <button
                        onClick={() => handleDelete(row.id)}
                        className="absolute inset-0 flex items-center justify-center text-text-faint opacity-0 transition hover:text-red-400 [tr:hover_&]:opacity-100"
                        aria-label={t("common.delete")}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
                {CPA_REVIEW_COLUMNS.slice(0, 6).map((col) => {
                  const isName = col.key === "name";
                  const hasLink = isName && typeof row.custom.nameLink === "string" && row.custom.nameLink;
                  return (
                    <td
                      key={col.key}
                      className={`group border-b border-r border-border p-0 align-middle ${rowBg}`}
                      style={stickyColStyle(col.key, 10)}
                    >
                      <div className="relative">
                        <EditableCell
                          value={(row.custom[col.key] as string | number | null) ?? null}
                          type={col.type}
                          options={col.options}
                          editable
                          dense
                          // Tên (khác 5 cột A-F còn lại) căn trái + màu xanh dương đậm khi có
                          // link tới hồ sơ gốc — yêu cầu 2026-08-14 ("ngoại trừ Head Table
                          // thì điều chỉnh Text sang trái... màu xanh dương đậm nếu có link").
                          align={isName ? "left" : "center"}
                          accent={Boolean(hasLink)}
                          // Phone/SSN/DOB đôi khi chứa 2 giá trị cách nhau bằng dấu cách trong
                          // cùng 1 ô (dữ liệu thật từ Sheet) — xuống dòng riêng cho dễ đọc thay
                          // vì hiện dính liền 1 dòng dài, theo yêu cầu 2026-08-14.
                          breakOnSpace={col.key === "phone" || col.key === "ssn" || col.key === "dob"}
                          dateFormat={col.type === "date" || col.key === "dob" ? "mmddyy" : undefined}
                          // Ctrl+Enter xuống dòng trong ô text box (Name/SSN/DOB) — không có
                          // tác dụng gì với các type khác (intakeDate/phone/zipcode), EditableCell
                          // tự bỏ qua nếu type !== "text". Thêm 2026-08-14.
                          multilineEdit
                          onCommit={(v) => updateCpaReviewCell(row.id, col.key, v)}
                        />
                        {/* Tên khách hàng trên Sheet thật có link tới hồ sơ gốc
                            (tax.agentc3.com) — đọc được qua đồng bộ, hiện icon mở link cạnh
                            tên thay vì thay hẳn ô bằng link (vẫn sửa tay được tên bình
                            thường), thêm 2026-08-14. */}
                        {hasLink && (
                          <a
                            href={row.custom.nameLink as string}
                            target="_blank"
                            rel="noreferrer"
                            className="absolute right-1 top-1/2 -translate-y-1/2 text-text-faint transition hover:text-accent"
                            title="Mở hồ sơ gốc"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </td>
                  );
                })}

                {CPA_REVIEW_VISIBLE_YEARS.map((year) => {
                  const amount = row.custom[yearAmountKey(year)];
                  const adjustment = row.custom[yearAdjustmentKey(year)];
                  return (
                    <YearCells
                      key={year}
                      tint={yearTintFor(year)}
                      statusOptions={statusOptions}
                      efileDate={(row.custom[yearEfileDateKey(year)] as string | null) ?? null}
                      status={(row.custom[yearStatusKey(year)] as string | null) ?? null}
                      amount={typeof amount === "number" ? amount : 0}
                      adjustment={typeof adjustment === "number" ? adjustment : 0}
                      note={(row.custom[yearNoteKey(year)] as string | null) ?? null}
                      onChangeEfileDate={(v) => updateCpaReviewCell(row.id, yearEfileDateKey(year), v)}
                      onChangeStatus={(v) => updateCpaReviewCell(row.id, yearStatusKey(year), v)}
                      onChangeAmount={(v) => updateCpaReviewCell(row.id, yearAmountKey(year), v)}
                      onChangeAdjustment={(v) => updateCpaReviewCell(row.id, yearAdjustmentKey(year), v)}
                      onChangeNote={(v) => updateCpaReviewCell(row.id, yearNoteKey(year), v)}
                    />
                  );
                })}

                {showNoteColumn && (
                  <Cell>
                    {/* Gọn hơn (max-width) + tự xuống dòng khi chữ dài thay vì cắt bớt, theo
                        yêu cầu 2026-08-14. */}
                    <div style={{ maxWidth: 220 }}>
                      <EditableCell
                        value={(row.custom.note as string | null) ?? null}
                        type="text"
                        editable
                        wrap
                        multilineEdit
                        onCommit={(v) => updateCpaReviewCell(row.id, "note", v)}
                      />
                    </div>
                  </Cell>
                )}
                {showProcessorColumn && (
                  <Cell>
                    <AssignMenu
                      users={processorUsers}
                      assignedTo={(row.custom.processorUserId as string) ?? null}
                      canAssign
                      onAssign={(uid) => updateCpaReviewCell(row.id, "processorUserId", uid)}
                    />
                  </Cell>
                )}
                {showAgentColumn && (
                  <Cell>
                    <AssignMenu
                      users={agentUsers}
                      assignedTo={(row.custom.agentUserId as string) ?? null}
                      canAssign
                      onAssign={(uid) => updateCpaReviewCell(row.id, "agentUserId", uid)}
                    />
                  </Cell>
                )}

                {tailColumns.map((col) => (
                  <Cell key={col.key}>
                    <EditableCell
                      value={(row.custom[col.key] as string | number | null) ?? null}
                      type={col.type}
                      options={col.key === "crmSource" ? crmSourceOptions : col.options}
                      editable
                      searchable={col.key === "crmSource"}
                      dateFormat={col.type === "date" ? "mmddyy" : undefined}
                      onCommit={(v) => updateCpaReviewCell(row.id, col.key, v)}
                    />
                  </Cell>
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Nút "Cột hiển thị" (thêm 2026-08-15, yêu cầu "ẩn hiện cột ở tất cả màn hình có table") —
 * danh sách checkbox bật/tắt hiển thị cho MỌI user, chỉ gồm HIDEABLE_TAIL_COLUMNS (xem giải
 * thích ở khai báo hằng số). */
function ColumnVisibilityButton({
  hiddenColumns,
  onToggle,
}: {
  hiddenColumns: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  function openPopup() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ x: Math.min(rect.left, window.innerWidth - 240), y: rect.bottom + 4 });
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={openPopup}
        className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition ${
          hiddenColumns.size > 0
            ? "border-accent bg-accent-soft text-accent"
            : "border-border bg-surface text-text-dim hover:bg-surface-hover hover:text-text"
        }`}
      >
        <EyeOff size={14} />
        Cột hiển thị
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div className="popover fixed z-[100] w-56 rounded-xl p-2 shadow-2xl shadow-black/60" style={{ left: pos.x, top: pos.y }}>
              <p className="mb-1.5 px-1 text-[11px] font-semibold text-text-faint">Ẩn/hiện cột (áp dụng cho mọi người dùng)</p>
              <div className="flex flex-col gap-0.5">
                {HIDEABLE_TAIL_COLUMNS.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.has(c.key)}
                      onChange={() => onToggle(c.key)}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  );
}

function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`group border-b border-r border-border p-0 align-middle ${className ?? ""}`}>
      {children}
    </td>
  );
}

/** Ô lọc dạng text (hàng lọc "3", thêm 2026-08-15) — so khớp CHỨA, không phân biệt hoa/thường,
 * dùng cho mọi cột không phải select/assign (xem CpaReviewPage). */
// Nền + viền rõ ràng riêng cho ô lọc (khác hẳn nền header xung quanh) — trước đây bg-transparent
// khiến ô lọc lẫn vào header, khó nhận ra đâu là chỗ gõ được (yêu cầu 2026-08-15 "chỉnh giao
// diện text và background dễ nhìn hơn").
const FILTER_FIELD_CLASS =
  "m-1 h-7 w-[calc(100%-8px)] min-w-0 rounded-md border border-border-strong bg-bg-elevated px-2 text-xs font-medium text-text shadow-sm outline-none transition placeholder:text-text-faint focus:border-accent focus:bg-bg";

function FilterInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Lọc..."
      className={FILTER_FIELD_CLASS}
    />
  );
}

/** Ô lọc dạng dropdown (hàng lọc "3") — dùng cho cột select (Status mỗi năm, CRM Source) và
 * Processor/Agent (options build từ danh sách user), so khớp CHÍNH XÁC theo id. */
function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${FILTER_FIELD_CLASS} cursor-pointer`}>
      <option value="">Tất cả</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** 5 cột của 1 năm, khớp đúng khối 5 cột thật trên Google Sheet (thêm 2026-08-14, xem
 * cpa-review-columns.ts): Ngày E-file / Status / Số tiền / Điều chỉnh (cột P — sửa được
 * trực tiếp) / Tổng (cột Q — CHỈ XEM, tự tính = Số tiền + Điều chỉnh giống hệt công thức
 * `=O+P` trên Sheet thật, không lưu/đồng bộ để không bao giờ ghi đè công thức gốc). */
function YearCells({
  tint,
  statusOptions,
  efileDate,
  status,
  amount,
  adjustment,
  note,
  onChangeEfileDate,
  onChangeStatus,
  onChangeAmount,
  onChangeAdjustment,
  onChangeNote,
}: {
  /** Class màu nền xen kẽ theo năm (YEAR_TINT) — thêm 2026-08-14, yêu cầu "3 cột năm
   * highlight màu xen kẽ dễ phân biệt". */
  tint: string;
  statusOptions: { id: string; label: string; bg: string; color: string }[];
  efileDate: string | null;
  status: string | null;
  amount: number;
  adjustment: number;
  note: string | null;
  onChangeEfileDate: (v: string | null) => void;
  onChangeStatus: (v: string) => void;
  onChangeAmount: (v: number) => void;
  onChangeAdjustment: (v: number) => void;
  onChangeNote: (v: string) => void;
}) {
  const total = amount + adjustment;
  return (
    <>
      <Cell className={tint}>
        <DateWithNote value={efileDate} note={note} onChangeDate={(v) => onChangeEfileDate(v)} onChangeNote={onChangeNote} />
      </Cell>
      <Cell className={tint}>
        {/* Luôn hiện dropdown (kể cả dòng vừa thêm/chưa có Số tiền) — trước đây chỉ hiện khi
            hasAmount, khiến dòng mới thêm không sửa được Status, theo yêu cầu 2026-08-14. */}
        <EditableCell
          value={status}
          type="select"
          options={statusOptions}
          editable
          searchable
          onCommit={(v) => onChangeStatus(v as string)}
        />
      </Cell>
      <Cell className={tint}>
        <EditableCell value={amount || null} type="currency" editable onCommit={(v) => onChangeAmount((v as number) || 0)} />
      </Cell>
      <Cell className={tint}>
        <EditableCell value={adjustment || null} type="currency" editable onCommit={(v) => onChangeAdjustment((v as number) || 0)} />
      </Cell>
      <Cell className={tint}>
        {total > 0 ? (
          <div className="px-2.5 py-1.5 text-xs text-text-dim">${total.toLocaleString("en-US")}</div>
        ) : (
          <div className="px-2.5 py-1.5 text-xs text-text-faint">—</div>
        )}
      </Cell>
    </>
  );
}

/** Ô "Ngày" (efile date) mỗi năm + ghi chú riêng (thêm 2026-08-14, yêu cầu "cột ngày mỗi
 * năm cho phép insert note và highlight và sẽ thấy") — nút ghi chú luôn hiện mờ, sáng hẳn
 * lên (icon vàng) + nền ô đổi màu vàng nhạt khi đã có ghi chú, để "thấy" ngay không cần mở
 * popup. Ghi chú lưu trong `custom.dateNote_{year}` — CHỈ ở app, không đồng bộ lên Sheet
 * (Sheet thật không có cột nào cho việc này). */
function DateWithNote({
  value,
  note,
  onChangeDate,
  onChangeNote,
}: {
  value: string | null;
  note: string | null;
  onChangeDate: (v: string | null) => void;
  onChangeNote: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const t = useT();

  useEffect(() => {
    setDraft(note ?? "");
  }, [note]);

  function openPopup() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ x: Math.min(rect.left, window.innerWidth - 240), y: rect.bottom + 4 });
    setOpen(true);
  }

  const hasNote = Boolean(note && note.trim());

  return (
    <div className={`relative flex items-center ${hasNote ? "bg-amber-500/10" : ""}`}>
      <div className="min-w-0 flex-1">
        <EditableCell value={value} type="date" editable dateFormat="mmddyy" onCommit={(v) => onChangeDate(v as string | null)} />
      </div>
      <button
        ref={triggerRef}
        onClick={openPopup}
        className={`mr-1 shrink-0 rounded p-0.5 transition ${
          hasNote ? "text-amber-400" : "text-text-faint opacity-0 hover:text-text-dim [tr:hover_&]:opacity-100"
        }`}
        title={hasNote ? note! : "Thêm ghi chú"}
      >
        <StickyNote size={11} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div
              className="popover fixed z-[100] w-56 rounded-xl p-2 shadow-2xl shadow-black/60"
              style={{ left: pos.x, top: pos.y }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Ghi chú..."
                className="w-full resize-none rounded-md border border-border bg-bg-elevated p-1.5 text-xs outline-none focus:border-accent"
              />
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-1 text-[11px] text-text-faint hover:bg-surface-hover"
                >
                  {t("common.close")}
                </button>
                <button
                  onClick={() => {
                    onChangeNote(draft);
                    setOpen(false);
                  }}
                  className="gradient-btn rounded-md px-2 py-1 text-[11px] font-medium text-white"
                >
                  {t("common.save")}
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
