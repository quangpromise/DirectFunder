import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getPusherServer, notificationChannel, CASES_CHANNEL, CPA_REVIEW_CHANNEL } from "@/lib/pusher-server";

/**
 * Auth endpoint cho private channel của Pusher client (src/lib/pusher-client.ts,
 * authEndpoint) — Pusher JS tự POST tới đây (form-urlencoded, không phải JSON) mỗi khi
 * subscribe 1 kênh private, kèm socket_id + channel_name.
 *
 * Chỉ cho phép subscribe: "private-cases"/"private-cpa-review" (mọi user đã đăng nhập —
 * kênh tín hiệu chung, không kèm dữ liệu nhạy cảm, xem broadcastCaseChanged/
 * broadcastCpaReviewChanged) hoặc đúng kênh thông báo CỦA CHÍNH MÌNH
 * ("private-notifications-{userId}") — chặn nghe lén kênh thông báo người khác.
 */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const pusher = getPusherServer();
  if (!pusher) return NextResponse.json({ error: "Realtime chưa được cấu hình" }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const socketId = form?.get("socket_id");
  const channelName = form?.get("channel_name");
  if (typeof socketId !== "string" || typeof channelName !== "string") {
    return NextResponse.json({ error: "Thiếu socket_id/channel_name" }, { status: 400 });
  }

  const allowed =
    channelName === CASES_CHANNEL || channelName === CPA_REVIEW_CHANNEL || channelName === notificationChannel(me.id);
  if (!allowed) return NextResponse.json({ error: "Không có quyền subscribe kênh này" }, { status: 403 });

  const auth = pusher.authorizeChannel(socketId, channelName);
  return NextResponse.json(auth);
}
