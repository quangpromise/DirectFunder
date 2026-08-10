import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { sendCpaEmail, type CpaEmailAttachment } from "@/lib/mailer";
import type { FeaturePermissions } from "@/lib/types";

/** Giới hạn body request serverless (Vercel ~4.5MB mặc định) — base64 phình ~33% so với
 * dung lượng gốc, nên đặt ngưỡng tổng dung lượng gốc các file đính kèm ở mức an toàn. */
const MAX_TOTAL_ATTACHMENT_BYTES = 4 * 1024 * 1024;

function isNonEmptyEmailArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim().length > 0);
}

/** Gửi email cho CPA từ 1 hồ sơ cụ thể — lưu `cpaEmailSentAt` xuống bảng Case (gửi thật
 * hoặc "Mark as sent" thủ công đều lưu) để nút giữ đúng trạng thái xanh (đã gửi) qua
 * reload/deploy lại — trước đây chỉ lưu ở React state nên mất ngay khi F5. `clear: true`
 * (bấm "muốn gửi lại") xoá lại giá trị này, không gọi Gmail. Lịch sử gửi chi tiết (nội
 * dung mail...) vẫn chỉ lưu ở Edit History phía client như cũ (xem sendCpaEmail trong
 * app-store.ts, gọi logEdit() sau khi request này trả về thành công). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/cases/[id]/send-cpa-email">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendCpaEmail", me.role)) {
    return NextResponse.json({ error: "Không có quyền gửi email cho CPA" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const kase = await prisma.case.findUnique({ where: { id } });
  if (!kase) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });

  const body = await request.json().catch(() => null);

  // manual: bấm "Mark as sent" (đã gửi qua đường khác, KHÔNG gọi Gmail thật).
  // clear: bấm xác nhận "muốn gửi lại" (xoá cpaEmailSentAt, không gọi Gmail).
  if (body?.clear === true) {
    const updated = await prisma.case.update({ where: { id }, data: { cpaEmailSentAt: null } });
    return NextResponse.json({ ok: true, cpaEmailSentAt: updated.cpaEmailSentAt });
  }
  if (body?.manual === true) {
    const updated = await prisma.case.update({ where: { id }, data: { cpaEmailSentAt: new Date() } });
    return NextResponse.json({ ok: true, cpaEmailSentAt: updated.cpaEmailSentAt!.toISOString() });
  }

  if (!body || !isNonEmptyEmailArray(body.to)) {
    return NextResponse.json({ error: "Thiếu người nhận (To)" }, { status: 400 });
  }
  if (typeof body.subject !== "string" || !body.subject.trim()) {
    return NextResponse.json({ error: "Thiếu tiêu đề (Subject)" }, { status: 400 });
  }
  const cc: string[] = Array.isArray(body.cc) ? body.cc.filter((s: unknown) => typeof s === "string" && s.trim()) : [];
  const attachments: CpaEmailAttachment[] = Array.isArray(body.attachments) ? body.attachments : [];

  const totalBytes = attachments.reduce((sum, a) => {
    if (typeof a?.contentBase64 !== "string") return sum;
    // 1 ký tự base64 ≈ 0.75 byte dữ liệu gốc.
    return sum + Math.ceil((a.contentBase64.length * 3) / 4);
  }, 0);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "Tổng dung lượng tệp đính kèm vượt quá 4MB" }, { status: 400 });
  }

  try {
    await sendCpaEmail({
      to: body.to,
      cc,
      subject: body.subject.trim(),
      html: typeof body.html === "string" ? body.html : "",
      text: typeof body.text === "string" ? body.text : "",
      attachments,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gửi email thất bại, thử lại sau.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const updated = await prisma.case.update({ where: { id }, data: { cpaEmailSentAt: new Date() } });
  return NextResponse.json({ ok: true, cpaEmailSentAt: updated.cpaEmailSentAt!.toISOString() });
}
