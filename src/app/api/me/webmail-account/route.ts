import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { encryptSecret } from "@/lib/webmail-crypto";
import { verifyWebmailCredentials, WebmailAuthError } from "@/lib/client-mailer";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Kết nối mailbox webmail (mail.directfunder.com) riêng của user hiện tại cho tính năng
 * "Gửi email cho khách hàng" — thay cho popup OAuth Microsoft cũ (đã gỡ bỏ). Xác minh
 * đăng nhập SMTP thật ngay lúc kết nối (verifyWebmailCredentials) để báo sai mật khẩu tức
 * thì, không đợi tới lúc gửi mail đầu tiên mới phát hiện. */
export async function POST(request: Request) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  const email = body?.email?.trim();
  const password = body?.password;
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Email webmail không đúng định dạng" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "Vui lòng nhập mật khẩu webmail" }, { status: 400 });
  }

  try {
    await verifyWebmailCredentials(email, password);
  } catch (err) {
    if (err instanceof WebmailAuthError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Không kết nối được webmail, thử lại sau.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await prisma.user.update({
    where: { id: me.id },
    data: { webmailUsername: email, webmailPasswordEncrypted: encryptSecret(password) },
  });

  return NextResponse.json({ ok: true });
}

/** Ngắt kết nối — cho user đổi sang mailbox/mật khẩu webmail khác. */
export async function DELETE() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  await prisma.user.update({
    where: { id: me.id },
    data: { webmailUsername: null, webmailPasswordEncrypted: null },
  });

  return NextResponse.json({ ok: true });
}
