"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Plus, Trash2, FileText, DollarSign, GripVertical, ShieldAlert, Download, Upload, Layers, CheckCircle2, X, BarChart3, Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";
import { downloadCaseTemplate, parseCaseExcelFile, formatDuplicateSsnLines } from "@/lib/excel";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { canEditCase, canEditColumn, canViewCase, hasFeature } from "@/lib/rbac";
import {
  CaseRecord,
  CheckInitialValue,
  CollectingReportManualFields,
  ColumnDef,
  CpaEmailDefaults,
  RefundYearStatus,
  SelectOption,
  SmsMessageRecord,
  User,
} from "@/lib/types";
import { CHECK_INITIAL_COLUMN_ID } from "@/lib/check-initial";
import { CheckInitialCell } from "@/components/check-initial-cell";
import { CaseRefundStatusButton } from "@/components/case-refund-status-button";
import { refundYearRows } from "@/lib/refund-status";
import type { ClientProfilePayload } from "@/lib/api-client";
import { EditableCell } from "@/components/editable-cell";
import { AssignMenu } from "@/components/assign-menu";
import { AddColumnDialog } from "@/components/add-column-dialog";
import { ColumnSettingsDialog } from "@/components/column-settings-dialog";
import { ClientNameCell } from "@/components/client-name-cell";
import { SsnCell } from "@/components/ssn-cell";
import { DescriptionCell } from "@/components/description-cell";
import { OrderCell } from "@/components/order-cell";
import { SendToSheetButton } from "@/components/send-to-sheet-button";
import { SendCpaEmailDialog } from "@/components/send-cpa-email-dialog";
import { TestSheetButton } from "@/components/test-sheet-button";
import { caseStatusOptionsForCrmSource } from "@/lib/cpa-review-columns";
import { canShowSendButtonsForStatusLabel } from "@/lib/send-buttons-status";
import { SendActionsMenuButton } from "@/components/send-actions-menu-button";
import { SendClientEmailButton } from "@/components/send-client-email-button";
import { CaseSmsButton } from "@/components/case-sms-button";
import { ForProcessorButton } from "@/components/for-processor-dialog";
import { HistoryDialog } from "@/components/history-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { useAlert } from "@/components/alert-dialog";
import { isDuplicateSsn, digitsOnly } from "@/lib/ssn";
import { getFullName } from "@/lib/client-name";
import { hasWaitingOrderForSsn, missingOrderClientFields } from "@/lib/orders";
import { greetingPeriodFor, greetingEmoji, GreetingPeriod } from "@/lib/greeting";
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

// Các cột này chỉ sửa được qua popup "Edit Hồ sơ" (ClientProfileDialog) — khoá cứng ô
// ngoài bảng chính bất kể editableBy (editableBy của các cột này vẫn dùng làm nguồn
// phân quyền RIÊNG cho popup, xem client-profile-dialog.tsx). Không cần liệt kê
// money/caseLabel vì 2 cột đó đã tự khoá qua editableBy rỗng trong rbac.ts.
const LOCKED_OUTSIDE_PROFILE_DIALOG = new Set(["phone", "zipcode", "address"]);

// Nội dung ngắn (5 số zip, 1-2 chữ số Case, số tiền) từng bị dư khoảng trắng do dùng
// chung padding/màu chữ mờ (text-text-dim) với các cột dài hơn — đổi sang chữ đậm +
// tương phản cao (xem prop `dense` của EditableCell) + padding hẹp hơn, ĐỒNG BỘ với
// SSN/Phone/Client Name (đã tự đổi riêng ở ssn-cell.tsx/client-name-cell.tsx vì không
// dùng EditableCell).
const DENSE_BOLD_COLUMNS = new Set(["zipcode", "caseLabel", "money"]);

const GRIP_COL_WIDTH = 26;
const CLIENT_COL_WIDTH = 210;
const AGENT_COL_WIDTH = 100;
const PROCESSOR_COL_WIDTH = 100;
const ACTIONS_COL_WIDTH = 32;

type CaseTab = "all" | "cannot_process" | "active" | "done";
/** Nhóm status thực tế dùng để lọc dữ liệu — "all" không phải 1 nhóm status, chỉ là bỏ qua lọc. */
type CaseStatusGroup = Exclude<CaseTab, "all">;

// Status "On-Hold"/"Cancelled" -> tab Can not Process, "CPA Review"/"Approved" (Accepted)
// -> tab Done, mọi status còn lại (kể cả status tùy chỉnh thêm sau này) -> tab Processing.
const CANNOT_PROCESS_STATUS_IDS = new Set(["on_hold", "cancelled"]);
const DONE_STATUS_IDS = new Set(["cpa_review", "approved"]);

function getCaseTab(statusId: string): CaseStatusGroup {
  if (CANNOT_PROCESS_STATUS_IDS.has(statusId)) return "cannot_process";
  if (DONE_STATUS_IDS.has(statusId)) return "done";
  return "active";
}

// Màn hình Dashboard (view === "dashboard") tổng hợp theo CỘT "Case" (số năm có refund > 0
// trên mỗi hồ sơ — đúng giá trị hiển thị ở cột "Case"/caseLabel, xem refundYearRows trong
// refund-status.ts), KHÔNG đếm theo Client/hồ sơ (row) như trước 2026-08-13 — 1 hồ sơ có
// nhiều năm refund > 0 giờ tính là nhiều "Case". Dùng chung 2 helper dưới đây cho mọi khối
// (Tổng quan/Theo khoảng ngày/Theo thành viên) thay vì đếm `.length` mảng CaseRecord.
function caseUnitCount(c: Pick<CaseRecord, "refunds" | "refundYearStatus">): number {
  return refundYearRows(c.refunds, c.refundYearStatus).length;
}
function sumCaseUnits(list: Pick<CaseRecord, "refunds" | "refundYearStatus">[]): number {
  return list.reduce((sum, c) => sum + caseUnitCount(c), 0);
}

function StatChip({
  label,
  value,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Tuỳ chọn — hiện tại dùng cho chip "Tổng" ở chế độ "Xem theo Case": bấm vào để bỏ bộ
   * lọc theo trạng thái năm refund (caseYearStatusFilter), hiện lại toàn bộ row. */
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
        <Icon size={13} />
      </div>
      <span className="text-xs text-text-faint">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 transition hover:bg-surface-hover"
      >
        {content}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5">{content}</div>
  );
}

/** Ô tính nhanh "EC Qualification" (2026-08-13) — thuần công cụ tính tay tại chỗ, KHÔNG
 * gắn với hồ sơ/dữ liệu nào (không lưu DB, không đồng bộ server) — chỉ giữ state cục bộ,
 * mất khi rời trang. Nhập số tiền ($) -> tự chia cho 30% (nhân 10/3), làm tròn kết quả
 * theo quy tắc thông thường (>= .5 làm tròn lên, < .5 làm tròn xuống — Math.round đã đúng
 * hành vi này với số dương), hiện ngay bên phải ô nhập. */
