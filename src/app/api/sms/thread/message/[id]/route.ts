import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { deleteSmsMessage } from "@/lib/sms-thread";
import type { FeaturePermissions } from "@/lib/types";

/** Xoá 1 tin nhắn SMS đơn lẻ (nút xoá trên từng bong bóng tin nhắn, SmsInboxButton) — chỉ
 * xoá lịch sử trong app, RingCentral không có API thu hồi tin đã gửi/nhận. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/sms/thread/message/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendSms", me.role)) {
    return NextResponse.json({ error: "Không có quyền nhắn tin SMS" }, { status: 403 });
  }

  const { id } = await ctx.params;
  await deleteSmsMessage(id, request.headers.get("x-pusher-socket-id"));
  return NextResponse.json({ ok: true });
}
