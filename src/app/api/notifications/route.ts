import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import type { AppNotification, NotificationType } from "@/lib/types";

export function toNotificationRecord(row: {
  id: string;
  type: string;
  toUserId: string;
  fromUserId: string;
  caseId: string;
  message: string;
  read: boolean;
  createdAt: Date;
}): AppNotification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    toUserId: row.toUserId,
    fromUserId: row.fromUserId,
    caseId: row.caseId,
    message: row.message,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const rows = await prisma.notification.findMany({
    where: { toUserId: me.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(rows.map(toNotificationRecord));
}
