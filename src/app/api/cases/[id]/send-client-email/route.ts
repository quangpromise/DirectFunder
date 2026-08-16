import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { sendClientEmailSmtp, WebmailAuthError, type SendClientEmailInlineAttachment } from "@/lib/client-mailer";
import { decryptSecret } from "@/lib/webmail-crypto";
import {
  DEFAULT_SIGNATURE_JOB_TITLE,
  DEFAULT_SIGNATURE_PHONE,
  DEFAULT_SIGNATURE_ADDRESS,
  DEFAULT_SUPPORT_PHONE,
} from "@/lib/client-email-template";
import { finalizeRefundEmailHtml } from "@/lib/refund-notification-email";
import { REFUND_YEARS } from "@/lib/refund";
import type { ClientEmailTemplate, FeaturePermissions } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA_URI_RE = /^data:([^;]+);base64,(.+)$/;
/** Giới hạn body request serverless (Vercel ~4.5MB mặc định) — base64 phình ~33% so với
 * dung lượng gốc, cùng ngưỡng với send-cpa-email/route.ts. */
const MAX_TOTAL_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/** Parse "data:image/jpeg;base64,xxx" (định dạng User.avatarUrl lưu trong DB) thành buffer
 * + content-type để gắn làm cid attachment — trả null nếu avatarUrl trống/không đúng định
 * dạng data URI (vd đã từng là URL thường ở phiên bản cũ). */
function parseAvatarDataUri(avatarUrl: string | null): { contentType: string; buffer: Buffer } | null {
  if (!avatarUrl) return null;
  const match = DATA_URI_RE.exec(avatarUrl);
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
}

function isNonEmptyEmailArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && EMAIL_RE.test(s.trim()));
}

