/** Danh sách cột người dùng TỰ chọn ẩn khỏi bảng Hồ sơ (chỉ ảnh hưởng chính họ, trên đúng
 * trình duyệt này) — KHÁC hẳn `ColumnDef.hiddenFromGrid` (Admin ẩn cho MỌI user, lưu server).
 * Lưu localStorage theo từng user id (không phải 1 key chung) để nhiều tài khoản dùng chung 1
 * máy không lộ/ghi đè lựa chọn ẩn cột của nhau — cùng convention với
 * `direct-funder-recent-accounts` ở trang đăng nhập (`src/app/login/page.tsx`). */
const STORAGE_PREFIX = "direct-funder-hidden-columns:";

export function loadHiddenColumnIds(userId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + userId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function saveHiddenColumnIds(userId: string, columnIds: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(columnIds));
  } catch {
    // localStorage đầy/bị chặn (private mode...) — bỏ qua, chỉ mất tính năng ẩn cột cá nhân,
    // không ảnh hưởng gì tới dữ liệu hồ sơ thật.
  }
}
