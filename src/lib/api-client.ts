import type { CaseRecord, ColumnDef, FeaturePermissions, Role, User } from "./types";

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
  changePassword: (userId: string, currentPassword: string, newPassword: string) =>
    request<{ ok: true }>(`/api/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  removeUser: (userId: string) => request<{ ok: true }>(`/api/users/${userId}`, { method: "DELETE" }),

  listCases: () => request<CaseRecord[]>("/api/cases"),
  createCase: (kase: CaseRecord) => request<CaseRecord>("/api/cases", { method: "POST", body: JSON.stringify(kase) }),
  patchCase: (caseId: string, patch: Partial<CaseRecord>) =>
    request<{ id: string; updatedAt: string }>(`/api/cases/${caseId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCase: (caseId: string) => request<{ ok: true }>(`/api/cases/${caseId}`, { method: "DELETE" }),

  getConfig: () => request<{ columns: ColumnDef[]; featurePermissions: FeaturePermissions }>("/api/config"),
  putConfig: (columns: ColumnDef[], featurePermissions: FeaturePermissions) =>
    request<{ columns: ColumnDef[]; featurePermissions: FeaturePermissions }>("/api/config", {
      method: "PUT",
      body: JSON.stringify({ columns, featurePermissions }),
    }),
};

/** Gọi API nền, không chặn UI (các action Zustand vẫn cập nhật local state ngay lập
 * tức cho mượt) — lỗi chỉ log ra console, không làm crash thao tác của người dùng.
 * Giai đoạn sau có thể nâng cấp thành hàng đợi retry / báo lỗi UI rõ ràng hơn. */
export function syncInBackground(label: string, task: Promise<unknown>): void {
  task.catch((err) => {
    console.error(`[sync:${label}] Đồng bộ lên server thất bại:`, err);
  });
}
