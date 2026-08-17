import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { toE164US } from "@/lib/phone";
import { isRingCentralConfigured, RingCentralApiError } from "@/lib/ringcentral";
import { getThreadForPhones, sendSmsToPhone } from "@/lib/sms-thread";
import type { FeaturePermissions } from "@/lib/types";

/** Toàn bộ khung chat SMS theo hồ sơ (CaseSmsButton) — khớp theo số điện thoại
 * (phone/phone2 của Case đã chuẩn hoá E.164), KHÔNG có bảng liên kết Case<->SmsMessage nào
 * khác — xem SmsMessage trong schema.prisma. Cùng logic gửi/đọc với hộp thư tổng hợp
 * (/api/sms/thread), xem src/lib/sms-thread.ts. */
export async function GET(_request: Request, ctx: RouteContext<"/api/cases/[id]/sms">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendSms", me.role)) {
    return NextResponse.json({ error: "Không có quyền nhắn tin SMS" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const row = await prisma.case.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });

  const numbers = [toE164US(row.phone), toE164US(row.phone2)].filter((n): n is string => n !== null);
  return NextResponse.json(await getThreadForPhones(numbers));
}

/** Gửi 1 SMS tới đúng số điện thoại chính (Case.phone) của hồ sơ này — luôn dùng
 * RINGCENTRAL_SMS_FROM_NUMBER (số công ty dùng chung, KHÔNG phải OAuth theo từng user như
 * webmail) làm số gửi đi. */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/sms">) {
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

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text) return NextResponse.json({ error: "Nội dung tin nhắn trống" }, { status: 400 });

  const row = await prisma.case.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });
  const to = toE164US(row.phone);
  if (!to) return NextResponse.json({ error: "Hồ sơ chưa có số điện thoại hợp lệ" }, { status: 400 });

  try {
    const created = await sendSmsToPhone(to, text, me.id, request.headers.get("x-pusher-socket-id"));
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const message = err instanceof RingCentralApiError ? err.message : "Gửi SMS thất bại, thử lại sau.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
