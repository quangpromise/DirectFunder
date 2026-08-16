import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Mã hóa 2 chiều (AES-256-GCM) cho mật khẩu webmail của từng user (tính năng "Gửi email
 * cho khách hàng" qua SMTP mail.directfunder.com, xem src/lib/client-mailer.ts) — khác
 * googleRefreshToken/microsoftRefreshToken (đã bỏ) vốn là OAuth refresh token có thể thu
 * hồi từ xa, mật khẩu webmail là secret thật không revocable nên phải mã hóa trước khi
 * lưu DB thay vì lưu plain text như 2 token đó.
 *
 * Format lưu trong DB: "<iv base64>:<authTag base64>:<ciphertext base64>".
 */

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.WEBMAIL_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new Error("Thiếu WEBMAIL_CREDENTIAL_ENCRYPTION_KEY trong biến môi trường");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("WEBMAIL_CREDENTIAL_ENCRYPTION_KEY phải là chuỗi base64 của đúng 32 byte");
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const [ivB64, authTagB64, ciphertextB64] = stored.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Dữ liệu mật khẩu webmail đã lưu bị sai định dạng");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plain.toString("utf8");
}
