import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/shallow";
import {
  DEFAULT_COLLECTING_COLUMNS,
  DEFAULT_COLUMNS,
  DEFAULT_FEATURE_PERMISSIONS,
  DEFAULT_PROCESSOR_REPORT_TASKS,
  DEFAULT_REFUND_YEAR_STATUS_OPTIONS,
} from "@/lib/rbac";
import { CPA_REVIEW_STATUS_OPTIONS } from "@/lib/cpa-review-columns";
import { currentMonthKey } from "@/lib/cpa-review-month";
import { todayIsoDate } from "@/lib/date-format";
import { INITIAL_CASES, INITIAL_NOTIFICATIONS, INITIAL_USERS } from "@/lib/mock-data";
import { getFullName, primarySsn } from "@/lib/client-name";
import { summarizeCheckInitial } from "@/lib/check-initial";
import { DEFAULT_REFUND_YEAR_STATUS, findRefundStatusOption } from "@/lib/refund-status";
import { api, syncInBackground, type ClientProfilePayload } from "@/lib/api-client";
import type { ParsedCaseRow, DuplicateSsnInfo } from "@/lib/excel";
import { formatSsn } from "@/lib/ssn";
import {
  AppNotification,
  CaseRecord,
  CheckInitialValue,
  ClientEmailTemplate,
  CollectingRecord,
  CollectingReportManualFields,
  CpaReviewRecord,
  ColumnDef,
  ColumnType,
  CpaEmailDefaults,
  DeletedRowRecord,
  EditHistoryRecord,
  FeatureKey,
  FeaturePermissions,
  CpaReviewSheetConfig,
  GoogleSheetConfig,
  Language,
  OrderRecord,
  OrderType,
  ProcessorReportEntry,
  ProcessorReportMonthlySummaryEntry,
  ProcessorReportTaskDef,
  RefundYearStatus,
  Role,
  RuleRecord,
  SelectOption,
  Theme,
  User,
} from "@/lib/types";

/**
 * Sinh id duy nhất KHÔNG dựa vào bộ đếm lưu trong bộ nhớ (module-level counter) —
 * bộ đếm kiểu đó reset về giá trị ban đầu mỗi lần tải lại trang, nên 2 bản ghi tạo
 * ở 2 lần tải trang khác nhau có thể bị trùng id (ví dụ 2 tài khoản cùng id khiến
 * đăng nhập tài khoản này lại hiện ra tài khoản kia). Dùng timestamp + số ngẫu
 * nhiên để đảm bảo không trùng dù reload bao nhiêu lần.
 */
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}


/** Excel cho phép xuống dòng trong 1 ô (Alt+Enter) — dùng cho ô "Client Name"/"SSN" khi
 * nhập Excel: dòng 1 là khách hàng chính, dòng 2 (nếu có) là vợ/chồng (Spouse). */
function splitCellLines(text: string): [string, string] {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [lines[0] ?? "", lines[1] ?? ""];
}

/** Tách tên theo TỪ CUỐI CÙNG -> Last Name, phần còn lại -> First Name (vd "Nguyen Van A"
 * -> First "Nguyen Van", Last "A"). Chỉ có 1 từ thì để nguyên vào Last Name. */
function splitNameLastWord(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const idx = trimmed.lastIndexOf(" ");
  if (idx === -1) return { firstName: "", lastName: trimmed };
  return { firstName: trimmed.slice(0, idx).trim(), lastName: trimmed.slice(idx + 1).trim() };
}


/**
 * Danh sách Status mặc định đã đổi theo thời gian. Khi đổi options mặc định, KHÔNG
 * đổi tên key lưu trữ (persist name) vì sẽ xóa sạch dữ liệu người dùng đang dùng
 * (account, hồ sơ, mật khẩu...). Thay vào đó bump `version` + khai báo `migrate` bên
 * dưới để chuyển đổi dữ liệu cũ sang schema mới mà không mất dữ liệu.
 */
const OLD_STATUS_ID_MAP: Record<string, string> = {
  new: "pre_processing",
  in_progress: "processing",
  emailed: "missing_docs",
  denied: "cancelled",
  completed: "approved",
};
const OLD_DEFAULT_STATUS_IDS = ["new", "in_progress", "emailed", "approved", "denied", "completed"];

function formatHistoryValue(value: unknown, col?: ColumnDef): string {
  if (value === null || value === undefined || value === "") return "—";
  if (col?.type === "select") {
    return col.options?.find((o) => o.id === value)?.label ?? String(value);
  }
  if (col?.type === "boolean") return value ? "Có" : "Không";
  if (col?.type === "currency" && typeof value === "number") return `$${value.toLocaleString("en-US")}`;
  if (col?.type === "checklist") return summarizeCheckInitial(value) || "—";
  return String(value);
}

