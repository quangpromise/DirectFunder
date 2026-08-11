import { CaseRecord } from "./types";
import { getAllClientNames, getClientEntries } from "./client-name";
import { buildMonthYear } from "./month-year";
import { renderTemplate } from "./email-template-render";

/** Biến khả dụng trong subjectTemplate/bodyTemplate — Admin chèn dạng {clientName}. */
export interface CpaEmailTemplateVars {
  clientName: string;
  ssn: string;
  phone: string;
  address: string;
  zipcode: string;
  money: string;
  caseNumber: string;
  status: string;
  /** Bảng HTML tên + SSN từng client (chỉ Client dưới nếu có điền tên) — xem buildClientRowsHtml. */
  clientRows: string;
  /** 3 chữ đầu tên tháng hiện tại (tiếng Anh) + 2 số cuối năm hiện tại, vd "Aug26" — tính tại
   * thời điểm mở dialog gửi (không phải lúc Admin cấu hình mẫu). */
  monthYear: string;
  /** Tài khoản Gmail dùng để gửi (GMAIL_USER phía server) — dùng làm fallback nếu senderName rỗng. */
  senderEmail: string;
  /** Tên người dùng đang đăng nhập (người bấm Gửi mail CPA) — dùng cho chữ ký cuối mail
   * thay vì lộ nguyên địa chỉ Gmail dùng để gửi. */
  senderName: string;
}

export const CPA_EMAIL_TEMPLATE_VAR_KEYS = [
  "clientName",
  "ssn",
  "phone",
  "address",
  "zipcode",
  "money",
  "caseNumber",
  "status",
  "clientRows",
  "monthYear",
  "senderEmail",
  "senderName",
] as const satisfies readonly (keyof CpaEmailTemplateVars)[];

/** Bảng HTML 2 cột (Tên | SSN) — 1 dòng cho Client trên, thêm 1 dòng cho Client dưới nếu
 * có điền tên (giữ đúng SSN của từng slot, không gộp như {clientName}/{ssn}). */
function buildClientRowsHtml(c: CaseRecord): string {
  const rows = getClientEntries(c)
    .map(({ slot, name }) => {
      if (!name) return "";
      const ssn = c.ssn[slot] || "—";
      return `<tr><td style="padding:2px 40px 2px 0">${name}</td><td style="padding:2px 0">SSN ${ssn}</td></tr>`;
    })
    .filter(Boolean)
    .join("");
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0">${rows}</table>`;
}

export function buildTemplateVars(
  c: CaseRecord,
  statusLabel: string,
  senderEmail: string,
  senderName: string
): CpaEmailTemplateVars {
  return {
    clientName: getAllClientNames(c) || "—",
    ssn: c.ssn.filter(Boolean).join(" / ") || "—",
    // Kèm thêm Phone 2 (nhập ở popup "Edit Hồ sơ") nếu có — chỉ Phone 1 thì giữ nguyên
    // như trước, không hiện dấu "/" thừa.
    phone: [c.phone, c.phone2].filter(Boolean).join(" / ") || "—",
    address: c.address || "—",
    zipcode: c.zipcode || "—",
    money: `$${c.money.toLocaleString("en-US")}`,
    caseNumber: c.caseNumber,
    status: statusLabel,
    clientRows: buildClientRowsHtml(c),
    monthYear: buildMonthYear(new Date()),
    senderEmail,
    senderName: senderName || senderEmail,
  };
}

/** Thay {clientName}, {ssn}... bằng dữ liệu thật của hồ sơ; token không nhận diện được giữ
 * nguyên. Chỉ còn là 1 wrapper mỏng gọi renderTemplate dùng chung (email-template-render.ts). */
export function renderCpaEmailTemplate(template: string, vars: CpaEmailTemplateVars): string {
  return renderTemplate(template, vars as unknown as Record<string, string>);
}

/** Mẫu Subject mặc định khi Admin chưa cấu hình — {clientName} tự gộp Client trên + Client
 * dưới (nếu có) qua getAllClientNames(). */
export const DEFAULT_SUBJECT_TEMPLATE = "[EC] {clientName} - {phone}";

/** Mẫu Body mặc định khi Admin chưa cấu hình. */
export const DEFAULT_BODY_TEMPLATE = [
  "<p>Dear Robert and Hannah,</p>",
  "<p>Kindly review this file (in server IP 46.21.148.154)</p>",
  "{clientRows}",
  "<p>***Please see line bôi vàng để trống tự điền in the {monthYear} sheet - 2026 RA- EC Client list.</p>",
  "<p>Best Regards,</p>",
  "<p>{senderName}</p>",
].join("");
