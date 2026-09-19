import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { toE164US } from "@/lib/phone";
import { isRingCentralConfigured, RingCentralApiError, sendRingCentralMms } from "@/lib/ringcentral";
import type { FeaturePermissions } from "@/lib/types";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Gửi ảnh đính kèm (MMS) tới số điện thoại chính của hồ sơ — CHỈ ĐẨY ĐI qua RingCentral,
 * KHÔNG lưu byte ảnh ở bất kỳ đâu trong app (không có `prisma.smsMessage.create` nào ở đây,
 * khác nhánh gửi text ở route.ts cùng cấp) — theo đúng yêu cầu "gửi ảnh mà không lưu lại".
 * Vì không lưu, ảnh này KHÔNG xuất hiện lại trong thread nếu tải lại trang/mở lại popup. */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/sms/image">) {
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
  const body = (await request.json().catch(() => null)) as
    | { contentBase64?: string; contentType?: string; filename?: string; caption?: string }
    | null;
  const contentBase64 = body?.contentBase64;
  const contentType = body?.contentType?.trim() || "image/jpeg";
  if (!contentBase64) return NextResponse.json({ error: "Thiếu dữ liệu ảnh" }, { status: 400 });

  let buffer: Buffer;
  try {
    buffer = Buffer.from(contentBase64, "base64");
  } catch {
    return NextResponse.json({ error: "Dữ liệu ảnh không hợp lệ" }, { status: 400 });
  }
  if (buffer.length === 0) return NextResponse.json({ error: "Ảnh trống" }, { status: 400 });
  if (buffer.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: `Ảnh vượt quá ${(MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(1)}MB` }, { status: 400 });
  }

  const row = await prisma.case.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });
  const to = toE164US(row.phone);
  if (!to) return NextResponse.json({ error: "Hồ sơ chưa có số điện thoại hợp lệ" }, { status: 400 });

  try {
    await sendRingCentralMms(to, buffer, contentType, body?.filename?.trim() || "image.jpg", body?.caption?.trim() || undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof RingCentralApiError ? err.message : "Gửi ảnh thất bại, thử lại sau.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
