import nodemailer from "nodemailer";

/**
 * Gửi email qua SMTP webmail mail.directfunder.com — mỗi user tự kết nối MAILBOX RIÊNG
 * của mình (email + mật khẩu webmail thật, mã hóa lưu ở User.webmailUsername/
 * webmailPasswordEncrypted, xem src/lib/webmail-crypto.ts), khác Gmail App Password dùng
 * chung 1 mailbox ở mailer.ts. Thay cho Microsoft Graph OAuth2 cũ (đã gỡ bỏ — không có
 * quyền admin Azure AD để tạo App registration, xem
 * .claude/rules/deployment-database-sync.md). Credential động theo từng lần gọi (không
 * cache transporter như mailer.ts vì mỗi user 1 bộ user/pass khác nhau).
 */

/** Sai email/mật khẩu webmail — route bắt riêng lỗi này để xóa credential đã lưu, buộc
 * user kết nối lại thay vì lặp lại lỗi âm thầm mỗi lần gửi. */
export class WebmailAuthError extends Error {}

export interface SendClientEmailInlineAttachment {
  /** Tham chiếu trong HTML dạng src="cid:{cid}" — vd "userAvatar"/"companyBanner" (xem
   * refund-notification-email.ts). Bỏ trống (undefined) với tệp đính kèm THƯỜNG người dùng
   * tự thêm ở màn hình soạn mail (thêm 2026-08-16) — chỉ 2 ảnh chữ ký mới cần cid. */
  cid?: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface SendClientEmailSmtpInput {
  smtpUser: string;
  smtpPass: string;
  /** Nhiều người nhận (thêm 2026-08-16, trước đó chỉ 1 địa chỉ cố định lấy từ Case.email) —
   * người dùng tự sửa được ở màn hình soạn mail. */
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  /** Ảnh chèn (avatar user + banner công ty, có `cid`) VÀ tệp đính kèm thường người dùng
   * tự thêm (không có `cid`) — gộp chung 1 mảng gửi thẳng cho nodemailer. */
  attachments?: SendClientEmailInlineAttachment[];
}

function mapSendError(err: unknown): Error {
  const e = err as { code?: string; responseCode?: number; message?: string } | undefined;
  if (e?.code === "EAUTH" || e?.responseCode === 535) {
    return new WebmailAuthError("Sai email hoặc mật khẩu webmail — cần kết nối lại.");
  }
  if (e?.code === "EENVELOPE") {
    return new Error("Địa chỉ email khách hàng không hợp lệ.");
  }
  return new Error("Gửi email thất bại, thử lại sau.");
}

export async function sendClientEmailSmtp(input: SendClientEmailSmtpInput): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.WEBMAIL_SMTP_HOST || "mail.directfunder.com",
    port: Number(process.env.WEBMAIL_SMTP_PORT || 465),
    secure: true,
    auth: { user: input.smtpUser, pass: input.smtpPass },
  });
  try {
    const info = await transporter.sendMail({
      from: input.smtpUser,
      to: input.to.join(", "),
      cc: input.cc && input.cc.length > 0 ? input.cc.join(", ") : undefined,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        cid: a.cid,
      })),
    });
    // Cùng lưu ý như mailer.ts: server SMTP có thể chấp nhận giao dịch nhưng từ chối
    // riêng địa chỉ người nhận không hợp lệ qua info.rejected thay vì throw.
    const rejected = (info as { rejected?: string[] }).rejected;
    if (rejected && rejected.length > 0) {
      throw new Error(`Địa chỉ bị từ chối: ${rejected.join(", ")}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Địa chỉ bị từ chối:")) throw err;
    throw mapSendError(err);
  }
}

/** Xác minh 1 cặp email/mật khẩu webmail có đăng nhập SMTP được không — dùng ngay lúc user
 * bấm "Kết nối" để báo lỗi tức thì thay vì lưu credential sai rồi mới phát hiện lúc gửi. */
export async function verifyWebmailCredentials(smtpUser: string, smtpPass: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.WEBMAIL_SMTP_HOST || "mail.directfunder.com",
    port: Number(process.env.WEBMAIL_SMTP_PORT || 465),
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });
  try {
    await transporter.verify();
  } catch (err) {
    throw mapSendError(err);
  }
}
