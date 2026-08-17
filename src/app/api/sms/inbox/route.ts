import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { listSmsConversations } from "@/lib/sms-thread";
import type { FeaturePermissions } from "@/lib/types";

/** Hộp thư tổng hợp SMS (SmsInboxButton, cạnh chuông thông báo) — mọi cuộc hội thoại đã
 * từng nhắn qua lại, KHÔNG lọc theo hồ sơ user đang xem được (khác GET /api/cases) vì đây
 * là 1 số điện thoại công ty DÙNG CHUNG cho mọi user có quyền sendSms, giống cách tab CPA
 * Review/Collecting không lọc theo canViewCase. */
export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendSms", me.role)) {
    return NextResponse.json({ error: "Không có quyền nhắn tin SMS" }, { status: 403 });
  }

  return NextResponse.json(await listSmsConversations());
}
