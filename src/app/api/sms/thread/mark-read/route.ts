import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { toE164US } from "@/lib/phone";
import { markPhoneRead } from "@/lib/sms-thread";
import type { FeaturePermissions } from "@/lib/types";

export async function POST(request: Request) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendSms", me.role)) {
    return NextResponse.json({ error: "Không có quyền nhắn tin SMS" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { phone?: string } | null;
  const phone = toE164US(body?.phone);
  if (!phone) return NextResponse.json({ error: "Thiếu số điện thoại hợp lệ" }, { status: 400 });

  const updated = await markPhoneRead(phone, request.headers.get("x-pusher-socket-id"));
  return NextResponse.json({ ok: true, updated });
}
