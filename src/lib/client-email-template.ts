import { CaseRecord } from "./types";
import { getAllClientNames } from "./client-name";

/**
 * Biến khả dụng trong mẫu email GỬI TRỰC TIẾP CHO KHÁCH HÀNG (khác với
 * CpaEmailTemplateVars ở cpa-email-template.ts) — CỐ Ý loại bỏ mọi trường nội bộ nhạy cảm/
 * vô nghĩa với khách hàng (ssn, zipcode, money, clientRows, status, monthYear) để Admin
 * không lỡ chèn nhầm dữ liệu nội bộ vào mail gửi ra ngoài công ty.
 */
export interface ClientEmailTemplateVars {
  clientName: string;
  phone: string;
  address: string;
  caseNumber: string;
  /** Tên người dùng đang đăng nhập (người bấm gửi) — dùng cho chữ ký cuối mail. */
  senderName: string;
  /** Mailbox Outlook @directfunder.com của người bấm gửi — dùng làm fallback nếu senderName rỗng. */
  senderEmail: string;
}

export const CLIENT_EMAIL_TEMPLATE_VAR_KEYS = [
  "clientName",
  "phone",
  "address",
  "caseNumber",
  "senderName",
  "senderEmail",
] as const satisfies readonly (keyof ClientEmailTemplateVars)[];

export function buildClientTemplateVars(c: CaseRecord, senderEmail: string, senderName: string): ClientEmailTemplateVars {
  return {
    clientName: getAllClientNames(c) || "—",
    phone: [c.phone, c.phone2].filter(Boolean).join(" / ") || "—",
    address: c.address || "—",
    caseNumber: c.caseNumber,
    senderName: senderName || senderEmail,
    senderEmail,
  };
}

/** Mẫu Subject mặc định khi Admin chưa cấu hình. */
export const DEFAULT_CLIENT_EMAIL_SUBJECT = "Cập nhật hồ sơ {caseNumber} - {clientName}";

/** Mẫu Body mặc định khi Admin chưa cấu hình. */
export const DEFAULT_CLIENT_EMAIL_BODY = [
  "<p>Dear {clientName},</p>",
  "<p>Thank you for working with us. We wanted to check in regarding your file {caseNumber}.</p>",
  "<p>If you have any questions, feel free to reply to this email.</p>",
  "<p>Best Regards,</p>",
  "<p>{senderName}</p>",
].join("");
