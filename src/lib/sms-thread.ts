import { prisma } from "./prisma";
import { sendRingCentralSms } from "./ringcentral";
import { broadcastCaseChanged } from "./pusher-server";
import { toE164US } from "./phone";
import { getAllClientNames } from "./client-name";
import type { SmsMessageRecord, SmsConversationSummary } from "./types";

/** Logic dùng CHUNG cho cả 2 lối vào khung chat SMS — theo hồ sơ (CaseSmsButton,
 * /api/cases/[id]/sms) và hộp thư tổng hợp (SmsInboxButton, /api/sms/inbox|thread) — tránh
 * lặp lại code gửi/đọc/đánh dấu đã đọc ở 2 route khác nhau. Mọi thứ đều khớp theo số điện
 * thoại (counterpartNumber, E.164), KHÔNG có khái niệm "SMS thuộc về đúng 1 hồ sơ" — xem
 * SmsMessage trong schema.prisma. */

export function toSmsRecord(row: {
  id: string;
  direction: string;
  counterpartNumber: string;
  text: string;
  sentByUserId: string | null;
  readAt: Date | null;
  createdAt: Date;
}): SmsMessageRecord {
  return {
    id: row.id,
    direction: row.direction === "in" ? "in" : "out",
    counterpartNumber: row.counterpartNumber,
    text: row.text,
    sentByUserId: row.sentByUserId,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getThreadForPhone(phone: string): Promise<SmsMessageRecord[]> {
  return getThreadForPhones([phone]);
}

/** Gộp thread của NHIỀU số (vd Case.phone + Case.phone2) thành 1 danh sách theo thời gian —
 * dùng cho CaseSmsButton, hồ sơ có thể có 2 số điện thoại cùng nhắn tin qua lại. */
export async function getThreadForPhones(phones: string[]): Promise<SmsMessageRecord[]> {
  if (phones.length === 0) return [];
  const rows = await prisma.smsMessage.findMany({
    where: { counterpartNumber: { in: phones } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toSmsRecord);
}

export async function sendSmsToPhone(
  phone: string,
  text: string,
  sentByUserId: string,
  socketId: string | null
): Promise<SmsMessageRecord> {
  const sent = await sendRingCentralSms(phone, text);
  const created = await prisma.smsMessage.create({
    data: { direction: "out", counterpartNumber: phone, text, ringcentralMessageId: sent.id, sentByUserId },
  });
  await broadcastCaseChanged(phone, socketId);
  return toSmsRecord(created);
}

export async function markPhoneRead(phone: string, socketId: string | null): Promise<number> {
  return markPhonesRead([phone], socketId);
}

export async function markPhonesRead(phones: string[], socketId: string | null): Promise<number> {
  if (phones.length === 0) return 0;
  const result = await prisma.smsMessage.updateMany({
    where: { direction: "in", readAt: null, counterpartNumber: { in: phones } },
    data: { readAt: new Date() },
  });
  if (result.count > 0) await broadcastCaseChanged(phones[0], socketId);
  return result.count;
}

/** Xoá 1 tin nhắn — CHỈ xoá bản ghi trong app, KHÔNG gọi API RingCentral nào để thu hồi
 * (RingCentral không hỗ trợ thu hồi SMS đã gửi/nhận, đây chỉ là dọn lịch sử hiển thị trong
 * app). Trả về counterpartNumber của tin vừa xoá để nơi gọi tự broadcast đúng tín hiệu,
 * null nếu id không tồn tại (đã bị xoá trước đó, coi như thành công). */
export async function deleteSmsMessage(id: string, socketId: string | null): Promise<string | null> {
  const existing = await prisma.smsMessage.findUnique({ where: { id }, select: { counterpartNumber: true } });
  if (!existing) return null;
  await prisma.smsMessage.delete({ where: { id } });
  await broadcastCaseChanged(existing.counterpartNumber, socketId);
  return existing.counterpartNumber;
}

/** Xoá TOÀN BỘ tin nhắn của 1 số điện thoại (nút "Xóa tất cả" trong khung chat) — cuộc hội
 * thoại đó sẽ biến mất khỏi hộp thư tổng hợp (listSmsConversations tự dựng danh sách từ
 * SmsMessage hiện có, không phải bảng riêng nên không cần xoá gì thêm). */
export async function deleteThreadForPhone(phone: string, socketId: string | null): Promise<number> {
  const result = await prisma.smsMessage.deleteMany({ where: { counterpartNumber: phone } });
  if (result.count > 0) await broadcastCaseChanged(phone, socketId);
  return result.count;
}

/** Hộp thư tổng hợp (SmsInboxButton) — 1 dòng / 1 số điện thoại đã từng nhắn qua lại, kèm
 * tên khách (nếu khớp được với 1 hồ sơ đang có phone/phone2 = đúng số đó), tin nhắn gần nhất
 * + số tin "in" chưa đọc. KHÔNG dùng groupBy trực tiếp lấy tin nhắn gần nhất (Prisma groupBy
 * không hỗ trợ "lấy kèm dòng mới nhất mỗi nhóm" gọn) — quét toàn bộ SmsMessage 1 lần (bảng
 * này nhỏ, mỗi công ty chỉ 1 số dùng chung) rồi tự gom theo counterpartNumber trong code. */
export async function listSmsConversations(): Promise<SmsConversationSummary[]> {
  const [messages, cases] = await Promise.all([
    prisma.smsMessage.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.case.findMany({ select: { id: true, phone: true, phone2: true, clients: true } }),
  ]);

  const phoneToCase = new Map<string, { id: string; name: string }>();
  for (const c of cases) {
    const name = getAllClientNames({ clients: c.clients as unknown as [{ firstName: string; lastName: string }, { firstName: string; lastName: string }] });
    for (const raw of [c.phone, c.phone2]) {
      const e164 = toE164US(raw);
      if (e164 && !phoneToCase.has(e164)) phoneToCase.set(e164, { id: c.id, name });
    }
  }

  const byPhone = new Map<string, SmsConversationSummary>();
  for (const m of messages) {
    const matchedCase = phoneToCase.get(m.counterpartNumber);
    const existing = byPhone.get(m.counterpartNumber);
    const entry: SmsConversationSummary = {
      counterpartNumber: m.counterpartNumber,
      caseId: matchedCase?.id ?? null,
      clientName: matchedCase?.name ?? null,
      lastMessageText: m.text,
      lastMessageAt: m.createdAt.toISOString(),
      lastMessageDirection: m.direction === "in" ? "in" : "out",
      unreadCount: (existing?.unreadCount ?? 0) + (m.direction === "in" && !m.readAt ? 1 : 0),
    };
    byPhone.set(m.counterpartNumber, entry);
  }
  return [...byPhone.values()].sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
}
