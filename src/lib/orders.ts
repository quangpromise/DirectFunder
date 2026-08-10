import { CaseRecord, OrderType } from "./types";

/**
 * Order 8821 và Order TTS & WIT: sau khi đặt thành công, nút LUÔN tự quay về mặc định
 * ngay (không khoá chờ Support Done) — cho phép đặt lại bất kỳ lúc nào. Chặn trùng dựa
 * HOÀN TOÀN vào SSN (xem hasWaitingOrderForSsn) thay vì khoá theo trạng thái case: nếu
 * SSN của (các) client vừa chọn đang có order CÙNG LOẠI nào khác CHƯA Done (tức đang
 * nằm ở tab Waiting) ở BẤT KỲ hồ sơ nào trong hệ thống thì chặn, không cho đặt trùng.
 * Order clientSlot=null (order cũ trước khi có tính năng chọn client) coi như áp dụng
 * cho cả 2 SSN của hồ sơ đó.
 */
export function hasWaitingOrderForSsn(allCases: CaseRecord[], type: OrderType, ssns: (string | null)[]): boolean {
  const targets = new Set(ssns.filter((s): s is string => Boolean(s)));
  if (targets.size === 0) return false;
  for (const c of allCases) {
    for (const o of c.orders) {
      if (o.type !== type || o.status === "done") continue;
      const candidates = o.clientSlot === 0 || o.clientSlot === 1 ? [c.ssn[o.clientSlot]] : c.ssn;
      if (candidates.some((s) => s && targets.has(s))) return true;
    }
  }
  return false;
}

/** Danh sách field còn thiếu để đặt order (8821 hoặc TTS & WIT) cho (các) client đã
 * chọn — Phone/Address dùng chung cho cả hồ sơ, First/Last Name + SSN kiểm tra riêng
 * theo từng client slot. */
export function missingOrderClientFields(c: CaseRecord, slots: (0 | 1)[]): string[] {
  const missing: string[] = [];
  for (const slot of slots) {
    const suffix = slot === 0 ? "Taxpayer" : "Spouse";
    if (!c.clients[slot].firstName.trim()) missing.push(`First Name (${suffix})`);
    if (!c.clients[slot].lastName.trim()) missing.push(`Last Name (${suffix})`);
    if (!c.ssn[slot]) missing.push(`SSN (${suffix})`);
  }
  if (!c.phone.trim()) missing.push("Phone");
  if (!c.address.trim()) missing.push("Address");
  return missing;
}