function EcQualificationBox() {
  const [amount, setAmount] = useState("");
  const numeric = Number(amount.replace(/[^0-9.]/g, ""));
  const result = Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric / 0.3) : 0;

  return (
    <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5">
      <span className="whitespace-nowrap text-xs font-medium text-text-dim">EC Qualification</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-text-faint">$</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0"
          inputMode="decimal"
          className="w-24 rounded-md border border-border bg-bg-elevated py-1 pl-5 pr-2 text-xs outline-none focus:border-accent"
        />
      </div>
      <span className="shrink-0 text-sm font-semibold text-text">${result.toLocaleString("en-US")}</span>
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

/** Bản dùng cho chế độ "Xem theo Case" (đếm theo trạng thái từng năm refund, option lấy từ
 * AppConfig.refundYearStatusOptions) — CỐ Ý không dùng translateOptionLabel như
 * StatusStatChip: map dịch đó tra theo id ("pending"/"processing"...) dùng chung với cột
 * Status chính, sẽ âm thầm ghi đè label Admin đã tự đặt cho trạng thái refund-year (đúng
 * bug đã gặp và vá ở case-refund-status-button.tsx, StaticStatusBadge). */
/** Bấm vào chip -> lọc bảng chỉ còn các row có ít nhất 1 năm refund đang ở đúng trạng thái
 * này (xem caseYearStatusFilter). Bấm lại chip đang active -> bỏ lọc (quay về "all"). */
function CaseYearStatusChip({
  option,
  value,
  active,
  onClick,
}: {
  option: SelectOption;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 transition ${
        active ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-hover"
      }`}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
      <span className={`text-xs ${active ? "text-accent" : "text-text-faint"}`}>{option.label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </button>
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
  const refundYearStatusOptions = useAppStore((s) => s.refundYearStatusOptions);
  const users = useAppStore((s) => s.users);
  const permissions = useAppStore((s) => s.featurePermissions);
  const updateCell = useAppStore((s) => s.updateCell);
  const placeOrder = useAppStore((s) => s.placeOrder);
  const cpaEmailDefaults = useAppStore((s) => s.cpaEmailDefaults);
  const cpaSenderEmail = useAppStore((s) => s.cpaSenderEmail);
  const sendCpaEmail = useAppStore((s) => s.sendCpaEmail);
  const markCpaEmailSent = useAppStore((s) => s.markCpaEmailSent);
  const sendCaseRowToSheet = useAppStore((s) => s.sendCaseRowToSheet);
  const markCaseSheetSent = useAppStore((s) => s.markCaseSheetSent);
  const sendCaseRowToCpaReview = useAppStore((s) => s.sendCaseRowToCpaReview);
  const markCaseCpaReviewTestSent = useAppStore((s) => s.markCaseCpaReviewTestSent);
  const sendCaseYearToCollecting = useAppStore((s) => s.sendCaseYearToCollecting);
  const connectGoogleAccount = useAppStore((s) => s.connectGoogleAccount);
  const previewRefundEmail = useAppStore((s) => s.previewRefundEmail);
  const sendClientEmail = useAppStore((s) => s.sendClientEmail);
  const markClientEmailSent = useAppStore((s) => s.markClientEmailSent);
  const connectWebmailAccount = useAppStore((s) => s.connectWebmailAccount);
  const fetchSmsThread = useAppStore((s) => s.fetchSmsThread);
  const sendSmsMessage = useAppStore((s) => s.sendSmsMessage);
  const markSmsThreadRead = useAppStore((s) => s.markSmsThreadRead);
  const addRow = useAppStore((s) => s.addRow);
  const importCases = useAppStore((s) => s.importCases);
  const deleteRow = useAppStore((s) => s.deleteRow);
  const deletionHistory = useAppStore((s) => s.deletionHistory);
  const editHistory = useAppStore((s) => s.editHistory);
  const addColumn = useAppStore((s) => s.addColumn);
  const removeColumn = useAppStore((s) => s.removeColumn);
  const renameColumn = useAppStore((s) => s.renameColumn);
  const setColumnEditableBy = useAppStore((s) => s.setColumnEditableBy);
  const setColumnHiddenFromGrid = useAppStore((s) => s.setColumnHiddenFromGrid);
  const addColumnOption = useAppStore((s) => s.addColumnOption);
  const updateColumnOption = useAppStore((s) => s.updateColumnOption);
  const removeColumnOption = useAppStore((s) => s.removeColumnOption);
  const assignCase = useAppStore((s) => s.assignCase);
  const reorderColumn = useAppStore((s) => s.reorderColumn);
  const reorderCase = useAppStore((s) => s.reorderCase);
  const updateClientLink = useAppStore((s) => s.updateClientLink);
  const updateSsn = useAppStore((s) => s.updateSsn);
  const updateRefundYearStatus = useAppStore((s) => s.updateRefundYearStatus);
  const updateRefundYearPendingReason = useAppStore((s) => s.updateRefundYearPendingReason);
  const updateClientProfile = useAppStore((s) => s.updateClientProfile);
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
  /** Popup danh sách thống kê (Tổng/theo Status/Giá trị) trên di động — thay cho dãy chip
   * nằm ngang vốn tràn màn hình nhỏ, gộp vào 1 nút mở popup thay vì hiện tất cả cùng lúc. */
  const [statsPopupOpen, setStatsPopupOpen] = useState(false);
  /** Popup "Thêm" trên di động (thêm 2026-08-16, yêu cầu "mobile chỉ hiển thị table và tìm
   * kiếm/xem thống kê, còn lại gộp vào 1 nút mở popup") — gom mọi nút/điều khiển KHÁC (đổi
   * chế độ đếm case/client, EC Qualification, focus mode, tải mẫu Excel, upload Excel, lọc
   * Status/Processor/Agent, thêm cột, lịch sử, thêm dòng) vào 1 popup duy nhất, để trên di
   * động chỉ còn Bảng + ô tìm kiếm + nút "Xem thống kê" hiện thẳng ngoài toolbar. */
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  /** Chế độ đếm cho dãy chip tổng hợp — "case": đếm theo TỪNG NĂM refund (dữ liệu ở popup
   * mắt cột "Case", mỗi năm có refund > 0 tính 1 đơn vị, nhóm theo trạng thái riêng của
   * năm đó). "client": giữ hành vi cũ, đếm theo TỪNG HỒ SƠ (row), nhóm theo cột Status
   * chính. Mặc định "case" theo yêu cầu 2026-08-12. */
  const [caseSummaryMode, setCaseSummaryMode] = useState<"case" | "client">("case");
  // Bấm 1 chip trạng thái trong dãy tổng hợp ở chế độ "Xem theo Case" -> chỉ hiện các row
  // có ÍT NHẤT 1 năm refund đang ở đúng trạng thái đó (khác statusFilter — statusFilter lọc
  // theo cột Status chính của row, còn bộ lọc này lọc theo trạng thái TỪNG NĂM refund trong
  // con mắt cột Case). "all" = không lọc. Reset khi đổi qua "Xem theo Clients" để tránh lọc
  // ẩn hồ sơ mà không có UI nào đang hiện trạng thái đang lọc.
  const [caseYearStatusFilter, setCaseYearStatusFilter] = useState<string>("all");
  // Chế độ thu gọn — ẩn hàng nút List/Dashboard + lời chào và dãy chip tổng hợp, chỉ giữ
  // lại hàng nút ngang hàng "Thêm dòng" (tải mẫu/nhập Excel/tìm kiếm/lọc/thêm dòng...) và
  // bảng chính, để nhìn bảng dữ liệu rộng rãi hơn. Nút bật/tắt luôn nằm ở hàng "Thêm dòng"
  // (hàng đó không bị ẩn) nên vẫn bấm lại được để hiện các phần đã ẩn.
  const [tableFocusMode, setTableFocusMode] = useState(false);
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

  const statusColumn = columns.find((c) => c.id === "status");
  const clientColumn = columns.find((c) => c.id === "clientName");
  // Bọc trong useMemo riêng (thay vì `statusColumn?.options ?? []` trực tiếp) — nếu không,
  // React Compiler không chứng minh được tham chiếu mảng ổn định qua các lần render (đặc
  // biệt khi statusColumn undefined, `?? []` tạo mảng rỗng MỚI mỗi lần), khiến nó bỏ qua tối
  // ưu memo hoá cho sendButtonsStatusIds bên dưới.
  const statusOptions = useMemo(() => statusColumn?.options ?? [], [statusColumn]);
  const sendButtonsStatusIds = useMemo(
    () =>
      new Set(
        statusOptions.filter((o) => canShowSendButtonsForStatusLabel(o.label)).map((o) => o.id)
      ),
    [statusOptions]
  );
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
      if (
        caseSummaryMode === "case" &&
        caseYearStatusFilter !== "all" &&
        !refundYearRows(c.refunds, c.refundYearStatus).some((r) => r.status === caseYearStatusFilter)
      ) {
        return false;
      }
      // 2 bộ lọc dưới đây CHỈ áp dụng đúng role liên quan (xem khai báo state) — không
      // chặn theo role thì role không có UI cho bộ lọc này cũng bị ảnh hưởng bởi state
      // mặc định, ẩn nhầm hồ sơ.
      if ((user?.role === "processor_leader" || user?.role === "agent") && processorFilter !== "all") {
        // "Processor 2" cùng chức năng với "Processor" (thêm 2026-08-12) — khớp filter
        // nếu người được chọn nằm ở BẤT KỲ slot nào trong 2 slot.
        const matches =
          processorFilter === "unassigned"
            ? c.assignedProcessor == null && c.assignedProcessor2 == null
            : c.assignedProcessor === processorFilter || c.assignedProcessor2 === processorFilter;
        if (!matches) return false;
      }
      if ((user?.role === "agent_leader" || user?.role === "processor") && agentFilter !== "all") {
        const matches =
          agentFilter === "unassigned"
            ? c.assignedTo == null && c.assignedTo2 == null
            : c.assignedTo === agentFilter || c.assignedTo2 === agentFilter;
        if (!matches) return false;
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
  }, [
    visibleCases,
    search,
    statusFilter,
    processorFilter,
    agentFilter,
    tab,
    user?.role,
    caseSummaryMode,
    caseYearStatusFilter,
  ]);

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

  // Dữ liệu cho chế độ "Xem theo Case" của dãy chip tổng hợp — thay vì đếm theo hồ sơ
  // (row) như `stats` ở trên, đếm theo TỪNG NĂM có refund > 0 (đúng dữ liệu hiện trong
  // popup mắt cột "Case", xem refundYearRows trong refund-status.ts), nhóm theo trạng
  // thái RIÊNG của năm đó (refundYearStatusOptions) — 1 hồ sơ có nhiều năm sẽ tính nhiều
  // đơn vị, khác `stats.total` (luôn = số hồ sơ).
  const caseYearStats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    let totalYears = 0;
    let totalYearsMoney = 0;
    for (const c of visibleCases) {
      for (const row of refundYearRows(c.refunds, c.refundYearStatus)) {
        byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
        totalYears += 1;
        totalYearsMoney += row.amount;
      }
    }
    return { byStatus, totalYears, totalYearsMoney };
  }, [visibleCases]);

  // Bản "theo Case" của stats.byTab — dùng riêng cho màn hình Dashboard (view === "dashboard",
  // 2026-08-13: tổng hợp theo cột Case, không theo Client/hồ sơ như stats ở trên, vốn vẫn
  // giữ nguyên vì còn phục vụ chế độ "Xem theo Client" của dãy chip tổng hợp phía trên bảng).
  const caseUnitByTab = useMemo(() => {
    const byTab: Record<CaseTab, number> = { all: 0, cannot_process: 0, active: 0, done: 0 };
    for (const c of visibleCases) {
      const units = caseUnitCount(c);
      byTab[getCaseTab(c.status)] += units;
      byTab.all += units;
    }
    return byTab;
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

  // Đếm theo cột Case (số năm có refund > 0), không theo số hồ sơ — đồng bộ với cách tính
  // mới của toàn màn hình Dashboard (2026-08-13, xem caseUnitCount).
  const newByStatusInRange = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of newInRange) map[c.status] = (map[c.status] ?? 0) + caseUnitCount(c);
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
      const isMine = (c: CaseRecord) =>
        c.assignedTo === u.id ||
        c.assignedTo2 === u.id ||
        c.assignedProcessor === u.id ||
        c.assignedProcessor2 === u.id;
      const newCount = sumCaseUnits(newInRange.filter(isMine));
      const processingCount = sumCaseUnits(visibleCases.filter((c) => isMine(c) && getCaseTab(c.status) === "active"));
      const completedCount = sumCaseUnits(completedInRange.filter(isMine));
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
  const canSendCpaEmailFeature = hasFeature(permissions, "sendCpaEmail", user.role);
  const canSendToSheetFeature = hasFeature(permissions, "sendToGoogleSheet", user.role);
  const canSendClientEmailFeature = hasFeature(permissions, "sendClientEmail", user.role);
  const canSendSmsFeature = hasFeature(permissions, "sendSms", user.role);
  const canSendCollectingReportFeature = hasFeature(permissions, "addCollectingRow", user.role);

  const tabStatusOptions = tab === "all" ? statusOptions : statusOptions.filter((o) => getCaseTab(o.id) === tab);

  const otherColumns = columns.filter(
    (col) =>
      col.key !== "clientName" &&
      col.id !== "status" &&
      col.id !== "orderStatusOrder8821" &&
      col.id !== "orderStatusOrderTtsWit" &&
      !col.hidden &&
      !col.hiddenFromGrid
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
      {!tableFocusMode && (
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex shrink-0 gap-1.5 rounded-lg border border-border bg-surface p-1">
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

        {/* Đứng yên, chỉ nhấp nháy CHẬM (mờ dần rồi rõ lại — xem .greeting-blink trong
            globals.css) — nằm cùng hàng với nút List/Dashboard thay vì hàng riêng bên dưới. */}
        <h1 className="greeting-blink flex-1 whitespace-nowrap text-center text-sm font-semibold tracking-tight sm:text-lg">
          {t("cases.greeting")} {user.name.split(" ").slice(-1)[0]}
          {greetingPeriod && (
            <>
              {" "}
              - {t(`cases.greetingPeriod.${greetingPeriod}`)} {greetingEmoji(greetingPeriod)}
            </>
          )}
        </h1>
      </div>
      )}
      {view === "list" && !tableFocusMode && (
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-6">
        {/* Chọn cách đếm dãy chip bên dưới — "case" (mặc định): đếm theo từng năm refund
            (dữ liệu popup mắt cột Case), "client": đếm theo hồ sơ như trước đây. Luôn hiện
            (không chỉ desktop) vì áp dụng cho cả 2 cách hiển thị thống kê bên dưới. Ô tính
            "EC Qualification" (2026-08-13) đặt ngang hàng, đẩy sang góc phải bằng
            justify-between — thuần công cụ tính tay, không liên quan bộ đếm case/client. */}
        <div className="hidden flex-wrap items-center justify-between gap-2 sm:flex">
          <div className="flex shrink-0 gap-1 self-start rounded-lg border border-border bg-surface p-1">
            <button
              onClick={() => {
                setCaseSummaryMode("client");
                setCaseYearStatusFilter("all");
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                caseSummaryMode === "client" ? "gradient-btn text-white" : "text-text-faint hover:text-text-dim"
              }`}
            >
              {t("cases.summaryMode.client")}
            </button>
            <button
              onClick={() => setCaseSummaryMode("case")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                caseSummaryMode === "case" ? "gradient-btn text-white" : "text-text-faint hover:text-text-dim"
              }`}
            >
              {t("cases.summaryMode.case")}
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ForProcessorButton />
            <EcQualificationBox />
          </div>
        </div>

        <div className="hidden flex-wrap items-center gap-2 sm:flex">
          <StatChip
            label={t("common.total")}
            value={String(caseSummaryMode === "case" ? caseYearStats.totalYears : stats.total)}
            icon={FileText}
            onClick={caseSummaryMode === "case" ? () => setCaseYearStatusFilter("all") : undefined}
          />
          {caseSummaryMode === "case"
            ? refundYearStatusOptions.map((o) => (
                <CaseYearStatusChip
                  key={o.id}
                  option={o}
                  value={caseYearStats.byStatus[o.id] ?? 0}
                  active={caseYearStatusFilter === o.id}
                  onClick={() => setCaseYearStatusFilter((prev) => (prev === o.id ? "all" : o.id))}
                />
              ))
            : statusOptions.map((o) => (
                <StatusStatChip key={o.id} option={o} value={stats.byStatus[o.id] ?? 0} />
              ))}
          <StatChip
            label={t("common.value")}
            value={`$${(caseSummaryMode === "case" ? caseYearStats.totalYearsMoney : stats.totalMoney).toLocaleString("en-US")}`}
            icon={DollarSign}
          />
        </div>

        <button
          onClick={() => setStatsPopupOpen(true)}
          className="flex items-center gap-1.5 self-start rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text sm:hidden"
        >
          <BarChart3 size={14} />
          {t("cases.viewStats")}
        </button>

        {statsPopupOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 sm:hidden"
              onClick={() => setStatsPopupOpen(false)}
            >
              <div
                className="popover w-full max-w-sm rounded-2xl p-4 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t("cases.viewStats")}</h3>
                  <button onClick={() => setStatsPopupOpen(false)} className="text-text-faint hover:text-text">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  <StatChip
                    label={t("common.total")}
                    value={String(caseSummaryMode === "case" ? caseYearStats.totalYears : stats.total)}
                    icon={FileText}
                    onClick={caseSummaryMode === "case" ? () => setCaseYearStatusFilter("all") : undefined}
                  />
                  {caseSummaryMode === "case"
                    ? refundYearStatusOptions.map((o) => (
                        <CaseYearStatusChip
                          key={o.id}
                          option={o}
                          value={caseYearStats.byStatus[o.id] ?? 0}
                          active={caseYearStatusFilter === o.id}
                          onClick={() => setCaseYearStatusFilter((prev) => (prev === o.id ? "all" : o.id))}
                        />
                      ))
                    : statusOptions.map((o) => (
                        <StatusStatChip key={o.id} option={o} value={stats.byStatus[o.id] ?? 0} />
                      ))}
                  <StatChip
                    label={t("common.value")}
                    value={`$${(caseSummaryMode === "case" ? caseYearStats.totalYearsMoney : stats.totalMoney).toLocaleString("en-US")}`}
                    icon={DollarSign}
                  />
                </div>
              </div>
            </div>,
            document.body
          )}
      </div>
      )}

      {view === "list" && (
      <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <div className="hidden items-center gap-1.5 sm:flex">
          <button
            onClick={() => setTableFocusMode((v) => !v)}
            title={tableFocusMode ? t("cases.focusMode.show") : t("cases.focusMode.hide")}
            className="flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text"
          >
            {tableFocusMode ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {tableFocusMode ? t("cases.focusMode.show") : t("cases.focusMode.hide")}
          </button>

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

          {/* Nút "Thêm" trên di động — mở popup gộp mọi điều khiển còn lại (xem moreMenuOpen).
              Trên desktop các điều khiển đó vẫn hiện thẳng ở nhóm hidden sm:flex bên dưới. */}
          <button
            onClick={() => setMoreMenuOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text sm:hidden"
          >
            <SlidersHorizontal size={14} />
            {t("cases.moreOptions")}
          </button>

          <div className="hidden flex-wrap items-center gap-2 sm:flex">
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
      </div>

      {/* Popup "Thêm" trên di động — gộp mọi điều khiển KHÔNG phải Bảng/Tìm kiếm/Xem thống
          kê (xem moreMenuOpen ở trên): đổi chế độ đếm, EC Qualification, focus mode, tải
          mẫu/upload Excel, lọc Status/Processor/Agent, thêm cột, lịch sử, thêm dòng. Cùng
          component (AddColumnDialog/HistoryDialog...) được render LẠI ở đây (khác instance
          với bản desktop ẩn qua hidden sm:flex) — mỗi dialog tự quản lý trạng thái mở/đóng
          riêng nên dùng song song an toàn, cùng cách "Xem thống kê" đã làm ở trên. */}
      {moreMenuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/80 sm:hidden"
            onClick={() => setMoreMenuOpen(false)}
          >
            <div
              className="popover flex max-h-[85vh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("cases.moreOptions")}</h3>
                <button onClick={() => setMoreMenuOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex shrink-0 gap-1 rounded-lg border border-border bg-surface p-1">
                  <button
                    onClick={() => {
                      setCaseSummaryMode("client");
                      setCaseYearStatusFilter("all");
                    }}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                      caseSummaryMode === "client" ? "gradient-btn text-white" : "text-text-faint hover:text-text-dim"
                    }`}
                  >
                    {t("cases.summaryMode.client")}
                  </button>
                  <button
                    onClick={() => setCaseSummaryMode("case")}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                      caseSummaryMode === "case" ? "gradient-btn text-white" : "text-text-faint hover:text-text-dim"
                    }`}
                  >
                    {t("cases.summaryMode.case")}
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ForProcessorButton />
                  <EcQualificationBox />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setTableFocusMode((v) => !v)}
                  title={tableFocusMode ? t("cases.focusMode.show") : t("cases.focusMode.hide")}
                  className="flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text"
                >
                  {tableFocusMode ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                  {tableFocusMode ? t("cases.focusMode.show") : t("cases.focusMode.hide")}
                </button>

                <button
                  onClick={downloadCaseTemplate}
                  title={t("cases.downloadTemplate")}
                  className="flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text"
                >
                  <Download size={12} />
                  {t("cases.downloadTemplate")}
                </button>

                {canAddRowFeature && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importing}
                    title={t("cases.uploadExcel")}
                    className="flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
                  >
                    <Upload size={12} />
                    {importing ? t("cases.importing") : t("cases.uploadExcel")}
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
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
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
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
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
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
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canAddColumnFeature && <AddColumnDialog onAdd={addColumn} />}
                <HistoryDialog editHistory={editHistory} deletionHistory={deletionHistory} users={users} />
              </div>

              {canAddRowFeature && (
                <button
                  onClick={async () => {
                    if (await confirm(t("cases.addRowConfirm"), { title: t("cases.addRowTitle") })) {
                      addRow(user.id, user.role);
                    }
                    setMoreMenuOpen(false);
                  }}
                  className="gradient-btn flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-white shadow-lg shadow-blue-950/30"
                >
                  <Plus size={14} />
                  {t("common.addRow")}
                </button>
              )}
            </div>
          </div>,
          document.body
        )}

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
                  onSetHidden={(hidden) => setColumnHiddenFromGrid(col.id, hidden)}
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
          {filtered.map((row, rowIndex) => (
            <RowCells
              key={row.id}
              row={row}
              rowIndex={rowIndex}
              highlighted={row.id === highlightId}
              allCases={cases}
              columns={columns}
              otherColumns={otherColumns}
              statusColumn={statusColumn}
              sendButtonsStatusIds={sendButtonsStatusIds}
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
              updateRefundYearStatus={updateRefundYearStatus}
              updateRefundYearPendingReason={updateRefundYearPendingReason}
              updateClientProfile={updateClientProfile}
              addDescriptionReply={addDescriptionReply}
              markDescriptionRead={markDescriptionRead}
              canAssignFeature={canAssignFeature}
              canDeleteRowFeature={canDeleteRowFeature}
              canSendCpaEmailFeature={canSendCpaEmailFeature}
              cpaEmailDefaults={cpaEmailDefaults}
              cpaSenderEmail={cpaSenderEmail}
              sendCpaEmail={sendCpaEmail}
              markCpaEmailSent={markCpaEmailSent}
              canSendToSheetFeature={canSendToSheetFeature}
              sendCaseRowToSheet={sendCaseRowToSheet}
              markCaseSheetSent={markCaseSheetSent}
              connectGoogleAccount={connectGoogleAccount}
              sendCaseRowToCpaReview={sendCaseRowToCpaReview}
              markCaseCpaReviewTestSent={markCaseCpaReviewTestSent}
              canSendCollectingReportFeature={canSendCollectingReportFeature}
              sendCaseYearToCollecting={sendCaseYearToCollecting}
              canSendClientEmailFeature={canSendClientEmailFeature}
              previewRefundEmail={previewRefundEmail}
              sendClientEmail={sendClientEmail}
              markClientEmailSent={markClientEmailSent}
              connectWebmailAccount={connectWebmailAccount}
              canSendSmsFeature={canSendSmsFeature}
              fetchSmsThread={fetchSmsThread}
              sendSmsMessage={sendSmsMessage}
              markSmsThreadRead={markSmsThreadRead}
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
              <ReportStatCard icon={Layers} label={t("common.total")} value={String(caseYearStats.totalYears)} tone="accent" />
              <ReportStatCard
                icon={DollarSign}
                label={t("common.value")}
                value={`$${stats.totalMoney.toLocaleString("en-US")}`}
                tone="accent"
              />
              <ReportStatCard icon={CheckCircle2} label={t("cases.tab.done")} value={String(caseUnitByTab.done)} tone="emerald" />
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
                value={String(sumCaseUnits(newInRange))}
                tone="amber"
                growthPercent={growthPercent(sumCaseUnits(newInRange), sumCaseUnits(newInPrevRange))}
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
                value={String(sumCaseUnits(completedInRange))}
                tone="emerald"
                growthPercent={growthPercent(sumCaseUnits(completedInRange), sumCaseUnits(completedInPrevRange))}
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
  rowIndex,
  highlighted,
  allCases,
  columns,
  otherColumns,
  statusColumn,
  sendButtonsStatusIds,
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
  updateRefundYearStatus,
  updateRefundYearPendingReason,
  updateClientProfile,
  addDescriptionReply,
  markDescriptionRead,
  canAssignFeature,
  canDeleteRowFeature,
  canSendCpaEmailFeature,
  cpaEmailDefaults,
  cpaSenderEmail,
  sendCpaEmail,
  markCpaEmailSent,
  canSendToSheetFeature,
  sendCaseRowToSheet,
  markCaseSheetSent,
  connectGoogleAccount,
  sendCaseRowToCpaReview,
  markCaseCpaReviewTestSent,
  canSendCollectingReportFeature,
  sendCaseYearToCollecting,
  canSendClientEmailFeature,
  previewRefundEmail,
  sendClientEmail,
  markClientEmailSent,
  connectWebmailAccount,
  canSendSmsFeature,
  fetchSmsThread,
  sendSmsMessage,
  markSmsThreadRead,
  confirm,
  alertWarn,
  dragRowId,
  onRowDragStart,
  onRowDrop,
  onRowDragEnd,
}: {
  row: CaseRecord;
  rowIndex: number;
  highlighted: boolean;
  allCases: CaseRecord[];
  columns: ColumnDef[];
  otherColumns: ColumnDef[];
  statusColumn: ColumnDef | undefined;
  sendButtonsStatusIds: Set<string>;
  clientColumn: ColumnDef | undefined;
  statusLeft: number;
  clientLeft: number;
  user: User;
  users: User[];
  agentUsers: User[];
  processorUsers: User[];
  updateCell: (
    caseId: string,
    columnKey: string,
    value: string | number | boolean | null | CheckInitialValue,
    isCustom: boolean
  ) => void;
  placeOrder: (
    caseId: string,
    field: "order8821" | "orderTtsWit",
    byUserId: string,
    clientSlots?: (0 | 1)[],
    description?: string
  ) => void;
  deleteRow: (caseId: string, deletedByUserId: string) => void;
  assignCase: (
    caseId: string,
    toUserId: string | null,
    field: "assignedTo" | "assignedProcessor" | "assignedTo2" | "assignedProcessor2"
  ) => void;
  updateClientLink: (caseId: string, link: string | null) => void;
  updateSsn: (caseId: string, slot: 0 | 1, value: string | null) => void;
  updateRefundYearStatus: (caseId: string, year: string, status: RefundYearStatus) => void;
  updateRefundYearPendingReason: (caseId: string, year: string, reason: string) => void;
  updateClientProfile: (caseId: string, payload: ClientProfilePayload) => Promise<{ ok: true } | { ok: false; error: string }>;
  addDescriptionReply: (caseId: string, authorId: string, text: string) => void;
  markDescriptionRead: (caseId: string, userId: string) => void;
  canAssignFeature: boolean;
  canDeleteRowFeature: boolean;
  canSendCpaEmailFeature: boolean;
  cpaEmailDefaults: CpaEmailDefaults;
  cpaSenderEmail: string;
  sendCpaEmail: (
    caseId: string,
    payload: {
      to: string[];
      cc: string[];
      subject: string;
      html: string;
      text: string;
      attachments: { filename: string; contentType: string; contentBase64: string }[];
    }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  markCpaEmailSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
  canSendToSheetFeature: boolean;
  sendCaseRowToSheet: (
    caseId: string
  ) => Promise<{ ok: true } | { ok: false; error: string; needsGoogleAuth?: boolean }>;
  markCaseSheetSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
  connectGoogleAccount: () => Promise<boolean>;
  sendCaseRowToCpaReview: (
    caseId: string,
    reviewYears: string[],
    note?: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  markCaseCpaReviewTestSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
  canSendCollectingReportFeature: boolean;
  sendCaseYearToCollecting: (
    caseId: string,
    year: string,
    manual: CollectingReportManualFields
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  canSendClientEmailFeature: boolean;
  previewRefundEmail: (
    caseId: string,
    payload: { years: string[]; language: "vi" | "en"; taxInt: Record<string, string> }
  ) => Promise<
    | { ok: true; subject: string; bodyHtml: string; to: string[]; cc: string[] }
    | { ok: false; error: string }
  >;
  sendClientEmail: (
    caseId: string,
    payload: {
      years: string[];
      taxInt: Record<string, string>;
      subject: string;
      bodyHtml: string;
      to: string[];
      cc: string[];
      attachments?: { filename: string; contentType: string; contentBase64: string }[];
    }
  ) => Promise<{ ok: true } | { ok: false; error: string; needsWebmailAuth?: boolean }>;
  markClientEmailSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
  connectWebmailAccount: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  canSendSmsFeature: boolean;
  fetchSmsThread: (caseId: string) => Promise<SmsMessageRecord[]>;
  sendSmsMessage: (caseId: string, text: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  markSmsThreadRead: (caseId: string) => Promise<void>;
  confirm: (message: string, opts?: { title?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  alertWarn: (message: string, opts?: { title?: string }) => Promise<void>;
  dragRowId: string | null;
  onRowDragStart: () => void;
  onRowDrop: () => void;
  onRowDragEnd: () => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  const cpaEmailStatusLabel = (() => {
    const opt = statusColumn?.options?.find((o) => o.id === row.status);
    return opt ? translateOptionLabel(language, opt.id, opt.label) : row.status;
  })();
  const clientColDef: ColumnDef = clientColumn ?? {
    id: "clientName",
    key: "clientName",
    label: "Client Name",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "support"],
  };
  // Agent Leader/Processor Leader chỉ sửa được hồ sơ do chính mình thêm vào hoặc đang
  // gán cho thành viên trong nhóm mình — các role khác giữ quyền sửa như cũ (đã lọc
  // đúng phạm vi từ visibleCases nên không cần giới hạn thêm theo dòng).
  const canEditRow = canEditCase(user.role, user.id, row, user.teamMemberIds);
  // Nút mắt cạnh cột "Case" dùng CHUNG nguồn phân quyền với cột ẩn "refunds" (đúng cách
  // server đã map ở FIELD_TO_COLUMN_KEY trong PATCH /api/cases/[id]) — hợp lý vì trạng
  // thái này gắn liền với dữ liệu refund.
  const refundsColumn = columns.find((c) => c.id === "refunds");
  const canEditRefundStatus = Boolean(refundsColumn) && canEditColumn(user.role, refundsColumn!) && canEditRow;
  // Đọc trực tiếp qua hook thay vì thread thêm prop qua chuỗi prop đã rất dài của RowCells
  // — component này gọi hook được vì vẫn là function component bình thường. Chỉ Admin
  // (manager) được thêm/sửa/xoá trạng thái trong danh sách (yêu cầu 2026-08-12).
  const refundYearStatusOptions = useAppStore((s) => s.refundYearStatusOptions);
  const addRefundYearStatusOption = useAppStore((s) => s.addRefundYearStatusOption);
  const updateRefundYearStatusOption = useAppStore((s) => s.updateRefundYearStatusOption);
  const removeRefundYearStatusOption = useAppStore((s) => s.removeRefundYearStatusOption);
  const canManageRefundYearStatusOptions = user.role === "manager";
  // Nút "Send Data" gộp (SendActionsMenuButton) tự đổi màu xanh lá khi TẤT CẢ hành động
  // đang hiện cho hồ sơ này đã ở trạng thái "đã gửi" (thêm 2026-08-16) — chỉ tính những
  // hành động THỰC SỰ hiện ra (đúng điều kiện quyền/status/email như JSX bên dưới), bỏ qua
  // hành động không áp dụng cho hồ sơ này (vd không có quyền, hoặc chưa có email).
  const showSendToSheetAction = sendButtonsStatusIds.has(row.status) && canSendToSheetFeature;
  const showCpaEmailAction = sendButtonsStatusIds.has(row.status) && canSendCpaEmailFeature;
  const showTestSheetAction = sendButtonsStatusIds.has(row.status) && (canSendToSheetFeature || canSendCpaEmailFeature);
  const showClientEmailAction = canSendClientEmailFeature && Boolean(row.email.trim());
  const sendActionSentFlags = [
    showSendToSheetAction ? Boolean(row.sheetSentAt) : null,
    showCpaEmailAction ? Boolean(row.cpaEmailSentAt) : null,
    showTestSheetAction ? Boolean(row.cpaReviewTestSentAt) : null,
    showClientEmailAction ? Boolean(row.clientEmailSentAt) : null,
  ].filter((v): v is boolean => v !== null);
  const allSendActionsSent = sendActionSentFlags.length > 0 && sendActionSentFlags.every(Boolean);
  return (
    <div
      data-row-id={row.id}
      className={`group contents ${dragRowId === row.id ? "opacity-40" : ""} ${highlighted ? "row-highlight" : ""}`}
      // Zebra striping — --row-bg kế thừa xuyên "display: contents" (element này không tạo
      // box riêng nên không tự vẽ được background) xuống mọi cell con bên dưới, mỗi cell
      // đọc lại qua class bg-[var(--row-bg)] (xem globals.css cho định nghĩa --row-alt-bg).
      style={{ "--row-bg": rowIndex % 2 === 0 ? "var(--bg)" : "var(--row-alt-bg)" } as React.CSSProperties}
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
        className="sticky z-10 flex cursor-grab items-center justify-center border-b border-r border-border bg-[var(--row-bg)] text-text-faint transition-colors group-hover:bg-surface-hover active:cursor-grabbing"
        style={{ left: 0 }}
      >
        <GripVertical size={13} />
      </div>
      <div
        className="sticky z-10 flex h-full min-w-0 items-center justify-center border-b border-r border-border bg-[var(--row-bg)] transition-colors group-hover:bg-surface-hover"
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
        {(showSendToSheetAction ||
          showCpaEmailAction ||
          showTestSheetAction ||
          showClientEmailAction ||
          canSendSmsFeature) && (
          // -translate-x-1 — dịch sang trái 1 chút, tránh nằm sát nút Edit Hồ sơ ở cột
          // Client Name ngay bên phải, dễ bấm nhầm. Gộp 4 nút gửi thành 1 nút (icon
          // send-data.png, thêm 2026-08-16) mở popup liệt kê — trước đó xếp dọc thành 1 cụm
          // icon chật hẹp ngay cạnh Status. Icon SMS (thêm 2026-08-17) xếp NGAY DƯỚI nút Send
          // Data trong cùng 1 cột dọc — luôn hiện nếu có quyền sendSms, KHÔNG phụ thuộc
          // status/showXxxAction như 4 nút kia (nhắn tin không gắn với trạng thái hồ sơ).
          <div className="-translate-x-1 flex flex-col items-center gap-1">
            {(showSendToSheetAction || showCpaEmailAction || showTestSheetAction || showClientEmailAction) && (
            <SendActionsMenuButton allSent={allSendActionsSent}>
              {showSendToSheetAction && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text-dim">{t("sheet.sendBtn")}</span>
                  <SendToSheetButton
                    caseId={row.id}
                    sheetSentAt={row.sheetSentAt}
                    refunds={row.refunds}
                    confirm={confirm}
                    alertWarn={alertWarn}
                    sendCaseRowToSheet={sendCaseRowToSheet}
                    markCaseSheetSent={markCaseSheetSent}
                    connectGoogleAccount={connectGoogleAccount}
                  />
                </div>
              )}
              {showCpaEmailAction && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text-dim">{t("cpaEmail.dialogTitle")}</span>
                  <SendCpaEmailDialog
                    disabled={false}
                    caseRecord={row}
                    defaults={cpaEmailDefaults}
                    statusLabel={cpaEmailStatusLabel}
                    senderEmail={cpaSenderEmail}
                    senderName={user.name}
                    confirm={confirm}
                    onSend={(payload) => sendCpaEmail(row.id, payload)}
                    markCpaEmailSent={markCpaEmailSent}
                  />
                </div>
              )}
              {showTestSheetAction && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text-dim">{t("testSheet.notSentTitle")}</span>
                  <TestSheetButton
                    caseId={row.id}
                    cpaReviewTestSentAt={row.cpaReviewTestSentAt}
                    refunds={row.refunds}
                    crmSourceOptions={caseStatusOptionsForCrmSource(columns)}
                    confirm={confirm}
                    alertWarn={alertWarn}
                    sendCaseRowToCpaReview={sendCaseRowToCpaReview}
                    markCaseCpaReviewTestSent={markCaseCpaReviewTestSent}
                  />
                </div>
              )}
              {showClientEmailAction && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text-dim">{t("clientEmail.confirmSendTitle")}</span>
                  <SendClientEmailButton
                    caseId={row.id}
                    refunds={row.refunds}
                    taxIntByYear={row.taxIntByYear}
                    clientEmailSentAt={row.clientEmailSentAt}
                    confirm={confirm}
                    alertWarn={alertWarn}
                    previewRefundEmail={previewRefundEmail}
                    sendClientEmail={sendClientEmail}
                    markClientEmailSent={markClientEmailSent}
                    connectWebmailAccount={connectWebmailAccount}
                  />
                </div>
              )}
            </SendActionsMenuButton>
            )}
            {canSendSmsFeature && (
              <CaseSmsButton
                caseId={row.id}
                phone={row.phone}
                hasUnreadSms={row.hasUnreadSms}
                alertWarn={alertWarn}
                fetchSmsThread={fetchSmsThread}
                sendSmsMessage={sendSmsMessage}
                markSmsThreadRead={markSmsThreadRead}
              />
            )}
          </div>
        )}
      </div>
      <div
        className="sticky z-10 border-b border-r border-border bg-[var(--row-bg)] transition-colors group-hover:bg-surface-hover"
        style={{ left: clientLeft }}
      >
        <ClientNameCell
          caseRecord={row}
          columns={columns}
          role={user.role}
          linkEditable={canEditColumn(user.role, clientColDef) && canEditRow}
          onCommitLink={(link) => updateClientLink(row.id, link)}
          onSaveProfile={(payload) => updateClientProfile(row.id, payload)}
          isDuplicateSsn={(slot, candidate) => isDuplicateSsn(allCases, candidate, row.id, slot)}
        />
      </div>
      {otherColumns.map((col) =>
        // First/Last Name, SSN, Phone, Zipcode, Address giờ CHỈ sửa được qua popup "Edit
        // Hồ sơ" (ClientProfileDialog, nút bút chì trong ô Client Name) — khoá cứng
        // editable=false tại đây bất kể quyền editableBy của cột (editableBy vẫn giữ
        // nguyên, dùng làm nguồn phân quyền CHO POPUP, không phải cho ô ngoài bảng này).
        col.id === "ssn" ? (
          <div key={col.id} className="flex h-full items-center justify-center border-b border-r border-border bg-[var(--row-bg)] transition-colors group-hover:bg-surface-hover">
            <SsnCell
              value={row.ssn}
              editable={false}
              isDuplicate={(slot, candidate) => isDuplicateSsn(allCases, candidate, row.id, slot)}
              onCommit={(slot, v) => updateSsn(row.id, slot, v)}
            />
          </div>
        ) : col.id === "phone" ? (
          // Hiển thị cả Phone 1 lẫn Phone 2 (nhập ở popup Edit Hồ sơ) nếu có — 2 dòng
          // giống cách SsnCell hiện 2 số SSN, khoá read-only hoàn toàn (sửa qua popup).
          <div
            key={col.id}
            className="flex h-full flex-col items-center justify-center gap-0.5 border-b border-r border-border bg-[var(--row-bg)] py-1 text-center text-[11px] font-semibold text-text transition-colors group-hover:bg-surface-hover"
          >
            <span>{row.phone || <span className="font-normal text-text-faint">—</span>}</span>
            {row.phone2 && <span>{row.phone2}</span>}
          </div>
        ) : col.id === "description" ? (
          <div
            key={col.id}
            className="flex h-full items-center justify-center border-b border-r border-border bg-[var(--row-bg)] transition-colors group-hover:bg-surface-hover"
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
          <div key={col.id} className="border-b border-r border-border bg-[var(--row-bg)] transition-colors group-hover:bg-surface-hover">
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
        ) : col.id === "caseLabel" ? (
          <div
            key={col.id}
            className="flex h-full items-center justify-center gap-1 border-b border-r border-border bg-[var(--row-bg)] px-1 transition-colors group-hover:bg-surface-hover"
          >
            <span className="text-[11px] font-semibold text-text">
              {typeof row.custom[col.key] === "number" || typeof row.custom[col.key] === "string"
                ? String(row.custom[col.key])
                : "0"}
            </span>
            <CaseRefundStatusButton
              refunds={row.refunds ?? {}}
              refundYearStatus={row.refundYearStatus ?? {}}
              refundYearPendingReason={row.refundYearPendingReason ?? {}}
              statusOptions={refundYearStatusOptions}
              editable={canEditRefundStatus}
              canManageOptions={canManageRefundYearStatusOptions}
              onChangeStatus={(year, status) => updateRefundYearStatus(row.id, year, status)}
              onChangeReason={(year, reason) => updateRefundYearPendingReason(row.id, year, reason)}
              onAddOption={addRefundYearStatusOption}
              onUpdateOption={updateRefundYearStatusOption}
              onRemoveOption={removeRefundYearStatusOption}
              canSendCollectingReport={canSendCollectingReportFeature}
              onSendCollectingReport={async (year, manual) => {
                const result = await sendCaseYearToCollecting(row.id, year, manual);
                if (!result.ok) await alertWarn(result.error, { title: t("collectingReport.sendErrorTitle") });
              }}
            />
          </div>
        ) : col.id === CHECK_INITIAL_COLUMN_ID ? (
          <div key={col.id} className="flex h-full items-center border-b border-r border-border bg-[var(--row-bg)] transition-colors group-hover:bg-surface-hover">
            <CheckInitialCell
              value={row.custom[col.key] as CheckInitialValue | undefined}
              editable={canEditColumn(user.role, col) && canEditRow}
              onCommit={(next) => updateCell(row.id, col.key, next, true)}
            />
          </div>
        ) : (
          <div
            key={col.id}
            className="flex h-full items-center justify-center border-b border-r border-border bg-[var(--row-bg)] transition-colors group-hover:bg-surface-hover"
          >
            <EditableCell
              value={
                // Nhánh này không bao giờ chạy cho cột "checkInitial" (đã chặn ở ternary
                // riêng phía trên) nên custom[col.key] thực tế luôn là string/number/
                // boolean/null ở đây — ép kiểu bỏ CheckInitialValue cho khớp Value của
                // EditableCell (union chỉ rộng ra vì CaseRecord.custom giờ dùng chung cho
                // cả object value của checkInitial).
                col.custom
                  ? ((row.custom[col.key] ?? null) as string | number | boolean | null)
                  : (row as unknown as Record<string, string | number | boolean | null>)[col.key]
              }
              type={col.type}
              options={col.options}
              editable={
                !LOCKED_OUTSIDE_PROFILE_DIALOG.has(col.id) && canEditColumn(user.role, col) && canEditRow
              }
              onCommit={(v) => updateCell(row.id, col.key, v, Boolean(col.custom))}
              dense={DENSE_BOLD_COLUMNS.has(col.id)}
            />
          </div>
        )
      )}
      <div className="flex h-full min-w-0 flex-col divide-y divide-border border-b border-r border-border bg-[var(--row-bg)] transition-colors group-hover:bg-surface-hover">
        <div className="flex min-h-0 flex-1 items-center gap-0.5">
          <span className="w-3 shrink-0 text-center text-[9px] font-semibold text-text-faint">1</span>
          <AssignMenu
            users={agentUsers}
            assignedTo={row.assignedTo}
            canAssign={canAssignFeature && canEditRow}
            onAssign={(uid) => assignCase(row.id, uid, "assignedTo")}
          />
        </div>
        <div className="flex min-h-0 flex-1 items-center gap-0.5">
          <span className="w-3 shrink-0 text-center text-[9px] font-semibold text-text-faint">2</span>
          <AssignMenu
            users={agentUsers}
            assignedTo={row.assignedTo2}
            canAssign={canAssignFeature && canEditRow}
            onAssign={(uid) => assignCase(row.id, uid, "assignedTo2")}
          />
        </div>
      </div>
      <div className="flex h-full min-w-0 items-center gap-0.5 border-b border-r border-border bg-[var(--row-bg)] transition-colors group-hover:bg-surface-hover">
        <AssignMenu
          users={processorUsers}
          assignedTo={row.assignedProcessor}
          canAssign={canAssignFeature && canEditRow}
          onAssign={(uid) => assignCase(row.id, uid, "assignedProcessor")}
        />
      </div>
      <div className="border-b border-border bg-[var(--row-bg)] transition-colors group-hover:bg-surface-hover">
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