/** Gửi email "Thông báo hoàn thuế" tới email khách hàng của hồ sơ — SMTP mail.directfunder.com
 * THEO TỪNG USER. Bấm "Confirm" ở popup chọn năm (SendClientEmailButton) trước tiên gọi
 * POST /api/cases/[id]/refund-email-preview để dựng sẵn subject/bodyHtml, cho sửa tay ở màn
 * hình soạn mail, RỒI mới gọi route này để gửi thật — route này LUÔN nhận thẳng
 * subject/bodyHtml đã (có thể) sửa từ client, không tự build lại từ template (khác thiết kế
 * cũ trước 2026-08-16 vốn tự tính 100% từ dữ liệu hồ sơ, không cho sửa tay). Tax INT nhập
 * vào luôn được LƯU lại vào Case.taxIntByYear trước khi thử gửi (không mất dữ liệu gõ nếu
 * gửi thất bại). `clientEmailSentAt` lưu xuống DB (gửi thật hoặc "Mark as sent" thủ công đều
 * lưu) để nút giữ đúng trạng thái xanh qua reload — cùng cơ chế sheetSentAt/cpaEmailSentAt/
 * cpaReviewTestSentAt (xem SendClientEmailButton). */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/send-client-email">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendClientEmail", me.role)) {
    return NextResponse.json({ error: "Không có quyền gửi email cho khách hàng" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as
    | {
        years?: string[];
        taxInt?: Record<string, string>;
        subject?: string;
        bodyHtml?: string;
        to?: string[];
        cc?: string[];
        attachments?: { filename: string; contentType: string; contentBase64: string }[];
        manual?: boolean;
        clear?: boolean;
      }
    | null;

  // manual: bấm "Mark as sent" (đã gửi qua đường khác, KHÔNG gọi SMTP thật).
  // clear: bấm xác nhận "muốn gửi lại" (xoá clientEmailSentAt, không gọi SMTP).
  if (body?.clear === true) {
    const updated = await prisma.case.update({ where: { id }, data: { clientEmailSentAt: null } });
    return NextResponse.json({ ok: true, clientEmailSentAt: updated.clientEmailSentAt });
  }
  if (body?.manual === true) {
    const updated = await prisma.case.update({ where: { id }, data: { clientEmailSentAt: new Date() } });
    return NextResponse.json({ ok: true, clientEmailSentAt: updated.clientEmailSentAt!.toISOString() });
  }

  const years = (body?.years ?? []).filter((y): y is string => REFUND_YEARS.includes(y as (typeof REFUND_YEARS)[number]));
  if (years.length === 0) {
    return NextResponse.json({ error: "Chưa chọn năm nào" }, { status: 400 });
  }
  const taxIntInput = body?.taxInt ?? {};
  if (typeof body?.subject !== "string" || !body.subject.trim()) {
    return NextResponse.json({ error: "Thiếu tiêu đề (Subject)" }, { status: 400 });
  }
  const subject = body.subject.trim();
  const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml : "";
  if (!isNonEmptyEmailArray(body.to)) {
    return NextResponse.json({ error: "Thiếu người nhận (To) hoặc email không đúng định dạng" }, { status: 400 });
  }
  const to = body.to.map((s) => s.trim());
  const attachmentsInput = Array.isArray(body.attachments) ? body.attachments : [];
  const attachmentBytes = attachmentsInput.reduce((sum, a) => {
    if (typeof a?.contentBase64 !== "string") return sum;
    // 1 ký tự base64 ≈ 0.75 byte dữ liệu gốc.
    return sum + Math.ceil((a.contentBase64.length * 3) / 4);
  }, 0);
  if (attachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "Tổng dung lượng tệp đính kèm vượt quá 4MB" }, { status: 400 });
  }

  const row = await prisma.case.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });

  const userWithCreds = await prisma.user.findUnique({
    where: { id: me.id },
    select: { webmailUsername: true, webmailPasswordEncrypted: true },
  });
  if (!userWithCreds?.webmailUsername || !userWithCreds.webmailPasswordEncrypted) {
    return NextResponse.json({ error: "WEBMAIL_NOT_CONNECTED" }, { status: 428 });
  }

  // Lưu Tax INT NGAY trước khi thử gửi — không mất dữ liệu người dùng vừa gõ nếu SMTP lỗi.
  const existingTaxInt = (row.taxIntByYear as Record<string, string> | null) ?? {};
  const mergedTaxInt: Record<string, string> = { ...existingTaxInt };
  for (const year of years) {
    if (year in taxIntInput) mergedTaxInt[year] = taxIntInput[year];
  }
  await prisma.case.update({ where: { id }, data: { taxIntByYear: mergedTaxInt as unknown as object } });

  const templateConfig = config?.clientEmailTemplate as unknown as ClientEmailTemplate | null;

  const html = finalizeRefundEmailHtml(
    bodyHtml,
    {
      senderName: me.name,
      senderEmail: userWithCreds.webmailUsername,
      jobTitle: templateConfig?.signatureJobTitle?.trim() || DEFAULT_SIGNATURE_JOB_TITLE,
      phone: templateConfig?.signaturePhone?.trim() || DEFAULT_SIGNATURE_PHONE,
      address: templateConfig?.signatureAddress?.trim() || DEFAULT_SIGNATURE_ADDRESS,
      supportPhone: templateConfig?.supportPhone?.trim() || DEFAULT_SUPPORT_PHONE,
    },
    Boolean(me.avatarUrl)
  );

  const attachments: SendClientEmailInlineAttachment[] = attachmentsInput.map((a) => ({
    filename: a.filename,
    contentType: a.contentType || "application/octet-stream",
    content: Buffer.from(a.contentBase64, "base64"),
  }));
  const avatar = parseAvatarDataUri(me.avatarUrl);
  if (avatar) {
    attachments.push({ cid: "userAvatar", filename: "avatar.jpg", contentType: avatar.contentType, content: avatar.buffer });
  }
  try {
    const bannerBuffer = await readFile(path.join(process.cwd(), "public", "logo-chuky.png"));
    attachments.push({ cid: "companyBanner", filename: "logo-chuky.png", contentType: "image/png", content: bannerBuffer });
  } catch {
    // Thiếu file banner (vd môi trường build lạ) — vẫn gửi mail, chỉ mất ảnh banner cuối chữ ký.
  }

  // Luôn CC thêm chính email webmail của người bấm gửi (để họ tự lưu lại 1 bản) — cộng
  // dồn với Cc Admin đã cấu hình (hoặc Cc client tự sửa ở màn hình soạn mail nếu có gửi
  // lên), loại trùng nếu đã lỡ liệt kê sẵn cùng địa chỉ.
  const ccBase = Array.isArray(body?.cc) ? body.cc.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : (templateConfig?.cc ?? []);
  const cc = Array.from(new Set([...ccBase, userWithCreds.webmailUsername]));

  try {
    const smtpPass = decryptSecret(userWithCreds.webmailPasswordEncrypted);
    await sendClientEmailSmtp({ smtpUser: userWithCreds.webmailUsername, smtpPass, to, cc, subject, html, attachments });
  } catch (err) {
    if (err instanceof WebmailAuthError) {
      // Sai mật khẩu/mailbox bị khoá — xoá credential đã lưu để lần bấm gửi kế tiếp phát
      // hiện đúng "chưa kết nối" (428) thay vì lặp lại lỗi âm thầm mỗi lần.
      await prisma.user.update({ where: { id: me.id }, data: { webmailUsername: null, webmailPasswordEncrypted: null } });
      return NextResponse.json({ error: "WEBMAIL_NOT_CONNECTED" }, { status: 428 });
    }
    const message = err instanceof Error ? err.message : "Gửi email thất bại, thử lại sau.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const updated = await prisma.case.update({ where: { id }, data: { clientEmailSentAt: new Date() } });
  return NextResponse.json({ ok: true, clientEmailSentAt: updated.clientEmailSentAt!.toISOString() });
}