interface PersistedShape {
  cases?: Array<Record<string, unknown>>;
  columns?: Array<Record<string, unknown>>;
  users?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface AppState {
  currentUserId: string | null;
  /** Ngôn ngữ hiển thị hiện tại của app — lưu persist để giữ lựa chọn qua các lần
   * đăng nhập/tải lại trang. */
  language: Language;
  /** Giao diện tối/sáng — lưu persist theo trình duyệt. Chỉ áp dụng ở các màn hình sau
   * đăng nhập (DashboardLayout tự set data-theme trên <html>); trang Login luôn giữ
   * nguyên nền tối cố định bất kể lựa chọn này. */
  theme: Theme;
  /** Tắt/bật âm thanh chuông khi có notification mới — lưu persist theo trình duyệt,
   * không theo tài khoản (đơn giản, đủ dùng cho 1 người dùng 1 máy). */
  notificationSoundMuted: boolean;
  cases: CaseRecord[];
  columns: ColumnDef[];
  notifications: AppNotification[];
  users: User[];
  featurePermissions: FeaturePermissions;
  cpaEmailDefaults: CpaEmailDefaults;
  /** Tài khoản Gmail dùng để gửi mail CPA (đọc từ GMAIL_USER phía server) — chỉ đọc, dùng
   * làm fallback cho chữ ký cuối mail nếu tên người dùng đang đăng nhập rỗng (không có
   * action set riêng, không sửa được qua UI). Chữ ký chính lấy tên user hiện tại — xem
   * cases/page.tsx (RowCells truyền user.name làm cpaSenderName cho SendCpaEmailDialog). */
  cpaSenderEmail: string;
  /** Sheet đích + cột nào/thứ tự nào được đẩy khi bấm nút "Send" ở cột Status (chỉ hiện
   * khi status = cpa_review) — null = Admin chưa cấu hình, nút Send báo lỗi rõ ràng. */
  googleSheetConfig: GoogleSheetConfig | null;
  /** Trạng thái kết nối Sheet "CPA Review" theo TỪNG THÁNG (Record<"YYYY-MM", config>, thêm
   * 2026-08-14 — mỗi tháng 1 Sheet/kết nối riêng, xem deployment-database-sync.md mục 4.22).
   * Thiếu key = tháng đó chưa kết nối. Không có webhookSecret/rowIndex (server lược bỏ khỏi
   * GET /api/config, chỉ trả 1 lần lúc connect). Ghi qua connectCpaReviewSheet/
   * resyncCpaReviewSheet/updateCpaReviewNameMapping/disconnectCpaReviewSheet (action riêng,
   * KHÔNG qua setGoogleSheetConfig/syncConfig chung vì route đích khác, có gọi Sheets API
   * thật). */
  cpaReviewSheetConfig: Record<string, Omit<CpaReviewSheetConfig, "webhookSecret" | "rowIndex">>;
  /** Tháng đang chọn trên tab CPA Review ("YYYY-MM") — mặc định tháng hiện tại, đổi qua bộ
   * chọn tháng (CpaReviewMonthPicker). Quyết định bảng nào hiện ra + dòng mới thêm/kết nối
   * Sheet áp dụng cho tháng nào. Thêm 2026-08-14. */
  cpaReviewSelectedMonth: string;
  /** Mẫu Subject/Body cố định cho tính năng "Gửi email cho khách hàng" (popup Edit Hồ sơ)
   * — null = Admin chưa cấu hình, dùng DEFAULT_CLIENT_EMAIL_SUBJECT/BODY. */
  clientEmailTemplate: ClientEmailTemplate | null;
  /** Danh sách trạng thái cho popup "Refund by years" (nút mắt cạnh cột Case) — Quản lý
   * thêm/sửa/xoá được qua CaseRefundStatusButton (xem addRefundYearStatusOption/
   * updateRefundYearStatusOption/removeRefundYearStatusOption bên dưới). Mặc định
   * DEFAULT_REFUND_YEAR_STATUS_OPTIONS (rbac.ts) nếu Admin chưa từng đổi. */
  refundYearStatusOptions: SelectOption[];
  deletionHistory: DeletedRowRecord[];
  editHistory: EditHistoryRecord[];
  /** Bảng tin "Rules" (tab riêng sau Orders) — nạp từ server ở hydrateFromServer, KHÔNG
   * persist localStorage (giống cases/users, luôn tin dữ liệu server mới nhất). */
  rules: RuleRecord[];
  /** Dữ liệu tab "Collecting" (bảng độc lập với bảng Hồ sơ) — nạp từ server ở
   * hydrateFromServer, KHÔNG persist localStorage (giống cases/rules). */
  collectingRecords: CollectingRecord[];
  /** Dữ liệu tab "CPA Review" (bảng độc lập hoàn toàn, không liên kết Case — yêu cầu
   * 2026-08-14) — nạp từ server ở hydrateFromServer, KHÔNG persist localStorage. */
  cpaReviewRecords: CpaReviewRecord[];
  /** Cấu hình cột riêng cho tab "Collecting" — mặc định DEFAULT_COLLECTING_COLUMNS (rbac.ts)
   * nếu Admin chưa từng đổi qua ColumnSettingsDialog. */
  collectingColumns: ColumnDef[];
  /** Danh sách trạng thái (Status) mỗi khối năm của tab "CPA Review" — Quản lý (hoặc role
   * được cấp feature "manageCpaReviewSheet") thêm/sửa/xoá + đổi màu qua UI, mặc định
   * CPA_REVIEW_STATUS_OPTIONS (cpa-review-columns.ts) nếu chưa từng đổi. Thêm 2026-08-14. */
  cpaReviewStatusOptions: SelectOption[];
  /** Key các cột "đuôi" (Note/Processor/Agent/CRM Source/FC Date/Processing Date/EL Date) của
   * tab "CPA Review" đang bị ẩn khỏi bảng cho MỌI user — mặc định rỗng (không ẩn cột nào),
   * thêm 2026-08-15. */
  cpaReviewHiddenColumns: string[];
  /** Danh sách task (hàng) của bảng Report trong popup "For Processor" — Processor Leader/
   * Quản lý thêm/sửa/xoá qua UI (feature manageProcessorReportTasks). Mặc định
   * DEFAULT_PROCESSOR_REPORT_TASKS (rbac.ts) nếu chưa từng đổi. */
  processorReportTasks: ProcessorReportTaskDef[];
  /** Entries cá nhân (bảng Report của Processor) cho THÁNG đang xem — lazy-fetch khi mở
   * popup "For Processor" (KHÔNG nạp trong hydrateFromServer để không làm chậm boot cho
   * user không dùng tính năng này), xem fetchProcessorReportEntries. */
  processorReportEntries: ProcessorReportEntry[];
  /** Bảng tổng hợp cho Processor Leader/Quản lý — cache đã tính sẵn (ProcessorReportMonthlySummary)
   * + danh sách Processor hiện có, cho THÁNG đang xem. Cũng lazy-fetch. */
  processorReportSummary: { entries: ProcessorReportMonthlySummaryEntry[]; processors: { id: string; name: string }[] };
  /** Tháng đang chọn trên popup "For Processor" ("YYYY-MM"). */
  processorReportSelectedMonth: string;

  /** true khi đã hydrate xong dữ liệu thật từ server ít nhất 1 lần trong phiên này. */
  hydrated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  /** Nạp lại users/cases/columns/featurePermissions mới nhất từ database — gọi sau khi
   * login thành công và mỗi lần dashboard mount (đảm bảo dữ liệu luôn khớp DB, không
   * chỉ dựa vào bản cache cũ trong localStorage). */
  hydrateFromServer: () => Promise<void>;
  /** Nhận 1 thông báo đẩy realtime qua Pusher — xem src/hooks/use-realtime.ts. */
  receiveNotification: (n: AppNotification) => void;
  /** Nạp lại cases sau khi nhận tín hiệu "case:changed" qua Pusher. */
  refetchCases: () => Promise<void>;
  /** Nạp lại cpaReviewRecords sau khi nhận tín hiệu "cpaReview:changed" qua Pusher — kể cả
   * thay đổi đến từ webhook Google Sheet (Sheet -> App), trước đây KHÔNG có cơ chế nào báo
   * cho tab đang mở biết để tự cập nhật, chỉ thấy sau khi F5 tay. */
  refetchCpaReview: () => Promise<void>;
  setLanguage: (language: Language) => void;
  setTheme: (theme: Theme) => void;
  setNotificationSoundMuted: (muted: boolean) => void;

  updateCell: (
    caseId: string,
    columnKey: string,
    value: string | number | boolean | null | CheckInitialValue,
    isCustom: boolean
  ) => void;
  addRow: (creatorId: string, creatorRole: Role) => void;
  /** Thêm hàng loạt hồ sơ từ file Excel (xem src/lib/excel.ts) — mỗi dòng parse thành 1
   * request tạo hồ sơ riêng (server tự tính caseNumber duy nhất cho từng dòng, không lo
   * trùng). Trả về số dòng tạo thành công/thất bại để UI báo lại cho người dùng. */
  importCases: (
    rows: ParsedCaseRow[],
    creatorId: string,
    creatorRole: Role
  ) => Promise<{ success: number; failed: number; duplicateSsn: number; duplicates: DuplicateSsnInfo[] }>;
  deleteRow: (caseId: string, deletedByUserId: string) => void;
  updateClientLink: (caseId: string, link: string | null) => void;
  updateSsn: (caseId: string, slot: 0 | 1, value: string | null) => void;
  updateRefundYearStatus: (caseId: string, year: string, status: RefundYearStatus) => void;
  updateRefundYearPendingReason: (caseId: string, year: string, reason: string) => void;
  updateRefundYearEfileDate: (caseId: string, year: string, date: string | null) => void;
  /** Thêm/sửa/xoá trạng thái trong AppConfig.refundYearStatusOptions — chỉ Admin (manager)
   * dùng qua nút bánh răng trong CaseRefundStatusButton (xem canManageOptions ở cases/page.tsx).
   * Option id "pending" là id đặc biệt, removeRefundYearStatusOption() tự chặn xoá nó
   * (server cũng chặn, xem PUT /api/config) dù vẫn đổi tên/màu tự do được. */
  addRefundYearStatusOption: (option: Omit<SelectOption, "id">) => void;
  updateRefundYearStatusOption: (optionId: string, patch: Partial<Omit<SelectOption, "id">>) => void;
  removeRefundYearStatusOption: (optionId: string) => void;
  /** Cùng pattern add/update/removeRefundYearStatusOption ở trên nhưng cho danh sách Status
   * của tab "CPA Review" (mỗi khối năm) — không có id nào bị khoá xoá (khác "pending" ở
   * refund), tự do thêm/sửa/xoá. Thêm 2026-08-14. */
  addCpaReviewStatusOption: (option: Omit<SelectOption, "id">) => void;
  updateCpaReviewStatusOption: (optionId: string, patch: Partial<Omit<SelectOption, "id">>) => void;
  removeCpaReviewStatusOption: (optionId: string) => void;
  /** Ẩn/hiện 1 cột "đuôi" (Note/Processor/Agent/CRM Source/FC Date/Processing Date/EL Date)
   * của tab "CPA Review" cho MỌI user — thêm 2026-08-15. */
  toggleCpaReviewHiddenColumn: (key: string) => void;
  /** Foreground action (giống sendCpaEmail) — lưu toàn bộ nội dung popup "Edit Hồ sơ"
   * (ClientProfileDialog) trong 1 lần gọi, server tự tính lại money/caseLabel từ
   * refunds và trả về giá trị đã tính để đồng bộ local state chính xác. */
  updateClientProfile: (caseId: string, payload: ClientProfilePayload) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** clientSlots: [0], [1], hoặc [0,1] (chọn "Cả 2") từ popup chọn client (Order 8821
   * lẫn Order TTS & WIT) — tạo 1 bản ghi order RIÊNG cho mỗi slot trong danh sách.
   * description: CHỈ áp dụng cho type "orderTtsWit" (bắt buộc nhập ở popup). */
  placeOrder: (
    caseId: string,
    type: OrderType,
    byUserId: string,
    clientSlots?: (0 | 1)[],
    description?: string
  ) => void;
  deleteOrder: (caseId: string, orderId: string) => void;
  updateOrderStatus: (caseId: string, orderId: string, status: string | null) => void;
  updateOrderMilestoneDate: (caseId: string, orderId: string, value: string | null) => void;
  assignOrderSupport: (caseId: string, orderId: string, toUserId: string | null) => void;
  addDescriptionReply: (caseId: string, authorId: string, text: string) => void;
  markDescriptionRead: (caseId: string, userId: string) => void;

  addColumn: (label: string, type: ColumnType, options?: Omit<SelectOption, "id">[]) => void;
  removeColumn: (columnId: string) => void;
  renameColumn: (columnId: string, label: string) => void;
  setColumnEditableBy: (columnId: string, roles: Role[]) => void;
  setColumnHiddenFromGrid: (columnId: string, hidden: boolean) => void;
  addColumnOption: (columnId: string, option: Omit<SelectOption, "id">) => void;
  updateColumnOption: (columnId: string, optionId: string, patch: Partial<Omit<SelectOption, "id">>) => void;
  removeColumnOption: (columnId: string, optionId: string) => void;

  /** Tab "Collecting" — CRUD dòng + quản lý cột, cùng cơ chế với bảng Hồ sơ ở trên nhưng
   * tách state/API riêng (collectingColumns/collectingRecords, /api/collecting[/[id]]). */
  updateCollectingCell: (rowId: string, columnKey: string, value: string | number | boolean | null) => void;
  addCollectingRow: () => void;
  deleteCollectingRow: (rowId: string) => void;
  reorderCollectingRow: (fromId: string, toId: string) => void;
  updateCpaReviewCell: (rowId: string, key: string, value: string | number | boolean | null) => void;
  addCpaReviewRow: () => void;
  deleteCpaReviewRow: (rowId: string) => void;
  addCollectingColumn: (label: string, type: ColumnType, options?: Omit<SelectOption, "id">[]) => void;
  removeCollectingColumn: (columnId: string) => void;
  renameCollectingColumn: (columnId: string, label: string) => void;
  setCollectingColumnEditableBy: (columnId: string, roles: Role[]) => void;
  setCollectingColumnHiddenFromGrid: (columnId: string, hidden: boolean) => void;
  addCollectingColumnOption: (columnId: string, option: Omit<SelectOption, "id">) => void;
  updateCollectingColumnOption: (columnId: string, optionId: string, patch: Partial<Omit<SelectOption, "id">>) => void;
  removeCollectingColumnOption: (columnId: string, optionId: string) => void;
  reorderCollectingColumn: (fromId: string, toId: string) => void;

  /** Popup "For Processor" (nút cạnh EC Qualification, bảng Hồ sơ) — tab Report. */
  setProcessorReportSelectedMonth: (month: string) => void;
  /** Nạp entries cá nhân (bảng Processor) cho 1 tháng — lazy, gọi khi mở popup/đổi tháng.
   * `userId` chỉ có ý nghĩa khi manager/processor_leader xem hộ 1 Processor khác. */
  fetchProcessorReportEntries: (month: string, userId?: string) => Promise<void>;
  /** Ghi 1 ô (task, ngày) — optimistic local + PATCH nền, server tự tính lại
   * ProcessorReportMonthlySummary + đẩy Sheet (nếu tháng đã kết nối). */
  upsertProcessorReportEntry: (taskId: string, date: string, value: number, userId?: string) => void;
  /** Nạp bảng tổng hợp (Processor Leader/Quản lý) cho 1 tháng — lazy. */
  fetchProcessorReportSummary: (month: string) => Promise<void>;
  /** Thêm/sửa/xoá/kéo-thả task (hàng) — local state + lưu qua syncConfig() (cùng cơ chế
   * addCollectingColumn ở trên), gate bằng feature manageProcessorReportTasks ở UI. */
  addProcessorReportTask: (sectionId: string, sectionLabel: string, label: string) => void;
  renameProcessorReportTask: (taskId: string, label: string) => void;
  deleteProcessorReportTask: (taskId: string) => void;
  reorderProcessorReportTask: (fromId: string, toId: string) => void;
  /** Kết nối/resync/ngắt kết nối Sheet cho bảng tổng hợp Processor Leader — cùng tinh thần
   * connectCpaReviewSheet ở trên nhưng KHÔNG lưu config vào global state (dialog tự fetch
   * trạng thái riêng qua api.getProcessorReportSyncInfo, xem for-processor-dialog.tsx). */
  connectProcessorReportSheet: (
    link: string,
    month: string
  ) => Promise<
    | { ok: true; month: string; sheetId: string; gid: string; tabName: string; webhookSecret: string; webhookUrl: string; appsScript: string }
    | { ok: false; error: string }
  >;
  resyncProcessorReportSheet: (month: string) => Promise<{ ok: true; pushed: number } | { ok: false; error: string }>;
  disconnectProcessorReportSheet: (month: string) => Promise<void>;

  assignCase: (
    caseId: string,
    toUserId: string | null,
    field: "assignedTo" | "assignedProcessor" | "assignedTo2" | "assignedProcessor2"
  ) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  addUser: (user: Omit<User, "id">) => Promise<boolean>;
  updateUserRole: (userId: string, role: Role) => void;
  removeUser: (userId: string) => void;
  changePassword: (userId: string, currentPassword: string, newPassword: string) => Promise<boolean>;
  resetUserPassword: (userId: string, newPassword: string) => Promise<boolean>;
  updateAvatar: (userId: string, avatarUrl: string | null) => void;
  updateUserTeam: (userId: string, teamMemberIds: string[]) => void;

  setFeaturePermission: (feature: FeatureKey, role: Role, allowed: boolean) => void;
  setCpaEmailDefaults: (defaults: CpaEmailDefaults) => void;
  /** Foreground action (KHÁC placeOrder/syncInBackground) — gửi mail có thể fail rõ
   * ràng (sai App Password, email không hợp lệ...) nên phải await + trả kết quả thật
   * cho UI báo lỗi ngay, không optimistic/fire-and-forget. Ghi 1 dòng vào editHistory
   * khi gửi thành công. */
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
  /** Đánh dấu "Đã gửi" mail CPA thủ công (manual) hoặc xoá đánh dấu khi xác nhận "muốn gửi
   * lại" (clear) — KHÔNG gọi Gmail thật, chỉ lưu/xoá cpaEmailSentAt (xem markCpaEmailSent
   * trong api-client.ts). Cập nhật local case.cpaEmailSentAt theo giá trị server trả về. */
  markCpaEmailSent: (caseId: string, action: "manual" | "clear") => Promise<void>;

  setGoogleSheetConfig: (config: GoogleSheetConfig) => void;
  /** Đổi tháng đang xem trên tab CPA Review — xem cpaReviewSelectedMonth. */
  setCpaReviewSelectedMonth: (month: string) => void;
  /** Dán link kết nối Sheet CPA Review cho 1 THÁNG cụ thể — trả về webhookSecret + đoạn Apps
   * Script mẫu (chỉ lấy được đúng lần này, xem api-client.ts connectCpaReviewSheet). */
  connectCpaReviewSheet: (
    link: string,
    month: string
  ) => Promise<
    | {
        ok: true;
        month: string;
        sheetId: string;
        gid: string;
        tabName: string;
        importedCount: number;
        distinctNames: string[];
        webhookSecret: string;
        webhookUrl: string;
        appsScript: string;
      }
    | { ok: false; error: string }
  >;
  resyncCpaReviewSheet: (month: string) => Promise<{ ok: true; pushed: number } | { ok: false; error: string }>;
  updateCpaReviewNameMapping: (
    nameToUserId: Record<string, string>,
    month: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  disconnectCpaReviewSheet: (month: string) => Promise<void>;
  /** Foreground action, cùng lý do với sendCpaEmail — gửi có thể fail rõ ràng (chưa cấu
   * hình Sheet, token Google hết hạn, không có quyền Editor...). needsGoogleAuth:true khi
   * user chưa/không còn kết nối Google — UI (SendToSheetButton) sẽ tự mở popup
   * connectGoogleAccount() rồi gọi lại action này, không cần user bấm nút 2 lần. */
  sendCaseRowToSheet: (
    caseId: string,
    reviewYears?: string[]
  ) => Promise<{ ok: true } | { ok: false; error: string; needsGoogleAuth?: boolean }>;
  /** Đánh dấu "Đã gửi" Google Sheet thủ công (manual) hoặc xoá đánh dấu khi xác nhận "muốn
   * gửi lại" (clear) — KHÔNG gọi Google Sheets API thật, chỉ lưu/xoá sheetSentAt (xem
   * markCaseSheetSent trong api-client.ts). Cập nhật local case.sheetSentAt theo giá trị
   * server trả về. */
  markCaseSheetSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
  /** Nút "Test Sheet" cạnh Status (thêm 2026-08-14) — tương tự sendCaseRowToSheet (kể cả
   * popup chọn năm) nhưng tạo 1 dòng MỚI trong tab "CPA Review" (tháng hiện tại) thay vì
   * gửi Sheet cá nhân, dùng buildCpaReviewCustomFromCase để map dữ liệu. Foreground vì có
   * thể fail rõ ràng (lỗi mạng/server). */
  sendCaseRowToCpaReview: (
    caseId: string,
    reviewYears: string[],
    note?: string,
    crmSource?: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Đánh dấu "Đã gửi" tab CPA Review thủ công (manual) hoặc xoá đánh dấu khi xác nhận
   * "muốn gửi lại" (clear) — cùng ngữ nghĩa với markCaseSheetSent, xem
   * POST /api/cases/[id]/test-cpa-review-sheet. */
  markCaseCpaReviewTestSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
  /** Nút "Send Collecting Report" trước mỗi năm trong popup "Refund by years" (thêm
   * 2026-08-16) — tạo 1 dòng MỚI trong tab "Collecting" từ hồ sơ này + đúng số refund của
   * năm được bấm, dùng buildCollectingCustomFromCase (server) để map dữ liệu. Không có
   * trạng thái "đã gửi" bền vững — mỗi lần bấm luôn tạo 1 dòng Collecting mới. Foreground vì
   * có thể fail rõ ràng (lỗi mạng/server, thiếu quyền). */
  sendCaseYearToCollecting: (
    caseId: string,
    year: string,
    manual: CollectingReportManualFields
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Mở popup OAuth Google (window.open), lắng nghe postMessage "google-oauth-done" từ
   * /api/auth/google/callback, resolve true/false theo kết quả — poll popup.closed làm
   * timeout dự phòng nếu user đóng popup tay mà không hoàn tất. */
  connectGoogleAccount: () => Promise<boolean>;

  setClientEmailTemplate: (template: ClientEmailTemplate) => void;
  /** Foreground action — dựng trước Subject/nội dung HTML (chưa gắn chữ ký) cho màn hình
   * "soạn mail", gọi khi bấm "Confirm" ở popup chọn năm, TRƯỚC khi cho sửa tay + gửi thật
   * (sendClientEmail). Không lưu/gửi gì cả. */
  previewRefundEmail: (
    caseId: string,
    payload: { years: string[]; language: "vi" | "en"; taxInt: Record<string, string> }
  ) => Promise<
    | { ok: true; subject: string; bodyHtml: string; to: string[]; cc: string[] }
    | { ok: false; error: string }
  >;
  /** Foreground action, cùng lý do sendCpaEmail/sendCaseRowToSheet — gửi có thể fail rõ
   * ràng (chưa kết nối webmail, email khách hàng sai định dạng...). needsWebmailAuth:true
   * khi user chưa/không còn kết nối webmail — UI tự mở ConnectWebmailDialog rồi gọi lại
   * action này. `subject`/`bodyHtml`/`to`/`cc` LÀ bản đã (có thể) sửa tay ở màn hình soạn
   * mail (sau previewRefundEmail), route không tự build lại từ template nữa. Có trạng thái
   * "đã gửi" bền vững qua `clientEmailSentAt` (thêm 2026-08-16, giống sheetSentAt/
   * cpaEmailSentAt/cpaReviewTestSentAt) — cập nhật vào `cases` bên dưới. */
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
  /** Đánh dấu "Đã gửi" mail khách hàng thủ công (manual) hoặc xoá đánh dấu đó khi xác nhận
   * "muốn gửi lại" (clear) — cùng cơ chế markCpaEmailSent/markCaseSheetSent/
   * markCaseCpaReviewTestSent. */
  markClientEmailSent: (caseId: string, action: "manual" | "clear") => Promise<void>;
  /** Kết nối mailbox webmail (mail.directfunder.com) riêng của user — nhận thẳng email +
   * mật khẩu từ dialog (không phải popup OAuth như connectGoogleAccount, vì SMTP không có
   * consent screen để redirect tới). Server tự xác minh đăng nhập SMTP trước khi lưu. */
  connectWebmailAccount: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;

  reorderColumn: (fromId: string, toId: string) => void;
  reorderCase: (fromId: string, toId: string) => void;

  /** Foreground action (giống sendCpaEmail) — thêm/sửa/xoá rule cần feedback lỗi rõ ràng
   * ngay (chỉ Quản lý được phép, server 403 nếu không), không optimistic. Trả về rule đã
   * lưu (server tính lại createdAt/updatedAt) để store thay thế đúng bản ghi optimistic
   * tạm nếu có. */
  addRule: (content: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  editRule: (ruleId: string, content: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteRule: (ruleId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => {
      function logEdit(caseId: string, fieldLabel: string, oldValue: string, newValue: string) {
        if (oldValue === newValue) return;
        const state = get();
        const kase = state.cases.find((c) => c.id === caseId);
        const ssn = kase ? primarySsn(kase) : null;
        const clientName = kase ? getFullName(kase) : "";
        const entry: EditHistoryRecord = {
          id: uniqueId("edit"),
          caseId,
          ssn,
          clientName,
          fieldLabel,
          oldValue,
          newValue,
          editedByUserId: state.currentUserId ?? "",
          editedAt: new Date().toISOString(),
        };
        // Optimistic local prepend (phản hồi tức thì) + ghi lên server để MỌI user khác đăng
        // nhập đều xem được (2026-08-13) — server tự set editedByUserId/editedAt thật, entry
        // optimistic ở trên chỉ dùng để hiện ngay trong lúc chờ, không đồng bộ lại id/thời
        // gian chính xác từ response (đủ dùng, sai lệch vài trăm ms không đáng kể).
        set((s) => ({ editHistory: [entry, ...s.editHistory] }));
        syncInBackground("logEdit", api.createEditHistoryEntry({ caseId, ssn, clientName, fieldLabel, oldValue, newValue }));
      }

      /** Đồng bộ lại field `orders` của 1 case lên server sau khi set() cục bộ đã xong
       * — dùng chung cho mọi thao tác đụng tới orders[] (đặt/xoá/đổi status/assign). */
      function syncOrders(caseId: string) {
        const kase = get().cases.find((c) => c.id === caseId);
        if (kase) syncInBackground("orders", api.patchCase(caseId, { orders: kase.orders }));
      }

      /** Đồng bộ nguyên cụm columns + featurePermissions lên AppConfig (bảng singleton)
       * sau khi set() cục bộ đã xong — dùng chung cho mọi thao tác sửa cấu hình cột /
       * ma trận phân quyền (server chỉ chấp nhận role manager, request khác sẽ bị 403
       * và log lỗi ra console, không rollback local — chấp nhận được ở giai đoạn này vì
       * trang cài đặt cột/phân quyền vốn chỉ hiện cho manager). */
      // Nhiều lần sửa liên tiếp nhanh (vd đổi màu chữ rồi màu nền của cùng 1 Status ở
      // CpaReviewStatusOptionsButton) trước đây mỗi lần gọi syncConfig() bắn 1 request PUT
      // ĐỘC LẬP, không đảm bảo thứ tự tới server — nếu request CŨ (đọc state SỚM hơn) tới
      // server SAU request MỚI (do trễ mạng), nó ghi đè mất bản mới nhất, đúng triệu chứng
      // "đổi màu xong reload lại về màu cũ" (bug thật gặp 2026-08-15). Xếp hàng qua 1 promise
      // chain — mỗi lần gọi CHỜ lần trước xong rồi mới đọc `get()` (luôn lấy state MỚI NHẤT
      // tại đúng lượt của nó, không phải state lúc gọi syncConfig()) rồi mới gửi, đảm bảo
      // không có 2 request nào chạy đồng thời và request sau luôn thấy dữ liệu đầy đủ nhất.
      let configSyncChain: Promise<unknown> = Promise.resolve();
      function syncConfig() {
        configSyncChain = configSyncChain.catch(() => {}).then(() => {
          const state = get();
          return api.putConfig(
            state.columns,
            state.featurePermissions,
            state.cpaEmailDefaults,
            state.googleSheetConfig ?? undefined,
            state.clientEmailTemplate ?? undefined,
            state.refundYearStatusOptions,
            state.collectingColumns,
            state.cpaReviewStatusOptions,
            state.cpaReviewHiddenColumns,
            state.processorReportTasks
          );
        });
        syncInBackground("config", configSyncChain);
      }

      return {
      currentUserId: null,
      hydrated: false,
      language: "vi",
      theme: "dark",
      notificationSoundMuted: false,
      cases: INITIAL_CASES,
      columns: DEFAULT_COLUMNS,
      notifications: INITIAL_NOTIFICATIONS,
      users: INITIAL_USERS,
      featurePermissions: DEFAULT_FEATURE_PERMISSIONS,
      cpaEmailDefaults: { to: [], cc: [] },
      cpaSenderEmail: "",
      googleSheetConfig: null,
      cpaReviewSheetConfig: {},
      cpaReviewSelectedMonth: currentMonthKey(),
      clientEmailTemplate: null,
      refundYearStatusOptions: DEFAULT_REFUND_YEAR_STATUS_OPTIONS,
      deletionHistory: [],
      editHistory: [],
      rules: [],
      collectingRecords: [],
      cpaReviewRecords: [],
      collectingColumns: DEFAULT_COLLECTING_COLUMNS,
      cpaReviewStatusOptions: CPA_REVIEW_STATUS_OPTIONS,
      cpaReviewHiddenColumns: [],
      processorReportTasks: DEFAULT_PROCESSOR_REPORT_TASKS,
      processorReportEntries: [],
      processorReportSummary: { entries: [], processors: [] },
      processorReportSelectedMonth: currentMonthKey(),

      login: async (email, password) => {
        try {
          const user = await api.login(email, password);
          set({ currentUserId: user.id });
          await get().hydrateFromServer();
          return true;
        } catch {
          return false;
        }
      },
      logout: () => {
        syncInBackground("logout", api.logout());
        set({ currentUserId: null });
      },
      // Users/Cases/Column config giờ lấy từ database thật qua API (xem
      // .claude/rules/deployment-database-sync.md) — bản trong localStorage chỉ còn là
      // cache hiển thị tạm trước khi hydrate xong, luôn bị ghi đè bởi dữ liệu server.
      hydrateFromServer: async () => {
        const [users, cases, config, rules, collectingRecords, cpaReviewRecords, notifications, editHistory, deletionHistory] =
          await Promise.all([
          api.listUsers(),
          api.listCases(),
          api.getConfig(),
          api.listRules(),
          api.listCollecting(),
          api.listCpaReview(),
          // Trước đây notifications chỉ tồn tại local (tạo trong set(), không có API) —
          // giờ server là nguồn thật duy nhất (xem prisma model Notification + PATCH
          // /api/cases/[id]), luôn nạp lại mỗi lần vào dashboard giống users/cases/...
          api.listNotifications(),
          // Tương tự notifications — trước 2026-08-13 editHistory/deletionHistory chỉ tồn tại
          // local (mỗi trình duyệt chỉ thấy thay đổi do CHÍNH nó thực hiện), giờ server là
          // nguồn thật duy nhất nên MỌI user xem được TOÀN BỘ lịch sử (xem
          // EditHistoryEntry/DeletedRowEntry trong schema.prisma).
          api.listEditHistory(),
          api.listDeletionHistory(),
        ]);
        set({
          users,
          cases,
          columns: config.columns,
          featurePermissions: config.featurePermissions,
          cpaEmailDefaults: config.cpaEmailDefaults ?? { to: [], cc: [] },
          cpaSenderEmail: config.cpaSenderEmail ?? "",
          googleSheetConfig: config.googleSheetConfig ?? null,
          cpaReviewSheetConfig: config.cpaReviewSheetConfig ?? {},
          clientEmailTemplate: config.clientEmailTemplate ?? null,
          refundYearStatusOptions: config.refundYearStatusOptions ?? DEFAULT_REFUND_YEAR_STATUS_OPTIONS,
          collectingColumns: config.collectingColumns ?? DEFAULT_COLLECTING_COLUMNS,
          cpaReviewStatusOptions: config.cpaReviewStatusOptions ?? CPA_REVIEW_STATUS_OPTIONS,
          cpaReviewHiddenColumns: config.cpaReviewHiddenColumns ?? [],
          processorReportTasks:
            config.processorReportTasks && config.processorReportTasks.length > 0
              ? config.processorReportTasks
              : DEFAULT_PROCESSOR_REPORT_TASKS,
          rules,
          collectingRecords,
          cpaReviewRecords,
          notifications,
          editHistory,
          deletionHistory,
          hydrated: true,
        });
      },
      /** Nhận 1 thông báo đẩy realtime qua Pusher (xem src/hooks/use-realtime.ts) — prepend
       * vào đầu danh sách, dedupe theo id (phòng trường hợp Pusher gửi trùng hoặc đã có sẵn
       * từ hydrateFromServer nếu 2 tab cùng mở). */
      receiveNotification: (n) =>
        set((state) => ({
          notifications: state.notifications.some((existing) => existing.id === n.id)
            ? state.notifications
            : [n, ...state.notifications],
        })),
      /** Gọi lại khi nhận tín hiệu "case:changed" qua Pusher — GET /api/cases đã tự lọc
       * RBAC nên chỉ cần thay nguyên state.cases, không cần merge tay từng dòng. */
      refetchCases: async () => {
        const cases = await api.listCases();
        set({ cases });
      },
      refetchCpaReview: async () => {
        const cpaReviewRecords = await api.listCpaReview();
        set({ cpaReviewRecords });
      },
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      setNotificationSoundMuted: (muted) => set({ notificationSoundMuted: muted }),

      updateCell: (caseId, columnKey, value, isCustom) => {
        const state = get();
        const kase = state.cases.find((c) => c.id === caseId);
        let oldRaw: unknown;
        if (kase) {
          const col = state.columns.find((c) => c.key === columnKey);
          oldRaw = isCustom ? kase.custom[columnKey] : (kase as unknown as Record<string, unknown>)[columnKey];
          logEdit(caseId, col?.label ?? columnKey, formatHistoryValue(oldRaw, col), formatHistoryValue(value, col));
        }
        // "Processing Date" tự động lấy theo LẦN GẦN NHẤT status chuyển sang "processing"
        // (yêu cầu 2026-08-14) — cập nhật optimistic ở đây để popup "Edit Hồ sơ" thấy ngay
        // giá trị mới không cần đợi refetch, khớp đúng logic server ở PATCH /api/cases/[id]
        // (chỉ set khi đây là 1 lần CHUYỂN TRẠNG THÁI thật, không phải chọn lại giá trị cũ).
        const justEnteredProcessing = !isCustom && columnKey === "status" && value === "processing" && oldRaw !== "processing";
        set((s) => ({
          cases: s.cases.map((c) => {
            if (c.id !== caseId) return c;
            if (isCustom) {
              return { ...c, custom: { ...c.custom, [columnKey]: value }, updatedAt: new Date().toISOString() };
            }
            return {
              ...c,
              [columnKey]: value,
              ...(justEnteredProcessing ? { processingDate: todayIsoDate() } : null),
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
        syncInBackground(
          "updateCell",
          api.patchCase(
            caseId,
            (isCustom ? { custom: { [columnKey]: value } } : { [columnKey]: value }) as Partial<CaseRecord>
          )
        );
      },

      // Mỗi lần đặt order (kể cả đặt lại sau khi order trước đã Done) tạo THÊM 1 bản
      // ghi MỚI vào orders[], không ghi đè/xóa order cũ — tab Order luôn giữ đủ lịch
      // sử mọi lần order trước đó dưới dạng các row riêng biệt. Order 8821 và Order
      // TTS & WIT là 2 danh sách hoàn toàn tách biệt (lọc theo `type`).
      placeOrder: (caseId, type, byUserId, clientSlots, description) => {
        const placedAt = new Date().toISOString();
        // Chọn "Cả 2" (2 slot) -> 2 bản ghi độc lập cùng groupId, để Done riêng từng
        // client. Đặt lẻ 1 client (hoặc không truyền slots, cho order cũ) -> 1 bản ghi
        // clientSlot=null như cũ. Nút KHÔNG khoá theo trạng thái case nữa (chặn trùng
        // dựa vào SSN qua tab Waiting — xem hasWaitingOrderForSsn trong lib/orders.ts).
        const slots: (0 | 1 | null)[] = clientSlots && clientSlots.length > 0 ? clientSlots : [null];
        const groupId = slots.length > 1 ? uniqueId("grp") : null;
        const newOrders: OrderRecord[] = slots.map((slot) => ({
          id: uniqueId("ord"),
          type,
          placedAt,
          placedBy: byUserId,
          status: null,
          statusUpdatedAt: null,
          assignedSupport: null,
          milestoneDate: null,
          clientSlot: slot,
          groupId,
          description: type === "orderTtsWit" ? description ?? null : null,
        }));
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId ? { ...c, orders: [...c.orders, ...newOrders], updatedAt: new Date().toISOString() } : c
          ),
        }));
        syncOrders(caseId);
      },

      // Xóa hẳn 1 dòng order cụ thể khỏi lịch sử (không xóa hồ sơ) — mọi tài khoản xem
      // được tab Order đều có quyền xóa (không giới hạn theo feature permission riêng).
      deleteOrder: (caseId, orderId) => {
        const kase = get().cases.find((c) => c.id === caseId);
        const target = kase?.orders.find((o) => o.id === orderId);
        if (target) {
          const label = target.type === "order8821" ? "Order 8821" : "Order TTS & WIT";
          logEdit(caseId, label, "Đã đặt", "Đã xóa khỏi tab Order");
        }
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId
              ? { ...c, orders: c.orders.filter((o) => o.id !== orderId), updatedAt: new Date().toISOString() }
              : c
          ),
        }));
        syncOrders(caseId);
      },

      // Status RIÊNG của từng lần order — mỗi lần đổi giá trị tự ghi lại mốc thời gian
      // thay đổi (statusUpdatedAt) để hiển thị ở cột "Ngày thực hiện".
      updateOrderStatus: (caseId, orderId, status) => {
        const state = get();
        const kase = state.cases.find((c) => c.id === caseId);
        const target = kase?.orders.find((o) => o.id === orderId);
        if (target) {
          const label = target.type === "order8821" ? "Order 8821 - Status" : "Order TTS & WIT - Status";
          logEdit(caseId, label, formatHistoryValue(target.status), formatHistoryValue(status));
        }
        // Thông báo "đã hoàn tất order" khi order vừa chuyển sang Done giờ do server tạo
        // (xem PATCH /api/cases/[id], so orders cũ/mới) + đẩy realtime tới đúng người đã
        // đặt order đó (placedBy) — không tạo local ở đây nữa.
        set((s) => ({
          cases: s.cases.map((c) =>
            c.id === caseId
              ? {
                  ...c,
                  orders: c.orders.map((o) =>
                    o.id === orderId ? { ...o, status, statusUpdatedAt: new Date().toISOString() } : o
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
        }));
        syncOrders(caseId);
      },

      // Ngày chọn tay riêng của từng lần order — "Sign Date" cho Order 8821, "Downloaded
      // Date" cho Order TTS & WIT (cùng 1 field milestoneDate, khác ý nghĩa theo type).
      updateOrderMilestoneDate: (caseId, orderId, value) => {
        const kase = get().cases.find((c) => c.id === caseId);
        const target = kase?.orders.find((o) => o.id === orderId);
        if (target) {
          const label = target.type === "order8821" ? "Order 8821 - Sign Date" : "Order TTS & WIT - Downloaded Date";
          logEdit(caseId, label, formatHistoryValue(target.milestoneDate), formatHistoryValue(value));
        }
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId
              ? {
                  ...c,
                  orders: c.orders.map((o) => (o.id === orderId ? { ...o, milestoneDate: value } : o)),
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
        }));
        syncOrders(caseId);
      },

      // Giao tài khoản Support xử lý RIÊNG 1 lần order — tách biệt hoàn toàn giữa Order
      // 8821 và Order TTS & WIT (không dùng chung Assign như trước). Thông báo "đã giao
      // order" giờ do server tạo (xem PATCH /api/cases/[id], so orders cũ/mới) + đẩy
      // realtime tới đúng người được giao — không tạo local ở đây nữa.
      assignOrderSupport: (caseId, orderId, toUserId) => {
        set((s) => ({
          cases: s.cases.map((c) =>
            c.id === caseId
              ? {
                  ...c,
                  orders: c.orders.map((o) => (o.id === orderId ? { ...o, assignedSupport: toUserId } : o)),
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
        }));
        syncOrders(caseId);
      },

      addRow: (creatorId, creatorRole) => {
        const state = get();
        const id = uniqueId("c");
        // Số hồ sơ hiển thị (dạng số thuần) tính theo số lớn nhất đang có (kể cả hồ sơ
        // đã xóa trong lịch sử) + 1 — đọc trực tiếp từ dữ liệu hiện tại thay vì bộ đếm
        // riêng, nên không bao giờ lặp lại số dù reload trang bao nhiêu lần. Đây chỉ là
        // giá trị TẠM để hiển thị ngay: state.cases có thể đã bị lọc theo quyền xem (Agent/
        // Processor chỉ thấy hồ sơ của mình) nên số này dễ bị trùng — server luôn tự tính
        // lại caseNumber thật trên toàn bộ dữ liệu và trả về, xem phần reconcile bên dưới.
        const maxCaseNum = [...state.cases, ...state.deletionHistory.map((d) => d.caseSnapshot)].reduce(
          (max, c) => {
            const m = /^(\d+)$/.exec(c.caseNumber);
            return m ? Math.max(max, Number(m[1])) : max;
          },
          1000
        );
        const optimistic: CaseRecord = {
          id,
          status: "pre_processing",
          clients: [
            { firstName: "", lastName: "" },
            { firstName: "", lastName: "" },
          ],
          clientLink: null,
          zipcode: "",
          address: "",
          phone: "",
          phone2: "",
          email: "",
          dateOfBirth: [null, null],
          description: "",
          caseNumber: `${maxCaseNum + 1}`,
          money: 0,
          refunds: {},
          orders: [],
          // Agent tự gán cho chính mình nếu là người tạo, để hồ sơ mới không biến mất
          // khỏi danh sách hồ sơ họ được thấy (đã lọc theo canViewCase). Agent Leader
          // không tự gán vào assignedTo (field đó dành cho thành viên trong nhóm) — thay
          // vào đó createdBy giữ hồ sơ hiển thị trong bảng của leader cho tới khi được
          // gán cho ai đó trong nhóm.
          assignedTo: creatorRole === "agent" ? creatorId : null,
          // Processor LUÔN tự gán cho người tạo hồ sơ, bất kể role gì (thêm 2026-08-15,
          // yêu cầu "khi add row thì mặc định cột Processor assign to tài khoản addrow")
          // — khác Agent (chỉ tự gán khi người tạo đúng là role Agent).
          assignedProcessor: creatorId,
          // Slot 2 luôn bắt đầu trống — chỉ slot 1 tự gán cho người tạo (hành vi cũ).
          assignedTo2: null,
          assignedProcessor2: null,
          createdBy: creatorId,
          ssn: [null, null],
          descriptionReplies: [],
          descriptionReadBy: [],
          // Cột "Case" hiển thị (cột tuỳ chỉnh caseLabel, khác với "caseNumber" nội bộ đã
          // đổi tên thành "Code" và ẩn đi) giờ là số đếm TỰ ĐỘNG năm Refund > 0 (xem
          // rbac.ts + src/lib/refund.ts) — hồ sơ mới chưa có refund nên mặc định 0.
          custom: { caseLabel: 0 },
          sheetSentAt: null,
          cpaEmailSentAt: null,
          cpaReviewTestSentAt: null,
          clientEmailSentAt: null,
          // Số âm theo epoch-ms hiện tại -> luôn nhỏ hơn mọi sortOrder hiện có -> tự động
          // lên đầu bảng, khớp hành vi cũ "mới nhất lên đầu" (server tạo cũng tự tính
          // đúng công thức này nếu thiếu, xem POST /api/cases).
          sortOrder: -Date.now(),
          refundYearStatus: {},
          refundYearPendingReason: {},
          refundYearEfileDate: {},
          fcDate: null,
          processingDate: null,
          elDate: null,
          bankName: null,
          routingNumber: null,
          accountNumber: null,
          note: null,
          accountant: null,
          accountantSupport: null,
          taxIntByYear: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ cases: [optimistic, ...s.cases] }));

        // Đợi phản hồi rồi thay case tạm bằng bản server trả về (có caseNumber thật);
        // nếu request lỗi (vd. hết quyền), rollback bỏ dòng tạm để không hiển thị nhầm
        // 1 hồ sơ chưa thực sự được lưu.
        api.createCase(optimistic).then(
          (serverCase) => {
            set((s) => ({ cases: s.cases.map((c) => (c.id === optimistic.id ? serverCase : c)) }));
          },
          (err) => {
            console.error("[sync:addRow] Tạo hồ sơ thất bại, hoàn tác dòng tạm:", err);
            set((s) => ({ cases: s.cases.filter((c) => c.id !== optimistic.id) }));
          }
        );
      },

      // Excel export/import: ô "Client Name"/"SSN" có thể chứa 2 dòng (Alt+Enter trong Excel)
      // — dòng 1 là khách hàng chính, dòng 2 (nếu có) là vợ/chồng (Spouse), tách bằng
      // splitCellLines(). Tên mỗi dòng tách theo TỪ CUỐI CÙNG -> Last Name, phần còn lại ->
      // First Name (splitNameLastWord, vd "Nguyen Van A" -> First "Nguyen Van", Last "A").
      // Agent/Processor khớp theo TÊN chính xác (không phân biệt hoa thường) với danh sách
      // tài khoản hiện có, không khớp được thì để trống (không lỗi).
      importCases: async (rows, creatorId, creatorRole) => {
        const state = get();
        const agentUsers = state.users.filter((u) => u.role === "agent");
        const processorUsers = state.users.filter((u) => u.role === "processor");

        // SSN đại diện duy nhất cho mỗi hồ sơ (xem workflow-conventions.md) — chuẩn hoá về
        // đúng dạng xxx-xx-xxxx như phần mềm đang dùng ở mọi nơi khác (formatSsn), rồi loại
        // các dòng có SSN (chính hoặc Spouse) trùng với hồ sơ đã có sẵn TRONG DB lẫn trùng
        // nhau NGAY TRONG file vừa tải lên — không import những dòng đó. Giữ lại luôn hồ sơ
        // đang trùng (existingBySsn) để báo cho người import biết SSN đó hiện đang do ai phụ
        // trách, thay vì chỉ báo 1 con số chung chung.
        const existingBySsn = new Map<string, CaseRecord>();
        for (const c of state.cases) {
          for (const s of c.ssn) if (s) existingBySsn.set(s, c);
        }
        const seenInFile = new Map<string, number>();
        const importable: { row: ParsedCaseRow; ssnPrimary: string; ssnSpouse: string }[] = [];
        const duplicates: DuplicateSsnInfo[] = [];
        rows.forEach((row, fileIdx) => {
          const [ssnLine1, ssnLine2] = splitCellLines(row.ssn);
          const ssnPrimary = ssnLine1 ? formatSsn(ssnLine1) : "";
          const ssnSpouse = ssnLine2 ? formatSsn(ssnLine2) : "";
          const candidates = [ssnPrimary, ssnSpouse].filter(Boolean);

          for (const s of candidates) {
            const existing = existingBySsn.get(s);
            if (existing) {
              const ownerId = existing.assignedTo ?? existing.assignedProcessor ?? existing.createdBy;
              const ownerName = ownerId ? state.users.find((u) => u.id === ownerId)?.name : undefined;
              duplicates.push({
                ssn: s,
                clientName: getFullName(existing) || "—",
                owner: ownerName ? { type: "user", name: ownerName } : { type: "unassigned" },
              });
              return;
            }
            const seenAtRow = seenInFile.get(s);
            if (seenAtRow !== undefined) {
              const [firstLine] = splitCellLines(row.clientName);
              duplicates.push({
                ssn: s,
                clientName: firstLine || "—",
                owner: { type: "sameFile", rowNumber: seenAtRow },
              });
              return;
            }
          }
          for (const s of candidates) seenInFile.set(s, fileIdx + 1);
          importable.push({ row, ssnPrimary, ssnSpouse });
        });

        // Dòng đầu file Excel phải nằm trên cùng bảng: gán sortOrder giảm dần theo thứ tự
        // dòng trong file (dòng 1 nhận giá trị âm nhất) trong cùng 1 mốc thời gian base, thay
        // vì mỗi dòng tự gọi -Date.now() riêng (dễ đảo ngược thứ tự do các lệnh gọi liên tiếp
        // trong .map() cho ra giá trị tăng dần).
        const baseSortOrder = -Date.now();

        // Tạo TUẦN TỰ (không Promise.allSettled bắn song song) — server tự tính caseNumber
        // kế tiếp bằng cách quét max hiện có (nextCaseNumber trong api/cases/route.ts),
        // caseNumber lại có ràng buộc @unique trên DB; nếu bắn nhiều request tạo hồ sơ cùng
        // lúc, nhiều request sẽ đọc thấy cùng 1 giá trị max (do các request trước chưa kịp
        // commit) rồi tính ra CÙNG 1 caseNumber -> chỉ request đầu tiên insert thành công,
        // các request còn lại vi phạm unique constraint và bị coi là "failed" dù dữ liệu
        // hoàn toàn hợp lệ. Đây là nguyên nhân gây ra hiện tượng nhập Excel báo "N dòng lỗi"
        // dù file không có gì sai.
        const results: PromiseSettledResult<CaseRecord>[] = [];
        for (let index = 0; index < importable.length; index++) {
          const { row, ssnPrimary, ssnSpouse } = importable[index];
          try {
            const [nameLine1, nameLine2] = splitCellLines(row.clientName);
            const primaryName = splitNameLastWord(nameLine1);
            const spouseName = splitNameLastWord(nameLine2);
            const [phone1, phone2] = splitCellLines(row.phone);
            const agent = agentUsers.find((u) => u.name.trim().toLowerCase() === row.agentName.toLowerCase());
            const processor = processorUsers.find(
              (u) => u.name.trim().toLowerCase() === row.processorName.toLowerCase()
            );
            const record: CaseRecord = {
              id: uniqueId("c"),
              status: "pre_processing",
              clients: [primaryName, spouseName],
              clientLink: row.clientLink,
              zipcode: row.zip,
              address: row.address,
              phone: phone1,
              phone2: phone2,
              email: "",
              dateOfBirth: [null, null],
              description: "",
              caseNumber: "0",
              money: row.money,
              refunds: {},
              orders: [],
              assignedTo: agent?.id ?? (creatorRole === "agent" ? creatorId : null),
              assignedTo2: null,
              assignedProcessor: processor?.id ?? (creatorRole === "processor" ? creatorId : null),
              assignedProcessor2: null,
              createdBy: creatorId,
              ssn: [ssnPrimary || null, ssnSpouse || null],
              descriptionReplies: [],
              descriptionReadBy: [],
              // caseLabel giờ là số đếm tự động năm Refund > 0 (xem rbac.ts) — hồ sơ nhập từ
              // Excel chưa có refund nào nên luôn mặc định 0, giống hệt hồ sơ tạo tay qua nút
              // "Thêm dòng" (POST /api/cases nhánh không có body), không đọc theo cột nào
              // trong file Excel nữa.
              custom: { caseLabel: 0 },
              sheetSentAt: null,
              cpaEmailSentAt: null,
              cpaReviewTestSentAt: null,
              clientEmailSentAt: null,
              sortOrder: baseSortOrder - (importable.length - index),
              refundYearStatus: {},
              refundYearPendingReason: {},
              refundYearEfileDate: {},
              fcDate: null,
              processingDate: null,
              elDate: null,
              bankName: null,
              routingNumber: null,
              accountNumber: null,
              note: null,
              accountant: null,
              accountantSupport: null,
              taxIntByYear: {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            const created = await api.createCase(record);
            results.push({ status: "fulfilled", value: created });
          } catch (err) {
            results.push({ status: "rejected", reason: err });
          }
        }

        const created = results
          .filter((r): r is PromiseFulfilledResult<CaseRecord> => r.status === "fulfilled")
          .map((r) => r.value);
        const failed = results.length - created.length;
        if (created.length > 0) {
          set((s) => ({ cases: [...s.cases, ...created] }));
        }
        return { success: created.length, failed, duplicateSsn: duplicates.length, duplicates };
      },

      deleteRow: (caseId, deletedByUserId) => {
        const target = get().cases.find((c) => c.id === caseId);
        set((state) => {
          if (!target) return {};
          return {
            cases: state.cases.filter((c) => c.id !== caseId),
            deletionHistory: [
              {
                id: uniqueId("del"),
                caseSnapshot: target,
                deletedByUserId,
                deletedAt: new Date().toISOString(),
              },
              ...state.deletionHistory,
            ],
          };
        });
        syncInBackground("deleteRow", api.deleteCase(caseId));
        // Ghi lên server để MỌI user khác đăng nhập đều xem được (2026-08-13) — cùng lý do
        // với logEdit ở trên, server tự set deletedByUserId/deletedAt thật.
        if (target) syncInBackground("logDeletion", api.createDeletionHistoryEntry(target));
      },

      updateClientLink: (caseId, link) => {
        const kase = get().cases.find((c) => c.id === caseId);
        if (kase) logEdit(caseId, "Client Name - Link", formatHistoryValue(kase.clientLink), formatHistoryValue(link));
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId ? { ...c, clientLink: link, updatedAt: new Date().toISOString() } : c
          ),
        }));
        syncInBackground("clientLink", api.patchCase(caseId, { clientLink: link }));
      },

      updateSsn: (caseId, slot, value) => {
        const kase = get().cases.find((c) => c.id === caseId);
        if (kase) logEdit(caseId, `SSN #${slot + 1}`, formatHistoryValue(kase.ssn[slot]), formatHistoryValue(value));
        let nextSsn: [string | null, string | null] = ["", ""] as unknown as [string | null, string | null];
        set((state) => ({
          cases: state.cases.map((c) => {
            if (c.id !== caseId) return c;
            const ssn: [string | null, string | null] = [...c.ssn];
            ssn[slot] = value;
            nextSsn = ssn;
            return { ...c, ssn, updatedAt: new Date().toISOString() };
          }),
        }));
        syncInBackground("ssn", api.patchCase(caseId, { ssn: nextSsn }));
      },

      updateRefundYearStatus: (caseId, year, status) => {
        const state0 = get();
        const kase = state0.cases.find((c) => c.id === caseId);
        const oldStatus = kase?.refundYearStatus?.[year] ?? DEFAULT_REFUND_YEAR_STATUS;
        if (kase) {
          const oldLabel = findRefundStatusOption(state0.refundYearStatusOptions, oldStatus).label;
          const newLabel = findRefundStatusOption(state0.refundYearStatusOptions, status).label;
          logEdit(caseId, `Refund ${year}`, oldLabel, newLabel);
        }
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId
              ? { ...c, refundYearStatus: { ...c.refundYearStatus, [year]: status }, updatedAt: new Date().toISOString() }
              : c
          ),
        }));
        // Chỉ gửi đúng 1 năm vừa đổi (không phải toàn bộ object) -> server tự merge cộng
        // dồn (xem PATCH /api/cases/[id]), tránh ghi đè mất trạng thái các năm khác nếu 2
        // người sửa gần như cùng lúc.
        syncInBackground("refundYearStatus", api.patchCase(caseId, { refundYearStatus: { [year]: status } }));
      },

      // Lý do Pending — mọi user đăng nhập đều sửa được (không kiểm tra editableBy như
      // refundYearStatus), xem PATCH /api/cases/[id]. Component tự commit khi rời khỏi ô
      // nhập (blur), không sync theo từng phím gõ.
      updateRefundYearPendingReason: (caseId, year, reason) => {
        const kase = get().cases.find((c) => c.id === caseId);
        const oldReason = kase?.refundYearPendingReason?.[year] ?? "";
        if (kase && oldReason !== reason) logEdit(caseId, `Lý do Pending ${year}`, oldReason, reason);
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId
              ? {
                  ...c,
                  refundYearPendingReason: { ...c.refundYearPendingReason, [year]: reason },
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
        }));
        syncInBackground("refundYearPendingReason", api.patchCase(caseId, { refundYearPendingReason: { [year]: reason } }));
      },

