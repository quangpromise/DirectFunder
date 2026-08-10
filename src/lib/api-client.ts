import type { CaseRecord, ColumnDef, CpaEmailDefaults, FeaturePermissions, GoogleSheetConfig, Role, User } from "./types";

class ApiError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
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
  role: Role;
  avatarColor: string;
  avatarUrl: string | null;
  teamMemberIds?: string[];
}

export const api = {
  login: (email: string, password: string) =>
    request<ApiUser>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
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

  getConfig: () =>
    request<{
      columns: ColumnDef[];
      featurePermissions: FeaturePermissions;
      cpaEmailDefaults: CpaEmailDefaults | null;
      cpaSenderEmail: string | null;
      googleSheetConfig: GoogleSheetConfig | null;
    }>("/api/config"),
  putConfig: (
    columns: ColumnDef[],
    featurePermissions: FeaturePermissions,
    cpaEmailDefaults?: CpaEmailDefaults,
    googleSheetConfig?: GoogleSheetConfig
  ) =>
    request<{
      columns: ColumnDef[];
      featurePermissions: FeaturePermissions;
      cpaEmailDefaults: CpaEmailDefaults | null;
      googleSheetConfig: GoogleSheetConfig | null;
    }>("/api/config", {
      method: "PUT",
      body: JSON.stringify({ columns, featurePermissions, cpaEmailDefaults, googleSheetConfig }),
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

  /** Lưu toàn bộ nội dung popup "Edit Hồ sơ" (ClientProfileDialog) trong 1 lần gọi —
   * server tự tính lại `money`/`custom.caseLabel` từ `refunds`, trả về giá trị đã tính
   * để store cập nhật local state khớp đúng server (không tin giá trị optimistic). */
  updateClientProfile: (caseId: string, payload: ClientProfilePayload) =>
    request<{ id: string; money: number; custom: Record<string, unknown>; updatedAt: string }>(
      `/api/cases/${caseId}/client-profile`,
      { method: "POST", body: JSON.stringify(payload) }
    ),
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
}

/** Gọi API nền, không chặn UI (các action Zustand vẫn cập nhật local state ngay lập
 * tức cho mượt) — lỗi chỉ log ra console, không làm crash thao tác của người dùng.
 * Giai đoạn sau có thể nâng cấp thành hàng đợi retry / báo lỗi UI rõ ràng hơn. */
export function syncInBackground(label: string, task: Promise<unknown>): void {
  task.catch((err) => {
    console.error(`[sync:${label}] Đồng bộ lên server thất bại:`, err);
  });
}
