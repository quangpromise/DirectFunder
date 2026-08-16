import { CaseRecord } from "./types";
import { getAllClientNames } from "./client-name";
import { REFUND_YEARS } from "./refund";
import { renderTemplate } from "./email-template-render";
import {
  DEFAULT_REFUND_EMAIL_SUBJECT_VI,
  DEFAULT_REFUND_EMAIL_SUBJECT_EN,
  DEFAULT_REFUND_EMAIL_BODY_VI,
  DEFAULT_REFUND_EMAIL_BODY_EN,
  DEFAULT_BREAKDOWN_TAX_CREDIT_LABEL,
  DEFAULT_BREAKDOWN_TAX_INT_LABEL,
  DEFAULT_BREAKDOWN_ESTIMATED_LABEL,
} from "./client-email-template";

/**
 * Build subject + HTML body cho email "Thông báo hoàn thuế" gửi khách hàng (nút gửi mail
 * cạnh ô Email trong popup Edit Hồ sơ) — Subject/Body LÀ template Admin tự sửa được (xem
 * ClientEmailTemplate trong types.ts, dialog cấu hình ở trang Phân quyền), render qua
 * renderTemplate() (plain {key} substitution, token lạ giữ nguyên) với các token tính ở
 * `buildTokens()` bên dưới — trong đó {breakdown} là khối HTML Tax credit/Additional tax
 * on 1099-INT/Estimated refund amount tính từ refund từng năm trừ Tax INT đã nhập, KHÔNG
 * thể gõ tay được (chỉ có thể đặt token {breakdown} ở đâu trong template, không sửa nội
 * dung bên trong). Chữ ký (ảnh avatar user + banner công ty) LUÔN nối vào cuối, không đi
 * qua template — HTML chỉ tham chiếu "cid:userAvatar"/"cid:companyBanner", route gắn ảnh
 * thật dưới dạng cid attachment.
 */

export type RefundEmailLanguage = "vi" | "en";

export interface RefundEmailSignatureInfo {
  senderName: string;
  senderEmail: string;
  jobTitle: string;
  phone: string;
  address: string;
  supportPhone: string;
}

/** Subject + nội dung HTML (chưa gắn chữ ký, chưa wrap light-mode document) — đây là phần
 * người dùng XEM/SỬA được ở màn hình "soạn mail" trước khi gửi thật (thêm 2026-08-16,
 * xem POST /api/cases/[id]/refund-email-preview + SendClientEmailButton). Tách riêng khỏi
 * `finalizeRefundEmailHtml()` vì chữ ký (ảnh avatar/banner qua cid) và bước wrap
 * !important/color-scheme luôn cố định, không cho sửa tay. */
export interface RefundEmailContent {
  subject: string;
  bodyHtml: string;
}

