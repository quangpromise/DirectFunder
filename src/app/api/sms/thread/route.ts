import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { toE164US } from "@/lib/phone";
import { isRingCentralConfigured, RingCentralApiError } from "@/lib/ringcentral";
import { getThreadForPhone, sendSmsToPhone, deleteThreadForPhone } from "@/lib/sms-thread";
import type { FeaturePermissions } from "@/lib/types";

/** Thread SMS theo số điện thoại trực tiếp (SmsInboxButton) — KHÔNG cần biết hồ sơ nào,
 * dùng cho cả số chưa/không khớp hồ sơ nào (xem listSmsConversations trong sms-thread.ts).
 * Cùng dữ liệu với GET /api/cases/[id]/sms nếu số đó khớp đúng 1 hồ sơ. */
export async function GET(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendSms", me.role)) {
    return NextResponse.json({ error: "Không có quyền nhắn tin SMS" }, { status: 403 });
  }

  const phone = toE164US(request.nextUrl.searchParams.get("phone"));
  if (!phone) return NextResponse.json({ error: "Thiếu số điện thoại hợp lệ" }, { status: 400 });
  return NextResponse.json(await getThreadForPhone(phone));
}

export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendSms", me.role)) {
    return NextResponse.json({ error: "Không có quyền nhắn tin SMS" }, { status: 403 });
  }
  if (!isRingCentralConfigured()) {
    return NextResponse.json({ error: "Chưa cấu hình RingCentral (thiếu biến môi trường)" }, { status: 501 });
  }

  const body = (await request.json().catch(() => null)) as { phone?: string; text?: string } | null;
  const phone = toE164US(body?.phone);
  const text = body?.text?.trim();
  if (!phone) return NextResponse.json({ error: "Thiếu số điện thoại hợp lệ" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Nội dung tin nhắn trống" }, { status: 400 });

  try {
    const created = await sendSmsToPhone(phone, text, me.id, request.headers.get("x-pusher-socket-id"));
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const message = err instanceof RingCentralApiError ? err.message : "Gửi SMS thất bại, thử lại sau.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** Xoá TOÀN BỘ tin nhắn của 1 cuộc hội thoại (nút "Xóa tất cả") — chỉ xoá lịch sử trong app,
 * không thu hồi gì phía RingCentral (không thể). */
export async function DELETE(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendSms", me.role)) {
    return NextResponse.json({ error: "Không có quyền nhắn tin SMS" }, { status: 403 });
  }

  const phone = toE164US(request.nextUrl.searchParams.get("phone"));
  if (!phone) return NextResponse.json({ error: "Thiếu số điện thoại hợp lệ" }, { status: 400 });

  const deleted = await deleteThreadForPhone(phone, request.headers.get("x-pusher-socket-id"));
  return NextResponse.json({ ok: true, deleted });
}
