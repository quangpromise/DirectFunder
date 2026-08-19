import nodemailer from "nodemailer";

/**
 * Gửi email qua Gmail SMTP + App Password — dùng chung 1 tài khoản Gmail công ty cho
 * mọi lần gửi (không phải OAuth2 per-user, xem lý do lựa chọn ở
 * .claude/rules/deployment-database-sync.md). App Password là chuỗi 16 ký tự tạo tại
 * myaccount.google.com/apppasswords (yêu cầu bật 2FA), KHÔNG phải mật khẩu Google
 * thường. Lưu ý Gmail SMTP có giới hạn gửi ~500 mail/ngày cho tài khoản thường (2000
 * cho Workspace) — không enforce trong code, chỉ ghi chú vận hành ở đây.
 */

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("Thiếu GMAIL_USER/GMAIL_APP_PASSWORD trong biến môi trường");
  }
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  return transporter;
}

export interface CpaEmailAttachment {
  filename: string;
  contentType: string;
  /** Bytes gốc -- route `send-cpa-email` tự tải về từ Vercel Blob (client upload thẳng lên
   * Blob, né giới hạn ~4.5MB thân request, xem `.claude/skills/vercel-blob-large-upload/
   * SKILL.md`) rồi truyền thẳng Buffer vào đây, không qua base64 (nodemailer nhận Buffer
   * trực tiếp, không cần encode/decode thêm 1 vòng). */
  content: Buffer;
}

export interface SendCpaEmailInput {
  to: string[];
  cc: string[];
  subject: string;
  /** Nội dung HTML (từ contentEditable) — nodemailer field `html`. */
  html: string;
  /** Bản plain-text tương ứng (từ innerText) — fallback cho mail client không đọc HTML. */
  text: string;
  attachments: CpaEmailAttachment[];
}

/** Map lỗi nodemailer/SMTP thô thành message tiếng Việt rõ ràng cho người dùng cuối. */
function mapSendError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string } | undefined;
  if (e?.code === "EAUTH" || e?.responseCode === 535) {
    return "Sai thông tin đăng nhập Gmail — liên hệ Admin kiểm tra lại App Password.";
  }
  if (e?.code === "EENVELOPE") {
    return "Địa chỉ email không hợp lệ, kiểm tra lại To/Cc.";
  }
  return "Gửi email thất bại, thử lại sau.";
}

export async function sendCpaEmail(input: SendCpaEmailInput): Promise<void> {
  const user = process.env.GMAIL_USER;
  const senderName = process.env.GMAIL_SENDER_NAME;
  try {
    const info = await getTransporter().sendMail({
      from: senderName ? { name: senderName, address: user! } : user,
      to: input.to.join(", "),
      cc: input.cc.length > 0 ? input.cc.join(", ") : undefined,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    // Gmail có thể chấp nhận giao dịch SMTP nhưng từ chối riêng lẻ 1 vài địa chỉ không
    // hợp lệ — không throw, chỉ trả về trong info.rejected, nên phải tự kiểm tra thêm.
    const rejected = (info as { rejected?: string[] }).rejected;
    if (rejected && rejected.length > 0) {
      throw new Error(`Địa chỉ bị từ chối: ${rejected.join(", ")}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Địa chỉ bị từ chối:")) throw err;
    throw new Error(mapSendError(err));
  }
}