export interface BuildRefundEmailContentInput {
  caseRecord: CaseRecord;
  /** Năm đã chọn trong popup gửi — thứ tự bất kỳ, hàm tự sắp lại theo REFUND_YEARS. */
  years: string[];
  /** Số Tax INT nhập trong popup cho các năm đã chọn (đã merge với giá trị đã lưu trước
   * đó nếu người dùng không sửa lại) — key = năm, value = chuỗi số (rỗng/không parse được
   * = 0). */
  taxIntByYear: Record<string, string>;
  language: RefundEmailLanguage;
  /** 3 token {supportPhone}/{senderName}/{senderEmail} dùng được trong Subject/Body —
   * chỉ vậy, KHÔNG kèm jobTitle/phone/address (3 field đó chỉ nằm trong chữ ký, xem
   * finalizeRefundEmailHtml()). */
  supportPhone: string;
  senderName: string;
  senderEmail: string;
  /** Template Admin đã cấu hình (AppConfig.clientEmailTemplate) — rỗng/thiếu field nào thì
   * dùng DEFAULT_REFUND_EMAIL_SUBJECT/BODY_VI/EN tương ứng trong client-email-template.ts. */
  subjectTemplate?: string;
  bodyTemplate?: string;
  /** 3 nhãn trong khối {breakdown} (hỗ trợ token {year}) — Admin tự sửa được, số tiền đi
   * kèm luôn tính động, không đi qua template. Rỗng field nào = dùng
   * DEFAULT_BREAKDOWN_*_LABEL trong client-email-template.ts. */
  breakdownLabels?: { taxCredit?: string; taxInt?: string; estimated?: string };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function sortedYears(years: string[]): string[] {
  return REFUND_YEARS.filter((y) => years.includes(y));
}

interface YearBreakdown {
  year: string;
  refund: number;
  taxInt: number;
  /** false nếu ô Tax INT năm này để trống (khác nhập "0" — vẫn tính, chỉ khác không hiện
   * 2 dòng Additional tax on 1099-INT/Estimated refund amount, xem breakdownHtml). */
  hasTaxInt: boolean;
  estimated: number;
}

function buildBreakdowns(caseRecord: CaseRecord, years: string[], taxIntByYear: Record<string, string>): YearBreakdown[] {
  return years.map((year) => {
    const refund = caseRecord.refunds[year] ?? 0;
    const raw = taxIntByYear[year]?.trim() ?? "";
    const hasTaxInt = raw !== "";
    const taxInt = Number(raw) || 0;
    return { year, refund, taxInt, hasTaxInt, estimated: refund - taxInt };
  });
}

/** Màu nền vàng chung cho cả khối breakdown mỗi năm (Tax Credit/Tax INT/Estimated) — cùng
 * màu vàng mặc định của MailBodyEditor (BG_COLORS[0], "#fde047") để nhất quán với màu Admin
 * hay dùng bôi vàng chỗ khác trong mail. */
const BREAKDOWN_BG_COLOR = "#fde047";

/** Dùng <table> (2 cột: nhãn trái, số tiền phải) thay vì các dòng <p> rời — cách duy nhất
 * đảm bảo 3 dòng tiền thẳng hàng đúng trên MỌI mail client (flexbox/CSS align không đáng
 * tin cậy trong email, table 2 cột là kỹ thuật chuẩn cho layout email HTML). background-color
 * đặt TRỰC TIẾP trên từng `<td>` (không phải `<table>`/`<tr>`) — cách duy nhất Outlook desktop
 * (dùng engine Word) render nền đúng, table/tr thường bị Outlook bỏ qua nền. */
function moneyRow(prefix: string, label: string, amount: string, opts?: { bold?: boolean; underline?: boolean }): string {
  const weight = opts?.bold ? "font-weight:bold;" : "";
  const underline = opts?.underline ? "text-decoration:underline;" : "";
  const cellStyle = `background-color:${BREAKDOWN_BG_COLOR};padding:2px 10px 2px 4px;white-space:nowrap;${weight}${underline}`;
  const amountStyle = `background-color:${BREAKDOWN_BG_COLOR};text-align:right;padding:2px 4px 2px 10px;white-space:nowrap;${weight}${underline}`;
  return `<tr><td style="${cellStyle}">${prefix} ${label}:</td><td style="${amountStyle}">${amount}</td></tr>`;
}

/** labels.taxCredit/taxInt/estimated là template Admin tự sửa (hỗ trợ token {year}, render
 * riêng cho từng năm qua renderTemplate) — CHỈ phần chữ nhãn là cấu hình được, số tiền
 * tương ứng LUÔN tính động (refund/Tax INT/estimated từng năm), không thể gõ tay. Dòng
 * "Additional tax on 1099-INT" luôn có gạch chân riêng để tách biệt với 2 dòng còn lại. */
function breakdownHtml(
  breakdowns: YearBreakdown[],
  labelTemplates: { taxCredit: string; taxInt: string; estimated: string }
): string {
  return breakdowns
    .map((b) => {
      const yearVars = { year: b.year };
      const rows = [
        moneyRow("&bull;", renderTemplate(labelTemplates.taxCredit, yearVars), money(b.refund)),
      ];
      if (b.hasTaxInt) {
        rows.push(moneyRow("&bull;", renderTemplate(labelTemplates.taxInt, yearVars), `-${money(b.taxInt)}`, { underline: true }));
        rows.push(moneyRow("=&gt;", renderTemplate(labelTemplates.estimated, yearVars), money(b.estimated), { bold: true }));
      }
      return `<table style="margin-top:14px;border-collapse:collapse;font-size:inherit;font-family:inherit;">${rows.join("")}</table>`;
    })
    .join("");
}

function signatureHtml(sig: RefundEmailSignatureInfo, hasAvatar: boolean): string {
  return [
    `<div style="margin-top:24px;font-family:Arial,sans-serif;font-size:13px;color:#222;">`,
    `<p style="margin:0;font-weight:bold;">${escapeHtml(sig.senderName)}</p>`,
    `<p style="margin:0;">${escapeHtml(sig.jobTitle)}</p>`,
    hasAvatar ? `<p style="margin:6px 0;"><img src="cid:userAvatar" alt="" style="height:64px;width:64px;border-radius:50%;object-fit:cover;" /></p>` : "",
    `<p style="margin:6px 0 0;">Web: DirectFunder.com &nbsp; Email: ${escapeHtml(sig.senderEmail)}</p>`,
    `<p style="margin:0;">Phone: ${escapeHtml(sig.phone)}</p>`,
    `<p style="margin:0;">${escapeHtml(sig.address)}</p>`,
    `<p style="margin:10px 0 0;font-weight:bold;">1099 Contractors &amp; Business Owners get FREE Grants!</p>`,
    `<p style="margin:0;font-weight:bold;">$32,220 (Single) or $64,440 (Couple)</p>`,
    `<p style="margin:10px 0 0;"><img src="cid:companyBanner" alt="Tax Credit Funder" style="max-width:360px;width:100%;height:auto;" /></p>`,
    `</div>`,
  ].join("");
}

/** Build Subject + nội dung HTML CHƯA gắn chữ ký (phần người dùng xem/sửa được ở màn hình
 * "soạn mail" trước khi gửi thật). Gọi `finalizeRefundEmailHtml()` ngay trước khi gửi để
 * gắn chữ ký + wrap light-mode document. */
export function buildRefundEmailContent(input: BuildRefundEmailContentInput): RefundEmailContent {
  const years = sortedYears(input.years);
  const yearsAbbrev = years.map((y) => y.slice(-2)).join("-");
  const yearsFull = years.join(", ");
  const namesJoined = getAllClientNames(input.caseRecord) || "—";
  // Có cả Phone 1 lẫn Phone 2 -> lấy CẢ 2 số (nối bằng " / "), khác trước đây chỉ lấy Phone 2
  // làm dự phòng khi Phone 1 trống.
  const phones = [input.caseRecord.phone, input.caseRecord.phone2].filter((p): p is string => Boolean(p?.trim()));
  const phone = phones.length > 0 ? phones.join(" / ") : "—";

  const bankName = input.caseRecord.bankName?.trim() || "—";
  const routingNumber = input.caseRecord.routingNumber?.trim() || "—";
  const accountNumber = input.caseRecord.accountNumber?.trim() || "—";
  const bankLine = `${bankName} ${routingNumber} - ${accountNumber}`;

  const breakdowns = buildBreakdowns(input.caseRecord, years, input.taxIntByYear);
  const breakdown = breakdownHtml(breakdowns, {
    taxCredit: input.breakdownLabels?.taxCredit?.trim() || DEFAULT_BREAKDOWN_TAX_CREDIT_LABEL,
    taxInt: input.breakdownLabels?.taxInt?.trim() || DEFAULT_BREAKDOWN_TAX_INT_LABEL,
    estimated: input.breakdownLabels?.estimated?.trim() || DEFAULT_BREAKDOWN_ESTIMATED_LABEL,
  });

  // Subject là plain text (header email, không phải HTML) nên PHẢI dùng token thô, không
  // escape — escape nhầm ở đây từng làm dư "&amp;" thay vì "&" khi tên có Taxpayer & Spouse.
  const subjectTokens: Record<string, string> = {
    yearsAbbrev,
    yearsFull,
    clientName: namesJoined,
    phone,
    bankLine,
    supportPhone: input.supportPhone,
    senderName: input.senderName,
    senderEmail: input.senderEmail,
  };

  // Body LÀ HTML nên escape mọi token có thể chứa dữ liệu người dùng tự nhập (tên khách,
  // số điện thoại, thông tin ngân hàng, tên/email người gửi) trước khi chèn vào — tránh
  // HTML injection nếu ai đó lỡ gõ ký tự đặc biệt vào các trường này. `breakdown` là ngoại
  // lệ DUY NHẤT vì đã là HTML đã build sẵn an toàn (escapeHtml() riêng bên trong
  // breakdownHtml), escape lại sẽ làm hỏng thẻ HTML của nó.
  const bodyTokens: Record<string, string> = {
    yearsAbbrev: escapeHtml(yearsAbbrev),
    yearsFull: escapeHtml(yearsFull),
    clientName: escapeHtml(namesJoined),
    phone: escapeHtml(phone),
    bankLine: escapeHtml(bankLine),
    breakdown,
    supportPhone: escapeHtml(input.supportPhone),
    senderName: escapeHtml(input.senderName),
    senderEmail: escapeHtml(input.senderEmail),
  };

  const defaultSubject = input.language === "vi" ? DEFAULT_REFUND_EMAIL_SUBJECT_VI : DEFAULT_REFUND_EMAIL_SUBJECT_EN;
  const defaultBody = input.language === "vi" ? DEFAULT_REFUND_EMAIL_BODY_VI : DEFAULT_REFUND_EMAIL_BODY_EN;

  const subject = renderTemplate(input.subjectTemplate?.trim() || defaultSubject, subjectTokens);
  const bodyHtml = renderTemplate(input.bodyTemplate?.trim() || defaultBody, bodyTokens);

  return { subject, bodyHtml };
}

/** Gắn chữ ký (ảnh avatar user + banner công ty qua cid) vào cuối `bodyHtml` (bản đã qua
 * màn hình soạn mail, có thể đã bị người dùng sửa tay) rồi wrap thành light-mode document
 * đầy đủ — LUÔN gọi hàm này ngay trước khi gửi thật, KHÔNG lưu html đã wrap vào state React
 * (chỉ lưu bodyHtml thô để còn sửa tiếp được). */
export function finalizeRefundEmailHtml(bodyHtml: string, signature: RefundEmailSignatureInfo, hasAvatar: boolean): string {
  return wrapAsLightModeDocument(bodyHtml + signatureHtml(signature, hasAvatar));
}

/** Highlight màu nền (bôi vàng...) gõ trong MailBodyEditor render đúng lúc XEM/SỬA trong
 * app nhưng có thể KHÔNG hiện với người nhận thật — nguyên nhân phổ biến nhất là Gmail/
 * Outlook tự bật "Dark mode" cho email không khai báo rõ color-scheme, rồi tự tính lại
 * (auto-darken/invert) các màu nền sáng như vàng thành gần như trong suốt. Cách vá chuẩn
 * (không phải đoán mò — đây là khuyến nghị chính thức của Gmail/Litmus cho vấn đề này):
 * bọc toàn bộ HTML gửi đi thành 1 document đầy đủ, khai báo <meta name="color-scheme"
 * content="light"> + <meta name="supported-color-schemes" content="light"> để email luôn
 * hiển thị đúng bảng màu light đã cấu hình, không bị client tự tính lại theo dark mode máy
 * người nhận. `!important` thêm vào background-color/color trong style inline để thắng
 * mọi CSS reset khác của webmail. */
function wrapAsLightModeDocument(bodyHtml: string): string {
  const strengthened = bodyHtml.replace(/style="([^"]*)"/g, (_match, styleContent: string) => {
    const decls = styleContent
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => (/^(background-color|background|color)\s*:/i.test(d) && !/!important/i.test(d) ? `${d} !important` : d));
    return `style="${decls.join("; ")}"`;
  });
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    "</head>",
    `<body style="background-color:#ffffff !important;color:#000000;">${strengthened}</body></html>`,
  ].join("");
}
