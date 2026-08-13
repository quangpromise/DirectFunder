import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";

export async function POST() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  await prisma.notification.updateMany({ where: { toUserId: me.id, read: false }, data: { read: true } });
  return NextResponse.json({ ok: true });
}
