import Pusher from "pusher";

/**
 * Pusher (server-side) — dùng để đẩy realtime: chuông thông báo (thêm 2026-08-13, xem
 * prisma/schema.prisma model Notification) và tín hiệu "bảng Hồ sơ/Order vừa đổi" cho các
 * trình duyệt khác đang mở, không cần họ tự F5 (xem broadcastCaseChanged bên dưới,
 * dùng trong src/app/api/cases/route.ts + src/app/api/cases/[id]/route.ts).
 *
 * CỐ Ý cho phép chạy thiếu env (dev local chưa cấu hình Pusher) — mọi lời gọi trigger đều
 * đi qua safeTrigger, tự no-op + console.warn thay vì throw, để không phá vỡ luồng CRUD
 * chính (thêm/sửa/xoá hồ sơ) chỉ vì thiếu tính năng phụ trợ realtime.
 */

const CASES_CHANNEL = "private-cases";
const CPA_REVIEW_CHANNEL = "private-cpa-review";

function notificationChannel(userId: string): string {
  return `private-notifications-${userId}`;
}

let cached: Pusher | null | undefined;

function getPusherServer(): Pusher | null {
  if (cached !== undefined) return cached;
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER;
  if (!appId || !key || !secret || !cluster) {
    console.warn("[pusher] Thiếu PUSHER_APP_ID/PUSHER_KEY/PUSHER_SECRET/PUSHER_CLUSTER — bỏ qua realtime.");
    cached = null;
    return null;
  }
  cached = new Pusher({ appId, key, secret, cluster, useTLS: true });
  return cached;
}

/** Bắn 1 event lên Pusher, không throw nếu Pusher chưa cấu hình hoặc request lỗi (network,
 * quota...) — realtime là tính năng phụ trợ, không được phép làm sập request CRUD chính. */
async function safeTrigger(
  channel: string,
  event: string,
  payload: unknown,
  socketId: string | null
): Promise<void> {
  const pusher = getPusherServer();
  if (!pusher) return;
  try {
    await pusher.trigger(channel, event, payload, socketId ? { socket_id: socketId } : undefined);
  } catch (err) {
    console.error(`[pusher] Bắn event "${event}" lên kênh "${channel}" thất bại:`, err);
  }
}

/** Tín hiệu RỖNG (chỉ kèm caseId, KHÔNG kèm dữ liệu case thật) — client nhận được thì tự
 * gọi lại GET /api/cases (đã lọc RBAC theo canViewCase) thay vì tin trực tiếp payload từ
 * Pusher. Cố tình thiết kế vậy để không lộ field bị chặn RBAC (Agent/Processor chỉ được
 * xem hồ sơ của mình) qua 1 kênh chung mọi user đều subscribe được. */
export async function broadcastCaseChanged(caseId: string, socketId: string | null): Promise<void> {
  await safeTrigger(CASES_CHANNEL, "case:changed", { caseId }, socketId);
}

/** Tín hiệu RỖNG tương tự broadcastCaseChanged nhưng cho bảng "CPA Review" (độc lập với
 * Case) — cần riêng vì mọi thay đổi tới bảng này (kể cả từ webhook Google Sheet, xem
 * src/app/api/cpa-review-sheet/webhook/route.ts) trước đây KHÔNG bắn tín hiệu gì, khiến
 * các tab trình duyệt khác đang mở không bao giờ biết để tự refetch — chỉ thấy dữ liệu
 * mới sau khi tự F5. `socketId` truyền `null` khi bắn từ webhook (không có Pusher
 * socket của trình duyệt nào để loại trừ). */
export async function broadcastCpaReviewChanged(recordId: string, socketId: string | null): Promise<void> {
  await safeTrigger(CPA_REVIEW_CHANNEL, "cpaReview:changed", { recordId }, socketId);
}

/** Thông báo thật (Notification row đầy đủ) — an toàn để gửi thẳng vì luôn "địa chỉ hoá"
 * đúng 1 người nhận (kênh riêng theo userId, chỉ user đó auth được — xem
 * src/app/api/pusher/auth/route.ts), không phải kênh chung. */
export async function broadcastNotification(
  toUserId: string,
  notification: unknown,
  socketId: string | null
): Promise<void> {
  await safeTrigger(notificationChannel(toUserId), "notification:new", notification, socketId);
}

export { CASES_CHANNEL, CPA_REVIEW_CHANNEL, notificationChannel, getPusherServer };
