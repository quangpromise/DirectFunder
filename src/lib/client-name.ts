import { ClientNameEntry } from "./types";

function fullName(entry: ClientNameEntry): string {
  return [entry.firstName, entry.lastName].filter(Boolean).join(" ").trim();
}

/** Định dạng "Last Name, First Name" cho 1 client — dùng cho cột Format Name ở tab Order. */
export function formatLastFirst(entry: ClientNameEntry): string {
  const last = entry.lastName.trim();
  const first = entry.firstName.trim();
  if (!last && !first) return "";
  if (!last) return first;
  if (!first) return last;
  return `${last}, ${first}`;
}

/** Tên đầy đủ của client đầu tiên (dòng 1) — dùng làm tên hiển thị chính. */
export function getFullName(c: { clients: [ClientNameEntry, ClientNameEntry] }): string {
  return fullName(c.clients[0]);
}

/** Tên đầy đủ của cả 2 client (bỏ qua dòng trống), nối bằng " & " — dùng cho tìm kiếm/hiển thị gộp. */
export function getAllClientNames(c: { clients: [ClientNameEntry, ClientNameEntry] }): string {
  return c.clients.map(fullName).filter(Boolean).join(" & ");
}

/**
 * Danh sách client đã điền tên (bỏ qua dòng trống) kèm slot gốc (0/1) — dùng để
 * tách 1 hồ sơ có 2 client thành 2 dòng riêng (ví dụ trong tab Order), mỗi dòng
 * giữ đúng SSN của slot đó. Nếu chưa điền tên nào, trả về 1 dòng rỗng ở slot 0
 * để vẫn hiển thị được hồ sơ.
 */
export function getClientEntries(
  c: { clients: [ClientNameEntry, ClientNameEntry] }
): { slot: 0 | 1; name: string; entry: ClientNameEntry }[] {
  const filled = c.clients
    .map((entry, slot) => ({ slot: slot as 0 | 1, name: fullName(entry), entry }))
    .filter((e) => e.name);
  return filled.length > 0 ? filled : [{ slot: 0, name: "", entry: c.clients[0] }];
}
