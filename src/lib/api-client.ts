import type {
  AppNotification,
  CaseRecord,
  ClientEmailTemplate,
  CollectingRecord,
  CollectingReportManualFields,
  ColumnDef,
  CpaEmailDefaults,
  CpaReviewRecord,
  CpaReviewSheetConfig,
  DeletedRowRecord,
  EditHistoryRecord,
  FeaturePermissions,
  GoogleSheetConfig,
  ProcessorReportEntry,
  ProcessorReportMonthlySummaryEntry,
  ProcessorReportTaskDef,
  Role,
  RuleRecord,
  SelectOption,
  SmsConversationSummary,
  SmsMessageRecord,
  User,
} from "./types";
import { getSocketId } from "./pusher-client";

class ApiError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // Gắn socket_id Pusher hiện tại (nếu có) — server đọc header này để loại trừ, không bắn
  // lại tín hiệu/thông báo realtime cho chính người vừa thao tác (xem pusher-server.ts).
  const socketId = getSocketId();
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(socketId ? { "X-Pusher-Socket-Id": socketId } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  role: Role;
  avatarColor: string;
  avatarUrl: string | null;
  teamMemberIds?: string[];
  webmailUsername?: string | null;
}

export const api = {
  /** identifier — email HOẶC username, server tự nhận diện (xem POST /api/auth/login). */
  login: (identifier: string, password: string) =>
    request<ApiUser>("/api/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  me: () => request<ApiUser>("/api/me"),

  listUsers: () => request<ApiUser[]>("/api/users"),
  createUser: (user: Omit<User, "id">) => request<ApiUser>("/api/users", { method: "POST", body: JSON.stringify(user) }),
  updateUserRole: (userId: string, role: Role) =>
    request<ApiUser>(`/api/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  updateUserAvatar: (userId: string, avatarUrl: string | null) =>
    request<ApiUser>(`/api/users/${userId}`, { method: "PATCH", body: JSON.stringify({ avatarUrl }) }),
  updateUserTeam: (userId: string, teamMemberIds: string[]) =>
    request<ApiUser>(`/api/users/${userId}`, { method: "PATCH", body: JSON.stringify({ teamMemberIds }) }),
  changePassword: (userId: string, currentPassword: string, newPassword: string) =>
    request<{ ok: true }>(`/api/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  /** Admin đặt lại mật khẩu tài khoản KHÁC, không cần mật khẩu cũ (xem PATCH /api/users/[id]). */
  resetUserPassword: (userId: string, newPassword: string) =>
    request<{ ok: true }>(`/api/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ adminNewPassword: newPassword }),
    }),
  removeUser: (userId: string) => request<{ ok: true }>(`/api/users/${userId}`, { method: "DELETE" }),

  listCases: () => request<CaseRecord[]>("/api/cases"),
  createCase: (kase: CaseRecord) => request<CaseRecord>("/api/cases", { method: "POST", body: JSON.stringify(kase) }),
  patchCase: (caseId: string, patch: Partial<CaseRecord>) =>
    request<{ id: string; updatedAt: string }>(`/api/cases/${caseId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCase: (caseId: string) => request<{ ok: true }>(`/api/cases/${caseId}`, { method: "DELETE" }),

  listCollecting: () => request<CollectingRecord[]>("/api/collecting"),
  createCollecting: (row: CollectingRecord) =>
    request<CollectingRecord>("/api/collecting", { method: "POST", body: JSON.stringify(row) }),
  patchCollecting: (rowId: string, patch: Partial<CollectingRecord>) =>
    request<{ id: string; updatedAt: string }>(`/api/collecting/${rowId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCollecting: (rowId: string) => request<{ ok: true }>(`/api/collecting/${rowId}`, { method: "DELETE" }),

  listCpaReview: (month?: string) =>
    request<CpaReviewRecord[]>(month ? `/api/cpa-review?month=${encodeURIComponent(month)}` : "/api/cpa-review"),
  createCpaReview: (row: CpaReviewRecord) =>
    request<CpaReviewRecord>("/api/cpa-review", { method: "POST", body: JSON.stringify(row) }),
  patchCpaReview: (rowId: string, patch: Partial<CpaReviewRecord>) =>
    request<{ id: string; updatedAt: string }>(`/api/cpa-review/${rowId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCpaReview: (rowId: string) => request<{ ok: true }>(`/api/cpa-review/${rowId}`, { method: "DELETE" }),

  getConfig: () =>
    request<{
      columns: ColumnDef[];
      featurePermissions: FeaturePermissions;
      cpaEmailDefaults: CpaEmailDefaults | null;
      cpaSenderEmail: string | null;
      googleSheetConfig: GoogleSheetConfig | null;
      clientEmailTemplate: ClientEmailTemplate | null;
      refundYearStatusOptions: SelectOption[] | null;
      collectingColumns: ColumnDef[] | null;
      cpaReviewStatusOptions: SelectOption[] | null;
      cpaReviewHiddenColumns: string[] | null;
      cpaReviewSheetConfig: Record<string, Omit<CpaReviewSheetConfig, "webhookSecret" | "rowIndex">> | null;
      processorReportTasks: ProcessorReportTaskDef[] | null;
    }>("/api/config"),
  putConfig: (
    columns: ColumnDef[],
    featurePermissions: FeaturePermissions,
    cpaEmailDefaults?: CpaEmailDefaults,
    googleSheetConfig?: GoogleSheetConfig,
    clientEmailTemplate?: ClientEmailTemplate,
    refundYearStatusOptions?: SelectOption[],
    collectingColumns?: ColumnDef[],
    cpaReviewStatusOptions?: SelectOption[],
    cpaReviewHiddenColumns?: string[],
    processorReportTasks?: ProcessorReportTaskDef[]
  ) =>
    request<{
      columns: ColumnDef[];
      featurePermissions: FeaturePermissions;
      cpaEmailDefaults: CpaEmailDefaults | null;
      googleSheetConfig: GoogleSheetConfig | null;
      clientEmailTemplate: ClientEmailTemplate | null;
      refundYearStatusOptions: SelectOption[] | null;
      collectingColumns: ColumnDef[] | null;
      cpaReviewStatusOptions: SelectOption[] | null;
      cpaReviewHiddenColumns: string[] | null;
      processorReportTasks: ProcessorReportTaskDef[] | null;
    }>("/api/config", {
      method: "PUT",
      body: JSON.stringify({
        columns,
        featurePermissions,
        cpaEmailDefaults,
        collectingColumns,
        googleSheetConfig,
        clientEmailTemplate,
        refundYearStatusOptions,
        cpaReviewStatusOptions,
        cpaReviewHiddenColumns,
        processorReportTasks,
      }),
    }),

  /** Gửi email cho CPA từ 1 hồ sơ — xem POST /api/cases/[id]/send-cpa-email. Server trả về
   * cpaEmailSentAt (ISO) đã lưu xuống DB — store dùng giá trị này thay vì tự đặt Date.now()
   * để khớp đúng giờ server. */
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
  ) =>
    request<{ ok: true; cpaEmailSentAt: string }>(`/api/cases/${caseId}/send-cpa-email`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Đánh dấu "Đã gửi" mail CPA thủ công (manual) hoặc xoá đánh dấu đó khi xác nhận "muốn
   * gửi lại" (clear) — KHÔNG gọi Gmail thật, chỉ ghi/xoá cpaEmailSentAt trong DB. Dùng
   * chung route POST /api/cases/[id]/send-cpa-email, phân biệt qua body. */
  markCpaEmailSent: (caseId: string, action: "manual" | "clear") =>
    request<{ ok: true; cpaEmailSentAt: string | null }>(`/api/cases/${caseId}/send-cpa-email`, {
      method: "POST",
      body: JSON.stringify({ [action]: true }),
    }),

  /** Đẩy 1 dòng dữ liệu hồ sơ lên Google Sheet — xem POST /api/cases/[id]/send-to-sheet.
   * Lỗi "GOOGLE_NOT_CONNECTED" (HTTP 428, xem request() ném ApiError với message này) báo
   * hiệu UI cần mở popup kết nối Google trước khi gọi lại. Server trả về sheetSentAt (ISO)
   * đã lưu xuống DB. */
  sendCaseRowToSheet: (caseId: string, reviewYears?: string[]) =>
    request<{ ok: true; sheetSentAt: string }>(`/api/cases/${caseId}/send-to-sheet`, {
      method: "POST",
      body: JSON.stringify({ reviewYears }),
    }),

  /** Đánh dấu "Đã gửi" Google Sheet thủ công (manual) hoặc xoá đánh dấu đó khi xác nhận
   * "muốn gửi lại" (clear) — KHÔNG gọi Google Sheets API thật, chỉ ghi/xoá sheetSentAt
   * trong DB. Dùng chung route POST /api/cases/[id]/send-to-sheet, phân biệt qua body. */
  markCaseSheetSent: (caseId: string, action: "manual" | "clear") =>
    request<{ ok: true; sheetSentAt: string | null }>(`/api/cases/${caseId}/send-to-sheet`, {
      method: "POST",
      body: JSON.stringify({ [action]: true }),
    }),

  /** Nút "Test Sheet" — tạo 1 dòng mới trong tab CPA Review (tháng hiện tại) từ hồ sơ này,
   * xem POST /api/cases/[id]/test-cpa-review-sheet. */
  sendCaseRowToCpaReview: (caseId: string, reviewYears: string[], note?: string, crmSource?: string) =>
    request<{ ok: true; cpaReviewTestSentAt: string; record: CpaReviewRecord }>(
      `/api/cases/${caseId}/test-cpa-review-sheet`,
      { method: "POST", body: JSON.stringify({ reviewYears, note, crmSource }) }
    ),

  /** Tương tự markCaseSheetSent nhưng cho nút "Test Sheet" — dùng chung route
   * POST /api/cases/[id]/test-cpa-review-sheet, phân biệt qua body. */
  markCaseCpaReviewTestSent: (caseId: string, action: "manual" | "clear") =>
    request<{ ok: true; cpaReviewTestSentAt: string | null }>(`/api/cases/${caseId}/test-cpa-review-sheet`, {
      method: "POST",
      body: JSON.stringify({ [action]: true }),
    }),

  /** Nút "Send Collecting Report" trước mỗi năm trong popup "Refund by years" — tạo 1 dòng
   * mới trong tab Collecting từ hồ sơ này + đúng số refund của năm được bấm + các trường
   * nhập tay ở popup xác nhận, xem POST /api/cases/[id]/send-collecting-report. */
  sendCaseYearToCollecting: (caseId: string, year: string, manual: CollectingReportManualFields) =>
    request<{ ok: true; record: CollectingRecord }>(`/api/cases/${caseId}/send-collecting-report`, {
      method: "POST",
      body: JSON.stringify({ year, ...manual }),
    }),

  /** Dựng trước Subject + nội dung HTML (chưa gắn chữ ký) cho màn hình "soạn mail" — bấm
   * "Confirm" ở popup chọn năm gọi route này trước khi cho sửa tay. Xem POST
   * /api/cases/[id]/refund-email-preview. */
  previewRefundEmail: (
    caseId: string,
    payload: { years: string[]; language: "vi" | "en"; taxInt: Record<string, string> }
  ) =>
    request<{ subject: string; bodyHtml: string; to: string[]; cc: string[] }>(`/api/cases/${caseId}/refund-email-preview`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Gửi email "Thông báo hoàn thuế" cho khách hàng của 1 hồ sơ — xem POST
   * /api/cases/[id]/send-client-email. `subject`/`bodyHtml`/`to`/`cc` là bản đã (có thể)
   * sửa tay ở màn hình soạn mail (sau khi gọi previewRefundEmail); `attachments` là tệp
   * người dùng tự thêm ở màn hình đó (base64, cùng dạng CpaEmailAttachment). Lỗi
   * "WEBMAIL_NOT_CONNECTED" (HTTP 428, xem request() ném ApiError với message này) báo hiệu
   * UI cần mở ConnectWebmailDialog trước khi gọi lại. Server trả về clientEmailSentAt (ISO)
   * đã lưu xuống DB — trạng thái "đã gửi" bền vững qua reload, giống sheetSentAt/
   * cpaEmailSentAt/cpaReviewTestSentAt. */
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
  ) =>
    request<{ ok: true; clientEmailSentAt: string }>(`/api/cases/${caseId}/send-client-email`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Đánh dấu "Đã gửi" mail khách hàng thủ công (manual) hoặc xoá đánh dấu đó khi xác nhận
   * "muốn gửi lại" (clear) — KHÔNG gọi SMTP thật, chỉ ghi/xoá clientEmailSentAt trong DB.
   * Dùng chung route POST /api/cases/[id]/send-client-email, phân biệt qua body. */
  markClientEmailSent: (caseId: string, action: "manual" | "clear") =>
    request<{ ok: true; clientEmailSentAt: string | null }>(`/api/cases/${caseId}/send-client-email`, {
      method: "POST",
      body: JSON.stringify({ [action]: true }),
    }),

  /** Kết nối mailbox webmail (mail.directfunder.com) riêng của user hiện tại — xem POST
   * /api/me/webmail-account. Server tự xác minh đăng nhập SMTP trước khi lưu, ném ApiError
   * với message tiếng Việt rõ ràng nếu sai email/mật khẩu. */
  connectWebmailAccount: (email: string, password: string) =>
    request<{ ok: true }>("/api/me/webmail-account", { method: "POST", body: JSON.stringify({ email, password }) }),
  /** Ngắt kết nối mailbox webmail của user hiện tại — xem DELETE /api/me/webmail-account. */
  disconnectWebmailAccount: () => request<{ ok: true }>("/api/me/webmail-account", { method: "DELETE" }),

  /** Khung chat SMS (RingCentral) theo hồ sơ — xem src/app/api/cases/[id]/sms/route.ts. */
  listSms: (caseId: string) => request<SmsMessageRecord[]>(`/api/cases/${caseId}/sms`),
  sendSms: (caseId: string, text: string) =>
    request<SmsMessageRecord>(`/api/cases/${caseId}/sms`, { method: "POST", body: JSON.stringify({ text }) }),
  markSmsRead: (caseId: string) => request<{ ok: true; updated: number }>(`/api/cases/${caseId}/sms/mark-read`, { method: "POST" }),

  /** Hộp thư tổng hợp SMS (SmsInboxButton, cạnh chuông thông báo) — theo số điện thoại
   * trực tiếp, không cần biết hồ sơ nào. Xem src/app/api/sms/**. */
  listSmsInbox: () => request<SmsConversationSummary[]>("/api/sms/inbox"),
  listSmsThreadByPhone: (phone: string) => request<SmsMessageRecord[]>(`/api/sms/thread?phone=${encodeURIComponent(phone)}`),
  sendSmsByPhone: (phone: string, text: string) =>
    request<SmsMessageRecord>("/api/sms/thread", { method: "POST", body: JSON.stringify({ phone, text }) }),
  markSmsThreadReadByPhone: (phone: string) =>
    request<{ ok: true; updated: number }>("/api/sms/thread/mark-read", { method: "POST", body: JSON.stringify({ phone }) }),
  deleteSmsMessage: (messageId: string) => request<{ ok: true }>(`/api/sms/thread/message/${messageId}`, { method: "DELETE" }),
  deleteSmsThread: (phone: string) =>
    request<{ ok: true; deleted: number }>(`/api/sms/thread?phone=${encodeURIComponent(phone)}`, { method: "DELETE" }),

  /** Lưu toàn bộ nội dung popup "Edit Hồ sơ" (ClientProfileDialog) trong 1 lần gọi —
   * server tự tính lại `money`/`custom.caseLabel` từ `refunds`, trả về giá trị đã tính
   * để store cập nhật local state khớp đúng server (không tin giá trị optimistic). */
  updateClientProfile: (caseId: string, payload: ClientProfilePayload) =>
    request<{ id: string; money: number; custom: Record<string, unknown>; updatedAt: string }>(
      `/api/cases/${caseId}/client-profile`,
      { method: "POST", body: JSON.stringify(payload) }
    ),

  listNotifications: () => request<AppNotification[]>("/api/notifications"),
  markNotificationRead: (id: string) => request<{ ok: true }>(`/api/notifications/${id}`, { method: "PATCH" }),
  markAllNotificationsRead: () => request<{ ok: true }>("/api/notifications/mark-all-read", { method: "POST" }),

  listRules: () => request<RuleRecord[]>("/api/rules"),
  createRule: (content: string) => request<RuleRecord>("/api/rules", { method: "POST", body: JSON.stringify({ content }) }),
  updateRule: (ruleId: string, content: string) =>
    request<RuleRecord>(`/api/rules/${ruleId}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  deleteRule: (ruleId: string) => request<RuleRecord>(`/api/rules/${ruleId}`, { method: "DELETE" }),

  /** Kết nối Sheet CPA Review (dán link) — NHẬP TOÀN BỘ dòng có SSN trong Sheet thành
   * CpaReviewRecord mới (bảng độc lập, không có Case sẵn để đối chiếu). Trả về
   * webhookSecret + đoạn Apps Script mẫu ĐÚNG 1 LẦN duy nhất lúc này (không lấy lại được
   * sau, GET /api/config lược bỏ secret) — xem POST /api/config/cpa-review-sheet. */
  connectCpaReviewSheet: (link: string, month: string) =>
    request<{
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
    }>("/api/config/cpa-review-sheet", { method: "POST", body: JSON.stringify({ action: "connect", link, month }) }),
  /** Đẩy lại toàn bộ record của 1 tháng lên Sheet CPA Review đã kết nối tháng đó — dùng khi
   * nghi ngờ rowIndex cache bị lệch. */
  resyncCpaReviewSheet: (month: string) =>
    request<{ ok: true; pushed: number }>("/api/config/cpa-review-sheet", {
      method: "POST",
      body: JSON.stringify({ action: "resync", month }),
    }),
  updateCpaReviewNameMapping: (nameToUserId: Record<string, string>, month: string) =>
    request<{ ok: true; nameToUserId: Record<string, string> }>("/api/config/cpa-review-sheet", {
      method: "PATCH",
      body: JSON.stringify({ nameToUserId, month }),
    }),
  disconnectCpaReviewSheet: (month: string) =>
    request<{ ok: true }>(`/api/config/cpa-review-sheet?month=${encodeURIComponent(month)}`, { method: "DELETE" }),
  /** Cho popup "Hướng dẫn" trên tab CPA Review — email Service Account để Admin dán vào ô
   * Share Sheet, không phải bí mật. */
  getCpaReviewSyncInfo: (month: string) =>
    request<{ serviceAccountConfigured: boolean; serviceAccountEmail: string | null; appsScript: string | null }>(
      `/api/config/cpa-review-sheet?month=${encodeURIComponent(month)}`
    ),

  listEditHistory: () => request<EditHistoryRecord[]>("/api/history/edits"),
  createEditHistoryEntry: (entry: Omit<EditHistoryRecord, "id" | "editedByUserId" | "editedAt">) =>
    request<EditHistoryRecord>("/api/history/edits", { method: "POST", body: JSON.stringify(entry) }),
  listDeletionHistory: () => request<DeletedRowRecord[]>("/api/history/deletions"),
  createDeletionHistoryEntry: (caseSnapshot: CaseRecord) =>
    request<DeletedRowRecord>("/api/history/deletions", { method: "POST", body: JSON.stringify({ caseSnapshot }) }),

  /** Popup "For Processor" — bảng cá nhân Processor (tab Report). `userId` chỉ có ý nghĩa
   * khi người gọi là manager/processor_leader xem hộ 1 Processor khác. */
  listProcessorReportEntries: (month: string, userId?: string) =>
    request<{ entries: ProcessorReportEntry[] }>(
      `/api/processor-report/entries?month=${encodeURIComponent(month)}${userId ? `&userId=${encodeURIComponent(userId)}` : ""}`
    ),
  upsertProcessorReportEntry: (payload: { taskId: string; date: string; value: number; userId?: string }) =>
    request<{ entry: ProcessorReportEntry }>("/api/processor-report/entries", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  /** Bảng tổng hợp cho Processor Leader/Quản lý (đọc cache đã tính sẵn, không tính lại). */
  getProcessorReportSummary: (month: string) =>
    request<{ entries: ProcessorReportMonthlySummaryEntry[]; processors: { id: string; name: string }[] }>(
      `/api/processor-report/summary?month=${encodeURIComponent(month)}`
    ),

  /** Kết nối Sheet cho bảng tổng hợp Processor Leader (dán link) — ghi toàn bộ layout hiện
   * có, trả webhookSecret + Apps Script mẫu ĐÚNG 1 LẦN duy nhất lúc này (giống CPA Review). */
  connectProcessorReportSheet: (link: string, month: string) =>
    request<{
      ok: true;
      month: string;
      sheetId: string;
      gid: string;
      tabName: string;
      webhookSecret: string;
      webhookUrl: string;
      appsScript: string;
    }>("/api/config/processor-report-sheet", { method: "POST", body: JSON.stringify({ action: "connect", link, month }) }),
  resyncProcessorReportSheet: (month: string) =>
    request<{ ok: true; pushed: number }>("/api/config/processor-report-sheet", {
      method: "POST",
      body: JSON.stringify({ action: "resync", month }),
    }),
  disconnectProcessorReportSheet: (month: string) =>
    request<{ ok: true }>(`/api/config/processor-report-sheet?month=${encodeURIComponent(month)}`, { method: "DELETE" }),
  getProcessorReportSyncInfo: (month: string) =>
    request<{
      serviceAccountConfigured: boolean;
      serviceAccountEmail: string | null;
      appsScript: string | null;
      connected: { sheetId: string; gid: string; tabName: string; connectedAt: string } | null;
    }>(`/api/config/processor-report-sheet?month=${encodeURIComponent(month)}`),
};

export interface ClientProfilePayload {
  clients?: [{ firstName: string; lastName: string }, { firstName: string; lastName: string }];
  ssn?: [string | null, string | null];
  dateOfBirth?: [string | null, string | null];
  phone?: string;
  phone2?: string;
  zipcode?: string;
  address?: string;
  email?: string;
  refunds?: Record<string, number>;
  fcDate?: string | null;
  processingDate?: string | null;
  elDate?: string | null;
  bankName?: string | null;
  routingNumber?: string | null;
  accountNumber?: string | null;
  note?: string | null;
  accountant?: string | null;
  accountantSupport?: string | null;
}

/** Gọi API nền, không chặn UI (các action Zustand vẫn cập nhật local state ngay lập
 * tức cho mượt) — lỗi chỉ log ra console, không làm crash thao tác của người dùng.
 * Giai đoạn sau có thể nâng cấp thành hàng đợi retry / báo lỗi UI rõ ràng hơn. */
export function syncInBackground(label: string, task: Promise<unknown>): void {
  task.catch((err) => {
    console.error(`[sync:${label}] Đồng bộ lên server thất bại:`, err);
  });
}