      // Ngày E-file riêng từng năm — cùng quyền sửa với refundYearStatus (editable theo
      // cột "refunds"), dùng cho đồng bộ 2 chiều "CPA Review" với Google Sheet.
      updateRefundYearEfileDate: (caseId, year, date) => {
        const kase = get().cases.find((c) => c.id === caseId);
        const oldDate = kase?.refundYearEfileDate?.[year] ?? "";
        if (kase && oldDate !== (date ?? "")) logEdit(caseId, `Ngày E-file ${year}`, oldDate, date ?? "");
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId
              ? { ...c, refundYearEfileDate: { ...c.refundYearEfileDate, [year]: date }, updatedAt: new Date().toISOString() }
              : c
          ),
        }));
        syncInBackground("refundYearEfileDate", api.patchCase(caseId, { refundYearEfileDate: { [year]: date } }));
      },

      // Foreground (giống sendCpaEmail/sendCaseRowToSheet) — server tự tính money/
      // caseLabel từ refunds nên PHẢI await để lấy giá trị thật trả về, không optimistic-
      // update rồi âm thầm log console như các action patch-1-field khác trong file này.
      updateClientProfile: async (caseId, payload) => {
        try {
          const result = await api.updateClientProfile(caseId, payload);
          set((state) => ({
            cases: state.cases.map((c) =>
              c.id === caseId
                ? {
                    ...c,
                    ...payload,
                    money: result.money,
                    custom: { ...c.custom, ...(result.custom as Record<string, string | number | boolean | null>) },
                    updatedAt: result.updatedAt,
                  }
                : c
            ),
          }));
          logEdit(caseId, "Edit Hồ sơ", "", "Đã cập nhật thông tin khách hàng / refund");
          return { ok: true } as const;
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Lưu hồ sơ thất bại" } as const;
        }
      },

      addDescriptionReply: (caseId, authorId, text) => {
        // Có description mới thì đẩy hẳn row của hồ sơ đó lên đầu bảng, giống thứ tự hội
        // thoại có tin nhắn mới nhất — phải gán sortOrder mới (giống addRow: -Date.now() luôn
        // nhỏ hơn mọi sortOrder hiện có) và lưu server, nếu không GET /api/cases (sắp xếp
        // theo sortOrder) sẽ trả về đúng vị trí cũ sau khi reload, làm row "nhảy về chỗ cũ".
        const newSortOrder = -Date.now();
        set((state) => {
          const updated = state.cases.map((c) =>
            c.id === caseId
              ? {
                  ...c,
                  descriptionReplies: [
                    ...c.descriptionReplies,
                    { id: uniqueId("dr"), authorId, text, createdAt: new Date().toISOString() },
                  ],
                  // Reply mới chỉ tính là "đã đọc" với người vừa gửi — các tài khoản khác
                  // vẫn thấy màu đỏ cho tới khi tự mở xem.
                  descriptionReadBy: [authorId],
                  updatedAt: new Date().toISOString(),
                  sortOrder: newSortOrder,
                }
              : c
          );
          // Bảng Hồ sơ hiển thị đúng theo thứ tự mảng state.cases (không tự sort lại theo
          // sortOrder ở client) — phải tự đưa row lên đầu mảng ở đây để thấy nhảy lên NGAY,
          // không phải đợi reload mới thấy đúng vị trí.
          const idx = updated.findIndex((c) => c.id === caseId);
          if (idx > 0) {
            const [moved] = updated.splice(idx, 1);
            updated.unshift(moved);
          }
          return { cases: updated };
        });
        const kase = get().cases.find((c) => c.id === caseId);
        if (kase) {
          syncInBackground(
            "descriptionReply",
            api.patchCase(caseId, {
              descriptionReplies: kase.descriptionReplies,
              descriptionReadBy: kase.descriptionReadBy,
              sortOrder: newSortOrder,
            })
          );
        }
      },

      markDescriptionRead: (caseId, userId) => {
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId && !c.descriptionReadBy.includes(userId)
              ? { ...c, descriptionReadBy: [...c.descriptionReadBy, userId] }
              : c
          ),
        }));
        const kase = get().cases.find((c) => c.id === caseId);
        if (kase) syncInBackground("descriptionReadBy", api.patchCase(caseId, { descriptionReadBy: kase.descriptionReadBy }));
      },

      addColumn: (label, type, options) => {
        set((state) => {
          const key = uniqueId("custom");
          const col: ColumnDef = {
            id: key,
            key,
            label,
            type,
            editableBy: ["manager", "accounting", "agent", "processor", "support"],
            custom: true,
            width: 160,
            options:
              type === "select"
                ? (options ?? []).map((o) => ({ ...o, id: uniqueId("opt") }))
                : undefined,
          };
          return { columns: [...state.columns, col] };
        });
        syncConfig();
      },

      removeColumn: (columnId) => {
        set((state) => ({ columns: state.columns.filter((c) => c.id !== columnId) }));
        syncConfig();
      },

      renameColumn: (columnId, label) => {
        set((state) => ({
          columns: state.columns.map((c) => (c.id === columnId ? { ...c, label } : c)),
        }));
        syncConfig();
      },

      setColumnEditableBy: (columnId, roles) => {
        set((state) => ({
          columns: state.columns.map((c) => (c.id === columnId ? { ...c, editableBy: roles } : c)),
        }));
        syncConfig();
      },

      setColumnHiddenFromGrid: (columnId, hidden) => {
        set((state) => ({
          columns: state.columns.map((c) => (c.id === columnId ? { ...c, hiddenFromGrid: hidden } : c)),
        }));
        syncConfig();
      },

      addColumnOption: (columnId, option) => {
        set((state) => ({
          columns: state.columns.map((c) =>
            c.id === columnId
              ? { ...c, options: [...(c.options ?? []), { ...option, id: uniqueId("opt") }] }
              : c
          ),
        }));
        syncConfig();
      },

      updateColumnOption: (columnId, optionId, patch) => {
        set((state) => ({
          columns: state.columns.map((c) =>
            c.id === columnId
              ? { ...c, options: (c.options ?? []).map((o) => (o.id === optionId ? { ...o, ...patch } : o)) }
              : c
          ),
        }));
        syncConfig();
      },

      removeColumnOption: (columnId, optionId) => {
        set((state) => ({
          columns: state.columns.map((c) =>
            c.id === columnId ? { ...c, options: (c.options ?? []).filter((o) => o.id !== optionId) } : c
          ),
        }));
        syncConfig();
      },

      // ==== Tab "Collecting" — cùng cơ chế CRUD dòng + quản lý cột với bảng Hồ sơ ở trên,
      // tách state/API riêng (collectingColumns/collectingRecords, /api/collecting[/[id]]).
      updateCollectingCell: (rowId, columnKey, value) => {
        set((state) => ({
          collectingRecords: state.collectingRecords.map((r) =>
            r.id === rowId ? { ...r, custom: { ...r.custom, [columnKey]: value }, updatedAt: new Date().toISOString() } : r
          ),
        }));
        syncInBackground("updateCollectingCell", api.patchCollecting(rowId, { custom: { [columnKey]: value } }));
      },

      addCollectingRow: () => {
        const id = uniqueId("cl");
        const optimistic: CollectingRecord = {
          id,
          custom: {},
          sortOrder: -Date.now(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ collectingRecords: [optimistic, ...s.collectingRecords] }));
        api.createCollecting(optimistic).then(
          (serverRow) => {
            set((s) => ({ collectingRecords: s.collectingRecords.map((r) => (r.id === id ? serverRow : r)) }));
          },
          (err) => {
            console.error("[sync:addCollectingRow] Tạo dòng thất bại, hoàn tác dòng tạm:", err);
            set((s) => ({ collectingRecords: s.collectingRecords.filter((r) => r.id !== id) }));
          }
        );
      },

      deleteCollectingRow: (rowId) => {
        set((state) => ({ collectingRecords: state.collectingRecords.filter((r) => r.id !== rowId) }));
        syncInBackground("deleteCollectingRow", api.deleteCollecting(rowId));
      },

      reorderCollectingRow: (fromId, toId) => {
        let newSortOrder: number | null = null;
        set((state) => {
          if (fromId === toId) return {};
          const list = [...state.collectingRecords];
          const fromIdx = list.findIndex((r) => r.id === fromId);
          const toIdx = list.findIndex((r) => r.id === toId);
          if (fromIdx === -1 || toIdx === -1) return {};
          const [moved] = list.splice(fromIdx, 1);
          list.splice(toIdx, 0, moved);

          const movedIdx = list.findIndex((r) => r.id === fromId);
          const prev = list[movedIdx - 1];
          const next = list[movedIdx + 1];
          if (prev && next) newSortOrder = (prev.sortOrder + next.sortOrder) / 2;
          else if (prev) newSortOrder = prev.sortOrder + 1000;
          else if (next) newSortOrder = next.sortOrder - 1000;
          else newSortOrder = moved.sortOrder;

          list[movedIdx] = { ...moved, sortOrder: newSortOrder };
          return { collectingRecords: list };
        });
        if (newSortOrder !== null) {
          syncInBackground("reorderCollectingRow", api.patchCollecting(fromId, { sortOrder: newSortOrder }));
        }
      },

      // Tab "CPA Review" — bảng độc lập hoàn toàn với Case (yêu cầu 2026-08-14, "không liên
      // kết bất cứ gì"), cột cố định (không admin cấu hình như Collecting) — xem
      // src/lib/cpa-review-columns.ts.
      updateCpaReviewCell: (rowId, key, value) => {
        set((state) => ({
          cpaReviewRecords: state.cpaReviewRecords.map((r) =>
            r.id === rowId ? { ...r, custom: { ...r.custom, [key]: value }, updatedAt: new Date().toISOString() } : r
          ),
        }));
        syncInBackground("updateCpaReviewCell", api.patchCpaReview(rowId, { custom: { [key]: value } }));
      },

      addCpaReviewRow: () => {
        const id = uniqueId("cpar");
        const month = get().cpaReviewSelectedMonth;
        // Nối vào cuối bảng (dòng trống tiếp theo), không lên đầu — server tự tính lại
        // sortOrder thật khi lưu (xem nextAppendCpaReviewSortOrder), giá trị dưới đây chỉ để
        // hiển thị đúng vị trí ngay lập tức trước khi có phản hồi server.
        const monthMaxSortOrder = get()
          .cpaReviewRecords.filter((r) => r.month === month)
          .reduce((max, r) => Math.max(max, r.sortOrder), 0);
        const optimistic: CpaReviewRecord = {
          id,
          month,
          custom: {},
          sortOrder: monthMaxSortOrder + 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        // Nối vào CUỐI mảng (không phải đầu) — mảng cpaReviewRecords vốn đã sắp theo
        // sortOrder asc (từ GET /api/cpa-review), thêm optimistic vào cuối giữ đúng thứ tự
        // hiển thị "dòng mới nằm dưới cùng" ngay lập tức, không cần sort lại toàn bộ.
        set((s) => ({ cpaReviewRecords: [...s.cpaReviewRecords, optimistic] }));
        api.createCpaReview(optimistic).then(
          (serverRow) => {
            set((s) => ({ cpaReviewRecords: s.cpaReviewRecords.map((r) => (r.id === id ? serverRow : r)) }));
          },
          (err) => {
            console.error("[sync:addCpaReviewRow] Tạo dòng thất bại, hoàn tác dòng tạm:", err);
            set((s) => ({ cpaReviewRecords: s.cpaReviewRecords.filter((r) => r.id !== id) }));
          }
        );
      },

      deleteCpaReviewRow: (rowId) => {
        set((state) => ({ cpaReviewRecords: state.cpaReviewRecords.filter((r) => r.id !== rowId) }));
        syncInBackground("deleteCpaReviewRow", api.deleteCpaReview(rowId));
      },

      addCollectingColumn: (label, type, options) => {
        set((state) => {
          const key = uniqueId("clcol");
          const col: ColumnDef = {
            id: key,
            key,
            label,
            type,
            editableBy: ["manager"],
            custom: true,
            width: 140,
            options: type === "select" ? (options ?? []).map((o) => ({ ...o, id: uniqueId("opt") })) : undefined,
          };
          return { collectingColumns: [...state.collectingColumns, col] };
        });
        syncConfig();
      },

      removeCollectingColumn: (columnId) => {
        set((state) => ({ collectingColumns: state.collectingColumns.filter((c) => c.id !== columnId) }));
        syncConfig();
      },

      renameCollectingColumn: (columnId, label) => {
        set((state) => ({
          collectingColumns: state.collectingColumns.map((c) => (c.id === columnId ? { ...c, label } : c)),
        }));
        syncConfig();
      },

      setCollectingColumnEditableBy: (columnId, roles) => {
        set((state) => ({
          collectingColumns: state.collectingColumns.map((c) => (c.id === columnId ? { ...c, editableBy: roles } : c)),
        }));
        syncConfig();
      },

      setCollectingColumnHiddenFromGrid: (columnId, hidden) => {
        set((state) => ({
          collectingColumns: state.collectingColumns.map((c) => (c.id === columnId ? { ...c, hiddenFromGrid: hidden } : c)),
        }));
        syncConfig();
      },

      addCollectingColumnOption: (columnId, option) => {
        set((state) => ({
          collectingColumns: state.collectingColumns.map((c) =>
            c.id === columnId
              ? { ...c, options: [...(c.options ?? []), { ...option, id: uniqueId("opt") }] }
              : c
          ),
        }));
        syncConfig();
      },

      updateCollectingColumnOption: (columnId, optionId, patch) => {
        set((state) => ({
          collectingColumns: state.collectingColumns.map((c) =>
            c.id === columnId
              ? { ...c, options: (c.options ?? []).map((o) => (o.id === optionId ? { ...o, ...patch } : o)) }
              : c
          ),
        }));
        syncConfig();
      },

      removeCollectingColumnOption: (columnId, optionId) => {
        set((state) => ({
          collectingColumns: state.collectingColumns.map((c) =>
            c.id === columnId ? { ...c, options: (c.options ?? []).filter((o) => o.id !== optionId) } : c
          ),
        }));
        syncConfig();
      },

      reorderCollectingColumn: (fromId, toId) => {
        set((state) => {
          if (fromId === toId) return {};
          const cols = [...state.collectingColumns];
          const fromIdx = cols.findIndex((c) => c.id === fromId);
          const toIdx = cols.findIndex((c) => c.id === toId);
          if (fromIdx === -1 || toIdx === -1) return {};
          const [moved] = cols.splice(fromIdx, 1);
          cols.splice(toIdx, 0, moved);
          return { collectingColumns: cols };
        });
        syncConfig();
      },
      // ==== hết tab "Collecting" ====

      // ==== popup "For Processor" ====
      setProcessorReportSelectedMonth: (month) => set({ processorReportSelectedMonth: month }),

      fetchProcessorReportEntries: async (month, userId) => {
        const { entries } = await api.listProcessorReportEntries(month, userId);
        set({ processorReportEntries: entries });
      },

      upsertProcessorReportEntry: (taskId, date, value, userId) => {
        const meId = get().currentUserId ?? "";
        const targetUserId = userId ?? meId;
        set((state) => {
          const idx = state.processorReportEntries.findIndex((e) => e.taskId === taskId && e.date === date && e.userId === targetUserId);
          if (idx === -1) {
            return {
              processorReportEntries: [
                ...state.processorReportEntries,
                { id: uniqueId("pre"), userId: targetUserId, taskId, date, value },
              ],
            };
          }
          const next = [...state.processorReportEntries];
          next[idx] = { ...next[idx], value };
          return { processorReportEntries: next };
        });
        syncInBackground("upsertProcessorReportEntry", api.upsertProcessorReportEntry({ taskId, date, value, userId }));
      },

      fetchProcessorReportSummary: async (month) => {
        const summary = await api.getProcessorReportSummary(month);
        set({ processorReportSummary: summary });
      },

      addProcessorReportTask: (sectionId, sectionLabel, label) => {
        set((state) => {
          const sectionTasks = state.processorReportTasks.filter((t) => t.sectionId === sectionId);
          const sectionOrder = sectionTasks[0]?.sectionOrder ?? state.processorReportTasks.length + 1;
          const order = sectionTasks.length > 0 ? Math.max(...sectionTasks.map((t) => t.order)) + 1 : 1;
          const task = { id: uniqueId("task"), sectionId, sectionLabel, sectionOrder, label, order };
          return { processorReportTasks: [...state.processorReportTasks, task] };
        });
        syncConfig();
      },
      renameProcessorReportTask: (taskId, label) => {
        set((state) => ({
          processorReportTasks: state.processorReportTasks.map((t) => (t.id === taskId ? { ...t, label } : t)),
        }));
        syncConfig();
      },
      deleteProcessorReportTask: (taskId) => {
        set((state) => ({ processorReportTasks: state.processorReportTasks.filter((t) => t.id !== taskId) }));
        syncConfig();
      },
      reorderProcessorReportTask: (fromId, toId) => {
        set((state) => {
          if (fromId === toId) return {};
          const tasks = [...state.processorReportTasks];
          const fromIdx = tasks.findIndex((t) => t.id === fromId);
          const toIdx = tasks.findIndex((t) => t.id === toId);
          if (fromIdx === -1 || toIdx === -1) return {};
          const [moved] = tasks.splice(fromIdx, 1);
          tasks.splice(toIdx, 0, moved);
          return { processorReportTasks: tasks };
        });
        syncConfig();
      },

      connectProcessorReportSheet: async (link, month) => {
        try {
          return await api.connectProcessorReportSheet(link, month);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Kết nối thất bại" } as const;
        }
      },
      resyncProcessorReportSheet: async (month) => {
        try {
          return await api.resyncProcessorReportSheet(month);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Đồng bộ lại thất bại" } as const;
        }
      },
      disconnectProcessorReportSheet: async (month) => {
        await api.disconnectProcessorReportSheet(month);
      },
      // ==== hết popup "For Processor" ====

      addRefundYearStatusOption: (option) => {
        set((state) => ({
          refundYearStatusOptions: [...state.refundYearStatusOptions, { ...option, id: uniqueId("refstatus") }],
        }));
        syncConfig();
      },

      updateRefundYearStatusOption: (optionId, patch) => {
        set((state) => ({
          refundYearStatusOptions: state.refundYearStatusOptions.map((o) =>
            o.id === optionId ? { ...o, ...patch } : o
          ),
        }));
        syncConfig();
      },

      // Id "pending" gắn liền logic nhấp nháy đỏ + ô nhập lý do (hasPendingRefundYear trong
      // refund-status.ts) — chặn xoá ngay từ client (server cũng tự chặn, xem PUT
      // /api/config) để tránh optimistic update rồi bị server từ chối gây lệch state.
      removeRefundYearStatusOption: (optionId) => {
        if (optionId === "pending") return;
        set((state) => ({
          refundYearStatusOptions: state.refundYearStatusOptions.filter((o) => o.id !== optionId),
        }));
        syncConfig();
      },

      // Cùng pattern add/update/removeRefundYearStatusOption ở trên — danh sách Status của
      // tab "CPA Review" (thêm 2026-08-14, yêu cầu "cấu hình cho phép thêm sửa xóa và chỉnh
      // màu text, background trong dropbox status"). Không có id nào bị khoá xoá.
      addCpaReviewStatusOption: (option) => {
        set((state) => ({
          cpaReviewStatusOptions: [...state.cpaReviewStatusOptions, { ...option, id: uniqueId("cparstatus") }],
        }));
        syncConfig();
      },

      updateCpaReviewStatusOption: (optionId, patch) => {
        set((state) => ({
          cpaReviewStatusOptions: state.cpaReviewStatusOptions.map((o) =>
            o.id === optionId ? { ...o, ...patch } : o
          ),
        }));
        syncConfig();
      },

      removeCpaReviewStatusOption: (optionId) => {
        set((state) => ({
          cpaReviewStatusOptions: state.cpaReviewStatusOptions.filter((o) => o.id !== optionId),
        }));
        syncConfig();
      },

      // Ẩn/hiện 1 cột "đuôi" tab CPA Review cho MỌI user (thêm 2026-08-15).
      toggleCpaReviewHiddenColumn: (key) => {
        set((state) => ({
          cpaReviewHiddenColumns: state.cpaReviewHiddenColumns.includes(key)
            ? state.cpaReviewHiddenColumns.filter((k) => k !== key)
            : [...state.cpaReviewHiddenColumns, key],
        }));
        syncConfig();
      },

      // Thông báo "đã giao việc" giờ do server tạo (xem PATCH /api/cases/[id], so cũ/mới
      // 4 field assign) + đẩy realtime qua Pusher tới đúng người được giao — không tạo
      // local ở đây nữa (toUserId đằng nào cũng không phải người đang thao tác).
      assignCase: (caseId, toUserId, field) => {
        set((s) => ({
          cases: s.cases.map((c) =>
            c.id === caseId ? { ...c, [field]: toUserId, updatedAt: new Date().toISOString() } : c
          ),
        }));
        syncInBackground("assignCase", api.patchCase(caseId, { [field]: toUserId } as Partial<CaseRecord>));
      },

      markNotificationRead: (id) => {
        set((state) => ({
          notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        }));
        syncInBackground("markNotificationRead", api.markNotificationRead(id));
      },

      markAllNotificationsRead: () => {
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.toUserId === state.currentUserId ? { ...n, read: true } : n
          ),
        }));
        syncInBackground("markAllNotificationsRead", api.markAllNotificationsRead());
      },

      // Server tự sinh id thật (khác uniqueId cục bộ) + hash mật khẩu — phải đợi response
      // rồi mới thêm vào state để id luôn khớp với DB, tránh 2 nguồn id lệch nhau.
      addUser: async (user) => {
        try {
          const created = await api.createUser(user);
          set((state) => ({ users: [...state.users, { ...created, password: undefined }] }));
          return true;
        } catch (err) {
          console.error("[addUser] Tạo tài khoản thất bại:", err);
          return false;
        }
      },

      updateUserRole: (userId, role) => {
        set((state) => ({
          users: state.users.map((u) => (u.id === userId ? { ...u, role } : u)),
        }));
        syncInBackground("updateUserRole", api.updateUserRole(userId, role));
      },

      removeUser: (userId) => {
        set((state) => ({
          users: state.users.filter((u) => u.id !== userId),
          currentUserId: state.currentUserId === userId ? null : state.currentUserId,
        }));
        syncInBackground("removeUser", api.removeUser(userId));
      },

      // Xác minh mật khẩu hiện tại + hash mật khẩu mới đều do server làm (bcrypt) — local
      // không còn lưu password nên không tự kiểm tra được nữa, phải hỏi server.
      changePassword: async (userId, currentPassword, newPassword) => {
        try {
          await api.changePassword(userId, currentPassword, newPassword);
          return true;
        } catch {
          return false;
        }
      },

      // Admin đặt lại mật khẩu tài khoản KHÁC (không cần biết mật khẩu cũ) — khác
      // changePassword ở trên vốn dùng cho chính chủ tự đổi mật khẩu của mình.
      resetUserPassword: async (userId, newPassword) => {
        try {
          await api.resetUserPassword(userId, newPassword);
          return true;
        } catch {
          return false;
        }
      },

      updateAvatar: (userId, avatarUrl) => {
        set((state) => ({
          users: state.users.map((u) => (u.id === userId ? { ...u, avatarUrl } : u)),
        }));
        syncInBackground("updateAvatar", api.updateUserAvatar(userId, avatarUrl));
      },

      updateUserTeam: (userId, teamMemberIds) => {
        set((state) => ({
          users: state.users.map((u) => (u.id === userId ? { ...u, teamMemberIds } : u)),
        }));
        syncInBackground("updateUserTeam", api.updateUserTeam(userId, teamMemberIds));
      },

      setFeaturePermission: (feature, role, allowed) => {
        set((state) => {
          const current = state.featurePermissions[feature] ?? [];
          const next = allowed ? Array.from(new Set([...current, role])) : current.filter((r) => r !== role);
          return { featurePermissions: { ...state.featurePermissions, [feature]: next } };
        });
        syncConfig();
      },

      setCpaEmailDefaults: (defaults) => {
        set({ cpaEmailDefaults: defaults });
        syncConfig();
      },

      // Foreground: KHÔNG dùng syncInBackground — gửi mail có thể fail rõ ràng (sai App
      // Password, email không hợp lệ, file quá lớn...), UI cần await + báo lỗi ngay thay
      // vì optimistic-update-rồi-âm-thầm-log-console như các action khác trong file này.
      sendCpaEmail: async (caseId, payload) => {
        try {
          const result = await api.sendCpaEmail(caseId, payload);
          set((state) => ({
            cases: state.cases.map((c) => (c.id === caseId ? { ...c, cpaEmailSentAt: result.cpaEmailSentAt } : c)),
          }));
          const recipients = `To: ${payload.to.join(", ")}${payload.cc.length > 0 ? `; Cc: ${payload.cc.join(", ")}` : ""}`;
          logEdit(caseId, "Gửi mail CPA", "", `${recipients} — ${payload.subject}`);
          return { ok: true } as const;
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Gửi email thất bại" } as const;
        }
      },

      markCpaEmailSent: async (caseId, action) => {
        const result = await api.markCpaEmailSent(caseId, action);
        set((state) => ({
          cases: state.cases.map((c) => (c.id === caseId ? { ...c, cpaEmailSentAt: result.cpaEmailSentAt } : c)),
        }));
        logEdit(caseId, "Gửi mail CPA", "", action === "manual" ? "Đánh dấu đã gửi (thủ công)" : "Muốn gửi lại");
      },

      setGoogleSheetConfig: (config) => {
        set({ googleSheetConfig: config });
        syncConfig();
      },

      setCpaReviewSelectedMonth: (month) => set({ cpaReviewSelectedMonth: month }),

      connectCpaReviewSheet: async (link, month) => {
        try {
          const result = await api.connectCpaReviewSheet(link, month);
          set((state) => ({
            cpaReviewSheetConfig: {
              ...state.cpaReviewSheetConfig,
              [month]: {
                sheetId: result.sheetId,
                gid: result.gid,
                tabName: result.tabName,
                nameToUserId: {},
                connectedAt: new Date().toISOString(),
                connectedByUserId: get().currentUserId ?? "",
              },
            },
          }));
          return result;
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Kết nối thất bại" } as const;
        }
      },
      resyncCpaReviewSheet: async (month) => {
        try {
          return await api.resyncCpaReviewSheet(month);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Đồng bộ lại thất bại" } as const;
        }
      },
      updateCpaReviewNameMapping: async (nameToUserId, month) => {
        try {
          const result = await api.updateCpaReviewNameMapping(nameToUserId, month);
          set((state) => {
            const existing = state.cpaReviewSheetConfig[month];
            if (!existing) return state;
            return {
              cpaReviewSheetConfig: { ...state.cpaReviewSheetConfig, [month]: { ...existing, nameToUserId: result.nameToUserId } },
            };
          });
          return { ok: true } as const;
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Cập nhật thất bại" } as const;
        }
      },
      disconnectCpaReviewSheet: async (month) => {
        set((state) => {
          const next = { ...state.cpaReviewSheetConfig };
          delete next[month];
          return { cpaReviewSheetConfig: next };
        });
        await api.disconnectCpaReviewSheet(month).catch((err) => console.error("disconnectCpaReviewSheet", err));
      },

      // Foreground, cùng lý do sendCpaEmail — gửi có thể fail rõ ràng, cần await + báo
      // lỗi ngay. needsGoogleAuth:true khi server trả "GOOGLE_NOT_CONNECTED" (chưa kết
      // nối Google hoặc refresh_token đã bị server tự xoá do hết hạn/thu hồi).
      sendCaseRowToSheet: async (caseId, reviewYears) => {
        try {
          const result = await api.sendCaseRowToSheet(caseId, reviewYears);
          set((state) => ({
            cases: state.cases.map((c) => (c.id === caseId ? { ...c, sheetSentAt: result.sheetSentAt } : c)),
          }));
          logEdit(caseId, "Gửi dòng Google Sheet", "", "Đã gửi");
          return { ok: true } as const;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Gửi dữ liệu lên Google Sheet thất bại";
          if (message === "GOOGLE_NOT_CONNECTED") {
            return { ok: false, error: message, needsGoogleAuth: true } as const;
          }
          return { ok: false, error: message } as const;
        }
      },

      markCaseSheetSent: async (caseId, action) => {
        const result = await api.markCaseSheetSent(caseId, action);
        set((state) => ({
          cases: state.cases.map((c) => (c.id === caseId ? { ...c, sheetSentAt: result.sheetSentAt } : c)),
        }));
        logEdit(caseId, "Gửi dòng Google Sheet", "", action === "manual" ? "Đánh dấu đã gửi (thủ công)" : "Muốn gửi lại");
      },

      // Payload (custom) giờ dựng ở SERVER (buildCpaReviewCustomFromCase trong route) từ
      // đúng dữ liệu Case mới nhất trên DB, không dựng ở client nữa — tránh lệch dữ liệu
      // nếu case vừa được người khác sửa. Cùng route lưu luôn cpaReviewTestSentAt để nút
      // giữ đúng trạng thái "đã gửi" qua reload, giống sheetSentAt/cpaEmailSentAt.
      sendCaseRowToCpaReview: async (caseId, reviewYears, note, crmSource) => {
        try {
          const result = await api.sendCaseRowToCpaReview(caseId, reviewYears, note, crmSource);
          set((s) => ({
            cases: s.cases.map((c) => (c.id === caseId ? { ...c, cpaReviewTestSentAt: result.cpaReviewTestSentAt } : c)),
            // Server GỘP vào dòng đã có nếu cùng SSN/tháng (thêm 2026-08-15, tránh tạo 2 dòng
            // trùng SSN phá cache đồng bộ Sheet — xem test-cpa-review-sheet/route.ts) nên
            // record trả về có thể là 1 dòng ĐÃ CÓ SẴN trong state, không phải luôn luôn mới:
            // thay ID trùng nếu có, chỉ nối vào cuối nếu thực sự chưa từng thấy id này.
            cpaReviewRecords: s.cpaReviewRecords.some((r) => r.id === result.record.id)
              ? s.cpaReviewRecords.map((r) => (r.id === result.record.id ? result.record : r))
              : [...s.cpaReviewRecords, result.record],
          }));
          logEdit(caseId, "Test Sheet (CPA Review)", "", "Đã gửi");
          return { ok: true } as const;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Gửi sang tab CPA Review thất bại";
          return { ok: false, error: message } as const;
        }
      },

      markCaseCpaReviewTestSent: async (caseId, action) => {
        const result = await api.markCaseCpaReviewTestSent(caseId, action);
        set((state) => ({
          cases: state.cases.map((c) => (c.id === caseId ? { ...c, cpaReviewTestSentAt: result.cpaReviewTestSentAt } : c)),
        }));
        logEdit(caseId, "Test Sheet (CPA Review)", "", action === "manual" ? "Đánh dấu đã gửi (thủ công)" : "Muốn gửi lại");
      },

      sendCaseYearToCollecting: async (caseId, year, manual) => {
        try {
          const result = await api.sendCaseYearToCollecting(caseId, year, manual);
          set((s) => ({ collectingRecords: [result.record, ...s.collectingRecords] }));
          logEdit(caseId, "Send Collecting Report", "", `Năm ${year}`);
          return { ok: true } as const;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Gửi sang tab Collecting thất bại";
          return { ok: false, error: message } as const;
        }
      },

      connectGoogleAccount: () => {
        return new Promise<boolean>((resolve) => {
          if (typeof window === "undefined") {
            resolve(false);
            return;
          }
          const popup = window.open("/api/auth/google/start", "google-oauth", "width=500,height=650");
          if (!popup) {
            resolve(false);
            return;
          }
          let settled = false;
          function finish(ok: boolean) {
            if (settled) return;
            settled = true;
            window.removeEventListener("message", onMessage);
            clearInterval(pollClosed);
            resolve(ok);
          }
          function onMessage(event: MessageEvent) {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type === "google-oauth-done") finish(Boolean(event.data.ok));
          }
          window.addEventListener("message", onMessage);
          // Dự phòng nếu user tự đóng popup tay mà không hoàn tất (không có postMessage nào bắn ra).
          const pollClosed = setInterval(() => {
            if (popup.closed) finish(false);
          }, 500);
        });
      },

      setClientEmailTemplate: (template) => {
        set({ clientEmailTemplate: template });
        syncConfig();
      },

      // Foreground — chỉ dựng nội dung (gọi trước khi cho sửa tay ở màn hình soạn mail),
      // không lưu/gửi gì cả nên không cần cập nhật state nào trong store.
      previewRefundEmail: async (caseId, payload) => {
        try {
          const result = await api.previewRefundEmail(caseId, payload);
          return { ok: true, ...result } as const;
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Dựng nội dung email thất bại" } as const;
        }
      },

      // Foreground, cùng lý do sendCpaEmail/sendCaseRowToSheet — gửi có thể fail rõ ràng,
      // cần await + báo lỗi ngay. needsWebmailAuth:true khi server trả
      // "WEBMAIL_NOT_CONNECTED" (chưa kết nối webmail hoặc credential đã bị server tự xoá
      // do sai mật khẩu). `clientEmailSentAt` cập nhật vào case tương ứng khi gửi thành
      // công (thêm 2026-08-16) — giữ đúng màu xanh qua reload, giống sheetSentAt/
      // cpaEmailSentAt/cpaReviewTestSentAt.
      sendClientEmail: async (caseId, payload) => {
        // Route lưu taxIntByYear NGAY khi nhận request, TRƯỚC khi thử gửi SMTP — nên cập
        // nhật lạc quan local ngay cả khi gửi thất bại ở bước sau (WEBMAIL_NOT_CONNECTED/
        // lỗi SMTP), để lần mở popup gửi kế tiếp thấy đúng số vừa nhập, không cần đợi
        // reload/hydrate lại.
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId ? { ...c, taxIntByYear: { ...c.taxIntByYear, ...payload.taxInt } } : c
          ),
        }));
        try {
          const result = await api.sendClientEmail(caseId, payload);
          set((state) => ({
            cases: state.cases.map((c) => (c.id === caseId ? { ...c, clientEmailSentAt: result.clientEmailSentAt } : c)),
          }));
          logEdit(caseId, "Gửi email cho khách hàng", "", "Đã gửi");
          return { ok: true } as const;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Gửi email cho khách hàng thất bại";
          if (message === "WEBMAIL_NOT_CONNECTED") {
            return { ok: false, error: message, needsWebmailAuth: true } as const;
          }
          return { ok: false, error: message } as const;
        }
      },

      markClientEmailSent: async (caseId, action) => {
        const result = await api.markClientEmailSent(caseId, action);
        set((state) => ({
          cases: state.cases.map((c) => (c.id === caseId ? { ...c, clientEmailSentAt: result.clientEmailSentAt } : c)),
        }));
        logEdit(caseId, "Gửi email cho khách hàng", "", action === "manual" ? "Đánh dấu đã gửi (thủ công)" : "Muốn gửi lại");
      },

      // Kết nối mailbox webmail (mail.directfunder.com) riêng của user hiện tại — thay cho
      // popup OAuth Microsoft cũ. Nhận thẳng email/mật khẩu từ ConnectWebmailDialog (không
      // phải cơ chế popup+postMessage như connectGoogleAccount) vì SMTP không có màn hình
      // consent để redirect tới.
      connectWebmailAccount: async (email, password) => {
        try {
          await api.connectWebmailAccount(email, password);
          return { ok: true } as const;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Kết nối webmail thất bại";
          return { ok: false, error: message } as const;
        }
      },

      // Ghi chú: reorderColumn chỉ đổi thứ tự hiển thị cục bộ (lưu trong AppConfig.columns
      // qua syncConfig() ngay bên dưới). reorderCase lưu vào Case.sortOrder (xem hàm dưới).
      reorderColumn: (fromId, toId) => {
        set((state) => {
          if (fromId === toId) return {};
          const cols = [...state.columns];
          const fromIdx = cols.findIndex((c) => c.id === fromId);
          const toIdx = cols.findIndex((c) => c.id === toId);
          if (fromIdx === -1 || toIdx === -1) return {};
          const [moved] = cols.splice(fromIdx, 1);
          cols.splice(toIdx, 0, moved);
          return { columns: cols };
        });
        syncConfig();
      },

      // Kéo-thả xong: xếp lại mảng cục bộ như cũ, ĐỒNG THỜI tính lại sortOrder của dòng
      // vừa di chuyển bằng fractional indexing (trung bình sortOrder 2 hàng xóm mới của
      // nó) rồi PATCH lên server — nếu không lưu field này, GET /api/cases lần sau (vd.
      // sau khi reload) sẽ trả về theo sortOrder cũ trong DB, khiến dòng "nhảy về vị trí
      // cũ" (bug đã gặp trước khi có field sortOrder).
      reorderCase: (fromId, toId) => {
        let newSortOrder: number | null = null;
        set((state) => {
          if (fromId === toId) return {};
          const list = [...state.cases];
          const fromIdx = list.findIndex((c) => c.id === fromId);
          const toIdx = list.findIndex((c) => c.id === toId);
          if (fromIdx === -1 || toIdx === -1) return {};
          const [moved] = list.splice(fromIdx, 1);
          list.splice(toIdx, 0, moved);

          const movedIdx = list.findIndex((c) => c.id === fromId);
          const prev = list[movedIdx - 1];
          const next = list[movedIdx + 1];
          if (prev && next) newSortOrder = (prev.sortOrder + next.sortOrder) / 2;
          else if (prev) newSortOrder = prev.sortOrder + 1000;
          else if (next) newSortOrder = next.sortOrder - 1000;
          else newSortOrder = moved.sortOrder;

          list[movedIdx] = { ...moved, sortOrder: newSortOrder };
          return { cases: list };
        });
        if (newSortOrder !== null) {
          syncInBackground("reorderCase", api.patchCase(fromId, { sortOrder: newSortOrder }));
        }
      },

      addRule: async (content) => {
        try {
          const rule = await api.createRule(content);
          set((s) => ({ rules: [rule, ...s.rules] }));
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Thêm rule thất bại" };
        }
      },
      editRule: async (ruleId, content) => {
        try {
          const rule = await api.updateRule(ruleId, content);
          set((s) => ({ rules: s.rules.map((r) => (r.id === ruleId ? rule : r)) }));
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Sửa rule thất bại" };
        }
      },
      deleteRule: async (ruleId) => {
        try {
          const rule = await api.deleteRule(ruleId);
          set((s) => ({ rules: s.rules.map((r) => (r.id === ruleId ? rule : r)) }));
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Xoá rule thất bại" };
        }
      },
      };
    },
    {
      name: "direct-funder-store-v10",
      version: 28,
      migrate: (persisted, version) => {
        const state = persisted as PersistedShape;
        if (!state) return state as unknown as AppState;

        if (version < 1) {
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const oldStatus = c.status as string | undefined;
              const mapped = oldStatus ? OLD_STATUS_ID_MAP[oldStatus] : undefined;
              return mapped ? { ...c, status: mapped } : c;
            });
          }
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) => {
              if (col.id !== "status" || !Array.isArray(col.options)) return col;
              const currentIds = (col.options as Array<{ id: string }>).map((o) => o.id);
              const isUntouchedDefault =
                currentIds.length === OLD_DEFAULT_STATUS_IDS.length &&
                OLD_DEFAULT_STATUS_IDS.every((id) => currentIds.includes(id));
              if (!isUntouchedDefault) return col;
              const newStatusCol = DEFAULT_COLUMNS.find((c) => c.id === "status");
              return newStatusCol ? { ...col, options: newStatusCol.options } : col;
            });
          }
        }

        if (version < 2) {
          // Bỏ cột tick "done" và đổi cột "emailed" thành "order" (2 nút order8821 /
          // orderTtsWit) — giữ nguyên mọi tùy biến khác (label, editableBy, width...)
          // của cột, chỉ đổi định danh để khớp với ô render mới.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const { done, emailed, ...rest } = c as Record<string, unknown> & { done?: unknown; emailed?: unknown };
              return {
                ...rest,
                order8821: typeof rest.order8821 === "boolean" ? rest.order8821 : Boolean(emailed),
                orderTtsWit: typeof rest.orderTtsWit === "boolean" ? rest.orderTtsWit : false,
              };
            });
          }
          if (Array.isArray(state.columns)) {
            state.columns = state.columns
              .filter((col) => col.id !== "done")
              .map((col) => {
                if (col.id !== "emailed") return col;
                // Width cũ (62px) là cho checkbox, quá hẹp cho 2 nút order mới — luôn
                // dùng width mặc định mới, các tùy biến khác (label, editableBy...) giữ nguyên.
                const newWidth = DEFAULT_COLUMNS.find((c) => c.id === "order")?.width ?? 130;
                return { ...col, id: "order", key: "order", type: "order", width: newWidth };
              });
          }
        }

        if (version < 3) {
          // Tách "clientName" (1 chuỗi) thành clientFirstName/clientLastName (2 dòng,
          // giống layout SSN) — tách theo khoảng trắng đầu tiên, không mất dữ liệu tên cũ.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              if (typeof rec.clientFirstName === "string" && typeof rec.clientLastName === "string") return c;
              const oldName = typeof rec.clientName === "string" ? rec.clientName.trim() : "";
              const spaceIdx = oldName.indexOf(" ");
              const { clientName, ...rest } = rec;
              void clientName;
              return {
                ...rest,
                clientFirstName: spaceIdx === -1 ? oldName : oldName.slice(0, spaceIdx),
                clientLastName: spaceIdx === -1 ? "" : oldName.slice(spaceIdx + 1),
              };
            });
          }
        }

        if (version < 4) {
          // Client Name giờ có 2 dòng (2 khách hàng), mỗi dòng gồm First + Last Name
          // cùng 1 hàng — gộp clientFirstName/clientLastName cũ (1 khách) vào dòng đầu
          // của mảng `clients`, dòng thứ 2 để trống cho khách hàng phụ (nếu có).
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              if (Array.isArray(rec.clients)) return c;
              const { clientFirstName, clientLastName, ...rest } = rec;
              return {
                ...rest,
                clients: [
                  { firstName: typeof clientFirstName === "string" ? clientFirstName : "", lastName: typeof clientLastName === "string" ? clientLastName : "" },
                  { firstName: "", lastName: "" },
                ],
              };
            });
          }
        }

        if (version < 5) {
          // Cột Client Name giờ cho phép TẤT CẢ tài khoản sửa (kể cả chèn link), không
          // còn giới hạn Admin/Agent như trước — áp dụng bắt buộc vì đây không phải tùy
          // chọn có thể cấu hình qua UI cho cột này.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) =>
              col.id === "clientName"
                ? { ...col, editableBy: ["manager", "accounting", "agent", "processor", "support"] }
                : col
            );
          }
        }

        if (version < 6) {
          // Tính năng "Xóa hồ sơ" giờ mặc định mở cho TẤT CẢ bộ phận (không riêng Admin) —
          // ép cập nhật cho dữ liệu cũ đang bị kẹt ở quyền mặc định trước đây (chỉ manager).
          const fp = state.featurePermissions as Record<string, string[]> | undefined;
          if (fp) {
            fp.deleteRow = ["manager", "accounting", "agent", "processor", "support"];
          }
        }

        if (version < 7) {
          // Tách quyền cột "manageColumns" (gộp thêm/sửa/xóa) thành 2 quyền riêng:
          // "addColumn" (thêm cột mới) và "editColumn" (sửa/xóa cột) để phân quyền linh
          // hoạt hơn — role nào đã có quyền cũ thì được cấp cả 2 quyền mới, không mất quyền.
          const fp = state.featurePermissions as Record<string, string[]> | undefined;
          if (fp && Array.isArray(fp.manageColumns)) {
            fp.addColumn = fp.addColumn ?? [...fp.manageColumns];
            fp.editColumn = fp.editColumn ?? [...fp.manageColumns];
            delete fp.manageColumns;
          }
        }

        if (version < 8) {
          // Cột "order" trước đây giữ nguyên label cũ ("Emailed") khi đổi từ checkbox
          // sang 2 nút order — ép về đúng label "Order" và nới rộng width để hiển thị
          // đủ chữ "Order TTS & WIT" không bị cắt, không đụng tới dữ liệu case khác.
          if (Array.isArray(state.columns)) {
            const defaultOrderWidth = DEFAULT_COLUMNS.find((c) => c.id === "order")?.width ?? 150;
            state.columns = state.columns.map((col) =>
              col.id === "order" ? { ...col, label: "Order", width: defaultOrderWidth } : col
            );
          }
        }

        if (version < 9) {
          // Thêm mốc thời gian đặt order (order8821PlacedAt/orderTtsWitPlacedAt) để tab
          // Order sắp xếp được theo thời gian — hồ sơ cũ đã đặt order trước đây không có
          // mốc thời gian gốc nên để null (rơi xuống cuối danh sách), không suy đoán sai.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => ({
              ...c,
              order8821PlacedAt: typeof c.order8821PlacedAt === "string" ? c.order8821PlacedAt : null,
              orderTtsWitPlacedAt: typeof c.orderTtsWitPlacedAt === "string" ? c.orderTtsWitPlacedAt : null,
            }));
          }
        }

        if (version < 10) {
          // Thêm field "address" (dùng cho cột Address mới trong bảng Hồ sơ và bảng
          // Order) — chèn cột vào ngay sau "zipcode" cho tài khoản đang dùng, giữ
          // nguyên toàn bộ cột/tùy biến khác, không xóa dữ liệu.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => ({
              ...c,
              address: typeof c.address === "string" ? c.address : "",
            }));
          }
          if (Array.isArray(state.columns) && !state.columns.some((col) => col.id === "address")) {
            const addressCol = DEFAULT_COLUMNS.find((c) => c.id === "address");
            if (addressCol) {
              const zipIdx = state.columns.findIndex((col) => col.id === "zipcode");
              const insertAt = zipIdx === -1 ? state.columns.length : zipIdx + 1;
              state.columns = [
                ...state.columns.slice(0, insertAt),
                addressCol as unknown as Record<string, unknown>,
                ...state.columns.slice(insertAt),
              ];
            }
          }
        }

        if (version < 11) {
          // Thêm cột "Tài khoản đã Order" (order8821By/orderTtsWitBy) trong tab Order —
          // hồ sơ cũ đã đặt order từ trước không xác định lại được ai đã bấm nên để
          // null, không suy đoán sai. Đồng thời mở quyền sửa Address cho TẤT CẢ bộ
          // phận (giống chủ trương chung của các cột khác), ép cập nhật cho tài khoản
          // đang dùng vì đổi hằng số mặc định không tự áp dụng lên dữ liệu đã lưu.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => ({
              ...c,
              order8821By: typeof c.order8821By === "string" ? c.order8821By : null,
              orderTtsWitBy: typeof c.orderTtsWitBy === "string" ? c.orderTtsWitBy : null,
            }));
          }
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) =>
              col.id === "address"
                ? { ...col, editableBy: ["manager", "accounting", "agent", "processor", "support"] }
                : col
            );
          }
        }

        if (version < 12) {
          // Fix lỗi: id các bản ghi mới (tài khoản, hồ sơ...) từng được sinh bằng bộ
          // đếm lưu trong bộ nhớ (module-level), không lưu trữ — bộ đếm này reset về
          // giá trị ban đầu mỗi lần tải lại trang, nên 2 bản ghi tạo ở 2 lần tải trang
          // khác nhau có thể bị sinh TRÙNG id (ví dụ 2 tài khoản khác nhau cùng có id
          // "u-new-1" khiến đăng nhập tài khoản Support lại hiện ra tài khoản Processor
          // do trùng id). Việc sinh id giờ đã đổi sang uniqueId() (không còn bộ đếm) —
          // ở đây chỉ cần dò và tách các id bị trùng đã tồn tại sẵn trong dữ liệu cũ:
          // giữ nguyên id của bản ghi xuất hiện đầu tiên, chỉ đổi id cho (các) bản ghi
          // trùng phía sau, không xóa bất kỳ tài khoản/hồ sơ nào.
          if (Array.isArray(state.users)) {
            const seenUserIds = new Set<string>();
            state.users = state.users.map((u) => {
              const id = String(u.id ?? "");
              if (seenUserIds.has(id)) return { ...u, id: uniqueId("u") };
              seenUserIds.add(id);
              return u;
            });
          }
          if (Array.isArray(state.cases)) {
            const seenCaseIds = new Set<string>();
            state.cases = state.cases.map((c) => {
              const id = String(c.id ?? "");
              if (seenCaseIds.has(id)) return { ...c, id: uniqueId("c") };
              seenCaseIds.add(id);
              return c;
            });
          }
        }

        if (version < 13) {
          // Thêm field "assignedSupport" cho tính năng "Assign" trong tab Order (chỉ
          // gán được cho tài khoản nhóm Support) — hồ sơ cũ chưa gán ai nên để null.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => ({
              ...c,
              assignedSupport: typeof c.assignedSupport === "string" ? c.assignedSupport : null,
            }));
          }
        }

        if (version < 14) {
          // Bản trước từng chèn nhầm cột "Format Name" vào BẢNG HỒ SƠ chính — tính
          // năng này thực ra chỉ nên nằm trong tab Order, không phải bảng Hồ sơ. Dọn
          // lại cột đã lỡ chèn cho các tài khoản đã từng tải qua bản đó.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.filter((col) => col.id !== "formatName");
          }
        }

        if (version < 15) {
          // Thêm quyền riêng "assignSupport" cho cột Assign (giao tài khoản Support)
          // trong tab Order — tài khoản đang dùng chưa có quyền này nên ép mặc định
          // chỉ Admin, giữ nguyên mọi quyền khác đã cấu hình.
          const fp = state.featurePermissions as Record<string, string[]> | undefined;
          if (fp && !Array.isArray(fp.assignSupport)) {
            fp.assignSupport = ["manager"];
          }
        }

        if (version < 16) {
          // Thêm cột "Status" riêng cho tab Order (Done/Pending/Processing, khác với
          // Status ở bảng Hồ sơ) + field orderStatusUpdatedAt cho cột "Ngày thực hiện"
          // (tự ghi lại mốc thời gian mỗi khi Status trong tab Order đổi). Cột này
          // không hiển thị ở bảng Hồ sơ — chỉ chèn định nghĩa cột vào state để có chỗ
          // lưu quyền sửa/xóa (Admin cấu hình qua cùng dialog cài đặt cột như mọi cột
          // khác), không đụng tới dữ liệu case hiện có ngoài việc thêm field mới = null.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => ({
              ...c,
              orderStatus: typeof c.orderStatus === "string" ? c.orderStatus : null,
              orderStatusUpdatedAt: typeof c.orderStatusUpdatedAt === "string" ? c.orderStatusUpdatedAt : null,
            }));
          }
          if (Array.isArray(state.columns) && !state.columns.some((col) => col.id === "orderStatus")) {
            const orderStatusCol = DEFAULT_COLUMNS.find((c) => c.id === "orderStatus");
            if (orderStatusCol) {
              state.columns = [...state.columns, orderStatusCol as unknown as Record<string, unknown>];
            }
          }
        }

        if (version < 17) {
          // Cho phép Support sửa giá trị + thêm lựa chọn mới ở cột Status trong tab
          // Order (trước đây mặc định chỉ Admin) — ép cập nhật cho tài khoản đang dùng
          // vì đổi hằng số mặc định không tự áp dụng lên dữ liệu đã lưu.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) => {
              if (col.id !== "orderStatus") return col;
              const editableBy = Array.isArray(col.editableBy) ? (col.editableBy as string[]) : [];
              return editableBy.includes("support") ? col : { ...col, editableBy: [...editableBy, "support"] };
            });
          }
        }

        if (version < 18) {
          // Chuyển từ mô hình "1 hồ sơ = tối đa 1 order 8821 + 1 order TTS & WIT" (ghi
          // đè mỗi lần đặt lại) sang mô hình LỊCH SỬ: orders[] chứa TẤT CẢ các lần đặt
          // order, mỗi lần là 1 bản ghi độc lập (không ghi đè, không mất order cũ khi
          // đặt lại). Đồng thời tách hẳn Status/Assign của Order 8821 và Order TTS &
          // WIT — trước đây dùng chung 1 field ở cấp hồ sơ, giờ mỗi order có Status/
          // Assign riêng. Dữ liệu order cũ (nếu có) được chuyển nguyên vào bản ghi đầu
          // tiên tương ứng, không mất thông tin.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              if (Array.isArray(rec.orders)) return c;
              const orders: Record<string, unknown>[] = [];
              if (rec.order8821) {
                orders.push({
                  id: uniqueId("ord"),
                  type: "order8821",
                  placedAt: typeof rec.order8821PlacedAt === "string" ? rec.order8821PlacedAt : new Date().toISOString(),
                  placedBy: typeof rec.order8821By === "string" ? rec.order8821By : "",
                  status: typeof rec.orderStatus === "string" ? rec.orderStatus : null,
                  statusUpdatedAt: typeof rec.orderStatusUpdatedAt === "string" ? rec.orderStatusUpdatedAt : null,
                  assignedSupport: typeof rec.assignedSupport === "string" ? rec.assignedSupport : null,
                });
              }
              if (rec.orderTtsWit) {
                orders.push({
                  id: uniqueId("ord"),
                  type: "orderTtsWit",
                  placedAt:
                    typeof rec.orderTtsWitPlacedAt === "string" ? rec.orderTtsWitPlacedAt : new Date().toISOString(),
                  placedBy: typeof rec.orderTtsWitBy === "string" ? rec.orderTtsWitBy : "",
                  status: typeof rec.orderStatus === "string" ? rec.orderStatus : null,
                  statusUpdatedAt: typeof rec.orderStatusUpdatedAt === "string" ? rec.orderStatusUpdatedAt : null,
                  assignedSupport: typeof rec.assignedSupport === "string" ? rec.assignedSupport : null,
                });
              }
              const {
                order8821: _order8821,
                orderTtsWit: _orderTtsWit,
                order8821PlacedAt: _order8821PlacedAt,
                orderTtsWitPlacedAt: _orderTtsWitPlacedAt,
                order8821By: _order8821By,
                orderTtsWitBy: _orderTtsWitBy,
                orderStatus: _orderStatus,
                orderStatusUpdatedAt: _orderStatusUpdatedAt,
                assignedSupport: _assignedSupport,
                ...rest
              } = rec;
              return { ...rest, orders };
            });
          }
        }

        if (version < 19) {
          // Cột Case đổi format từ chuỗi "CASE-xxxx" sang số thuần "xxxx" — chỉ bỏ tiền
          // tố hiển thị, giữ nguyên số thứ tự nên không mất dữ liệu/lịch sử cũ.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              if (typeof rec.caseNumber !== "string") return c;
              return { ...c, caseNumber: rec.caseNumber.replace(/^CASE-/i, "") };
            });
          }
          if (Array.isArray(state.deletionHistory)) {
            state.deletionHistory = state.deletionHistory.map((d) => {
              const snap = d.caseSnapshot as unknown as Record<string, unknown>;
              if (typeof snap.caseNumber !== "string") return d;
              return { ...d, caseSnapshot: { ...d.caseSnapshot, caseNumber: snap.caseNumber.replace(/^CASE-/i, "") } };
            });
          }
          if (Array.isArray(state.editHistory)) {
            state.editHistory = state.editHistory.map((h) =>
              typeof h.caseNumber === "string" ? { ...h, caseNumber: h.caseNumber.replace(/^CASE-/i, "") } : h
            );
          }
        }

        if (version < 20) {
          // Header cột đổi sang chữ in hoa (rộng hơn chữ thường) khiến cột Money bị cắt
          // chữ ("MON…") ở width mặc định cũ (90px) — nới rộng cho các store đã lưu.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) =>
              col.id === "money" && col.width === 90 ? { ...col, width: 104 } : col
            );
          }
        }

        if (version < 21) {
          // Header dịch sang tiếng Việt dài hơn tiếng Anh (vd. "Phone" -> "Số điện
          // thoại", "Case" -> "Mã hồ sơ") khiến bị cắt chữ ở width mặc định cũ — nới
          // rộng cho các store đã lưu.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) => {
              if (col.id === "phone" && col.width === 112) return { ...col, width: 140 };
              if (col.id === "caseNumber" && col.width === 84) return { ...col, width: 104 };
              if (col.id === "zipcode" && col.width === 68) return { ...col, width: 92 };
              return col;
            });
          }
        }

        if (version < 22) {
          // Cột Case đổi text về "Case" (bỏ dịch "Mã hồ sơ") và bóp nhỏ lại vừa đủ, các
          // cột khác thu gọn để nhường chỗ cho cột Description mở rộng — mục tiêu xem
          // được cả bảng trong 1 màn hình, không cần kéo ngang.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) => {
              if (col.id === "clientName" && col.width === 230) return { ...col, width: 170 };
              if (col.id === "ssn" && col.width === 118) return { ...col, width: 84 };
              if (col.id === "zipcode" && col.width === 92) return { ...col, width: 92 };
              if (col.id === "address" && col.width === 180) return { ...col, width: 104 };
              if (col.id === "description" && col.width === 110) return { ...col, width: 150 };
              if (col.id === "caseNumber" && col.width === 104) return { ...col, width: 78 };
              if (col.id === "money" && col.width === 104) return { ...col, width: 100 };
              return col;
            });
          }
        }

        if (version < 23) {
          // Client Name/Agent/Processor bị cắt chữ ("Giao ...", "First na...") — nới
          // rộng vừa đủ để hiện đầy đủ text, đồng thời thu gọn thêm các cột khác
          // (Zip/Address/Description-min/Money/Order) để cả bảng vẫn vừa 1 màn hình.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) => {
              if (col.id === "clientName" && col.width === 170) return { ...col, width: 210 };
              if (col.id === "zipcode" && col.width === 92) return { ...col, width: 88 };
              if (col.id === "address" && col.width === 104) return { ...col, width: 90 };
              if (col.id === "description" && col.width === 150) return { ...col, width: 122 };
              if (col.id === "money" && col.width === 100) return { ...col, width: 94 };
              if (col.id === "order" && col.width === 150) return { ...col, width: 122 };
              return col;
            });
          }
        }

        if (version < 24) {
          // Tách cột Status dùng chung cho cả 2 tab Order (Order 8821 & Order TTS & WIT)
          // thành 2 cột RIÊNG BIỆT — trước đây "orderStatus" áp dụng chung cho cả 2 tab,
          // giờ mỗi tab tự quản lý (thêm/sửa/xóa/đổi màu) danh sách trạng thái của mình,
          // không dùng chung nữa. Nhân đôi cấu hình cũ (giữ nguyên editableBy + options
          // đã tùy biến) sang cả 2 cột mới để không mất dữ liệu đã cấu hình — từ đây trở
          // đi 2 cột tách nhau hoàn toàn, sửa cột này không ảnh hưởng cột kia.
          if (Array.isArray(state.columns)) {
            const old = state.columns.find((col) => col.id === "orderStatus") as
              | Record<string, unknown>
              | undefined;
            if (old) {
              const { id: _id, key: _key, ...rest } = old;
              const options = Array.isArray(old.options) ? (old.options as Record<string, unknown>[]) : [];
              state.columns = [
                ...state.columns.filter((col) => col.id !== "orderStatus"),
                { ...rest, id: "orderStatusOrder8821", key: "orderStatusOrder8821", options: options.map((o) => ({ ...o })) },
                { ...rest, id: "orderStatusOrderTtsWit", key: "orderStatusOrderTtsWit", options: options.map((o) => ({ ...o })) },
              ];
            } else if (!state.columns.some((col) => col.id === "orderStatusOrder8821")) {
              const extra = DEFAULT_COLUMNS.filter(
                (c) => c.id === "orderStatusOrder8821" || c.id === "orderStatusOrderTtsWit"
              );
              state.columns = [...state.columns, ...(extra as unknown as Record<string, unknown>[])];
            }
          }
        }

        if (version < 25) {
          // Case bị cache cũ (localStorage) từ TRƯỚC khi thêm phone2/email/dateOfBirth/
          // refunds vào CaseRecord thiếu hẳn các field này -> ClientProfileDialog (render
          // KHÔNG ĐIỀU KIỆN cho mọi dòng trong bảng, kể cả khi popup đang đóng) gọi
          // refunds[year] trên `undefined` -> crash TOÀN BỘ trang Hồ sơ ngay từ lần render
          // đầu, TRƯỚC khi hydrateFromServer() kịp ghi đè bằng dữ liệu thật từ server. Bug
          // này lộ ra trên production vì user có sẵn cache cũ trong trình duyệt — dev
          // luôn xoá localStorage/dùng máy sạch nên không tự phát hiện được lúc code.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              return {
                ...rec,
                phone2: typeof rec.phone2 === "string" ? rec.phone2 : "",
                email: typeof rec.email === "string" ? rec.email : "",
                dateOfBirth: Array.isArray(rec.dateOfBirth) ? rec.dateOfBirth : [null, null],
                refunds: rec.refunds && typeof rec.refunds === "object" ? rec.refunds : {},
              };
            });
          }
        }

        if (version < 26) {
          // Thêm sheetSentAt/cpaEmailSentAt vào CaseRecord — case cache cũ thiếu 2 field
          // này chỉ khiến SendToSheetButton/SendCpaEmailDialog coi như "chưa gửi"
          // (Boolean(undefined) === false, không crash như vụ refunds ở version 25), nhưng
          // vẫn backfill null tường minh cho nhất quán, tránh field "undefined" lạ trong
          // state.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              return {
                ...rec,
                sheetSentAt: typeof rec.sheetSentAt === "string" ? rec.sheetSentAt : null,
                cpaEmailSentAt: typeof rec.cpaEmailSentAt === "string" ? rec.cpaEmailSentAt : null,
              };
            });
          }
        }

        if (version < 27) {
          // Cùng lỗi đã gặp ở version 25 (xem comment phía trên) nhưng cho 2 field mới hơn:
          // case cache cũ (localStorage) từ TRƯỚC khi thêm refundYearStatus/
          // refundYearPendingReason thiếu hẳn 2 field này -> CaseRefundStatusButton (nút mắt
          // cạnh cột Case) đọc refundYearStatus[year]/refundYearPendingReason[year] trên
          // `undefined` -> "Cannot read properties of undefined (reading '2023')" -> crash
          // toàn bộ trang Hồ sơ ngay từ lần render đầu, TRƯỚC khi hydrateFromServer() kịp ghi
          // đè bằng dữ liệu thật từ server. Chỉ lộ ra trên production vì user có sẵn cache cũ.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              return {
                ...rec,
                refundYearStatus: rec.refundYearStatus && typeof rec.refundYearStatus === "object" ? rec.refundYearStatus : {},
                refundYearPendingReason:
                  rec.refundYearPendingReason && typeof rec.refundYearPendingReason === "object"
                    ? rec.refundYearPendingReason
                    : {},
              };
            });
          }
        }

        if (version < 28) {
          // Cùng lỗi đã gặp ở version 27 nhưng cho refundYearEfileDate (thêm 2026-08-13,
          // đồng bộ 2 chiều "CPA Review") — case cache cũ thiếu field này khiến
          // refundYearEfileDate[year] đọc trên `undefined` khi popup "Refund by years" mở.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              return {
                ...rec,
                refundYearEfileDate:
                  rec.refundYearEfileDate && typeof rec.refundYearEfileDate === "object" ? rec.refundYearEfileDate : {},
              };
            });
          }
        }

        return state as unknown as AppState;
      },
    }
  )
);

// Dùng useShallow (thay vì đọc thẳng state.users rồi .find()) — mỗi lần hydrateFromServer/
// refetchCases chạy, mảng users được thay bằng mảng JSON mới hoàn toàn nên object user hiện
// tại cũng luôn là instance MỚI dù giá trị thật không đổi, khiến MỌI nơi gọi useCurrentUser()
// (TopNav, DashboardLayout — bọc quanh toàn bộ dashboard) re-render dù chẳng có gì thay đổi
// thật. useShallow so sánh nông theo TỪNG FIELD của object trả về, chỉ trigger re-render khi
// giá trị field thực sự khác, giảm hẳn re-render thừa khi có realtime cập nhật users/cases.
export function useCurrentUser() {
  return useAppStore(
    useShallow((s) => s.users.find((u) => u.id === s.currentUserId) ?? null)
  );
}
