import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";

/** Đánh dấu 1 thông báo đã đọc — chỉ chủ thông báo (toUserId) mới đánh dấu được. */
export async function PATCH(_request: Request, ctx: RouteContext<"/api/notifications/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { id } = await ctx.params;

  const existing = await prisma.notification.findUnique({ where: { id }, select: { toUserId: true } });
  if (!existing || existing.toUserId !== me.id) {
    return NextResponse.json({ error: "Không tìm thấy thông báo" }, { status: 404 });
  }

  await prisma.notification.update({ where: { id }, data: { read: true } });
  return NextResponse.json({ ok: true });
}
