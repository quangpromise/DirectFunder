import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { toE164US } from "@/lib/phone";
import { markPhonesRead } from "@/lib/sms-thread";
import type { FeaturePermissions } from "@/lib/types";

/** Đánh dấu đã đọc mọi SMS "in" chưa đọc khớp số điện thoại hồ sơ này — gọi khi user mở
 * khung chat (CaseSmsButton). Tắt icon đỏ cho MỌI user khác đang mở bảng Hồ sơ (không phải
 * "đã đọc theo từng người" — cùng tinh thần descriptionReadBy nhưng đơn giản hơn: 1 dòng
 * SMS chỉ cần 1 người trong team đọc là coi như xử lý xong). */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/sms/mark-read">) {
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
  const updated = await markPhonesRead(numbers, request.headers.get("x-pusher-socket-id"));
  return NextResponse.json({ ok: true, updated });
}
