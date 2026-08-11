import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { sendClientEmail, MicrosoftAuthExpiredError } from "@/lib/microsoft-graph";
import { buildClientTemplateVars, DEFAULT_CLIENT_EMAIL_SUBJECT, DEFAULT_CLIENT_EMAIL_BODY } from "@/lib/client-email-template";
import { renderTemplate } from "@/lib/email-template-render";
import { toCaseRecord } from "@/app/api/cases/route";
import type { ClientEmailTemplate, FeaturePermissions } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Gửi 1 email mẫu cố định (Admin cấu hình ở trang Phân quyền) tới email khách hàng của
 * hồ sơ — auth OAuth2 THEO TỪNG USER (microsoftRefreshToken trên User, mailbox Outlook
 * @directfunder.com riêng của người bấm gửi), không phải 1 mailbox chung như sendCpaEmail.
 * KHÔNG có nhánh manual/clear — gửi email khách hàng là hành động tự do, gửi lại bao nhiêu
 * lần cũng hợp lý (follow-up), không cần trạng thái "đã gửi" bền vững như sheetSentAt/
 * cpaEmailSentAt (xem app-store.ts, lịch sử gửi vẫn đủ qua Edit History/logEdit). */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/send-client-email">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendClientEmail", me.role)) {
    return NextResponse.json({ error: "Không có quyền gửi email cho khách hàng" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const row = await prisma.case.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });

  const email = row.email?.trim();
  if (!email) {
    return NextResponse.json({ error: "Hồ sơ chưa có email khách hàng" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Email khách hàng không đúng định dạng" }, { status: 400 });
  }

  const userWithToken = await prisma.user.findUnique({ where: { id: me.id }, select: { microsoftRefreshToken: true } });
  if (!userWithToken?.microsoftRefreshToken) {
    return NextResponse.json({ error: "MICROSOFT_NOT_CONNECTED" }, { status: 428 });
  }

  const caseRecord = toCaseRecord(row);
  const templateConfig = config?.clientEmailTemplate as unknown as ClientEmailTemplate | null;
  const vars = buildClientTemplateVars(caseRecord, me.email, me.name) as unknown as Record<string, string>;
  const subject = renderTemplate(templateConfig?.subjectTemplate?.trim() || DEFAULT_CLIENT_EMAIL_SUBJECT, vars);
  const html = renderTemplate(templateConfig?.bodyTemplate?.trim() || DEFAULT_CLIENT_EMAIL_BODY, vars);

  try {
    await sendClientEmail({ refreshToken: userWithToken.microsoftRefreshToken, to: email, subject, html });
  } catch (err) {
    if (err instanceof MicrosoftAuthExpiredError) {
      // Token đã thu hồi/hết hạn — xoá luôn để lần bấm gửi kế tiếp phát hiện đúng
      // "chưa kết nối" (428) thay vì thử lại refresh_token đã chết mỗi lần.
      await prisma.user.update({ where: { id: me.id }, data: { microsoftRefreshToken: null } });
      return NextResponse.json({ error: "MICROSOFT_NOT_CONNECTED" }, { status: 428 });
    }
    const message = err instanceof Error ? err.message : "Gửi email thất bại, thử lại sau.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
