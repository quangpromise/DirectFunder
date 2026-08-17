import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { createOrRenewRingCentralSubscription, isRingCentralConfigured, RingCentralApiError } from "@/lib/ringcentral";

/** Trạng thái subscription webhook nhận SMS đến — chỉ Quản lý (manager) xem/thao tác, cùng
 * mức quyền với các cấu hình đồng bộ Sheet khác (manageCpaReviewSheet...). Không thêm
 * feature key riêng vì đây là hành động hạ tầng 1 lần, không phải phân quyền nghiệp vụ. */
export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (me.role !== "manager") return NextResponse.json({ error: "Chỉ Quản lý mới xem được" }, { status: 403 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  return NextResponse.json({
    configured: isRingCentralConfigured(),
    subscriptionId: config?.ringcentralSubscriptionId ?? null,
    subscriptionExpiresAt: config?.ringcentralSubscriptionExpiresAt ? config.ringcentralSubscriptionExpiresAt.toISOString() : null,
  });
}

/** Tạo mới/gia hạn subscription — webhook URL luôn tự build từ origin của chính request này
 * (KHÔNG nhận từ client), phải là 1 domain public HTTPS thật để RingCentral gọi tới được
 * (không hoạt động khi gọi từ localhost lúc dev — RingCentral sẽ báo lỗi handshake rõ ràng,
 * đó là hành vi đúng, chỉ tạo được subscription thật sau khi đã deploy production). */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (me.role !== "manager") return NextResponse.json({ error: "Chỉ Quản lý mới cấu hình được" }, { status: 403 });
  if (!isRingCentralConfigured()) {
    return NextResponse.json({ error: "Chưa cấu hình RingCentral (thiếu biến môi trường)" }, { status: 501 });
  }

  const webhookUrl = new URL("/api/ringcentral/webhook", request.url).toString();
  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });

  try {
    const result = await createOrRenewRingCentralSubscription(webhookUrl, config?.ringcentralSubscriptionId ?? null);
    await prisma.appConfig.update({
      where: { id: "singleton" },
      data: { ringcentralSubscriptionId: result.id, ringcentralSubscriptionExpiresAt: new Date(result.expiresAt) },
    });
    return NextResponse.json({ ok: true, subscriptionId: result.id, subscriptionExpiresAt: result.expiresAt });
  } catch (err) {
    const message = err instanceof RingCentralApiError ? err.message : "Tạo subscription thất bại, thử lại sau.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
