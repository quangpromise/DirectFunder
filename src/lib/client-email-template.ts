/**
 * Default cho các field Admin cấu hình được trong ClientEmailTemplate (AppConfig.
 * clientEmailTemplate, xem types.ts) — dùng khi Admin chưa từng lưu qua dialog cài đặt ở
 * trang Phân quyền. Subject/Body là template tự do RIÊNG theo ngôn ngữ (VI/EN), render qua
 * renderTemplate() (email-template-render.ts) với các token liệt kê ở
 * REFUND_EMAIL_TEMPLATE_VAR_KEYS bên dưới — xem src/lib/refund-notification-email.ts cho
 * cách tính giá trị từng token.
 */

export const REFUND_EMAIL_TEMPLATE_VAR_KEYS = [
  "yearsAbbrev",
  "yearsFull",
  "clientName",
  "phone",
  "bankLine",
  "breakdown",
  "supportPhone",
  "senderName",
  "senderEmail",
] as const;

export const DEFAULT_REFUND_EMAIL_SUBJECT_VI = "[{yearsAbbrev} TAX REFUND] {clientName} - {phone}";
export const DEFAULT_REFUND_EMAIL_SUBJECT_EN = "[{yearsAbbrev} TAX REFUND] {clientName} - {phone}";

export const DEFAULT_REFUND_EMAIL_BODY_VI = [
  "<p>Chào anh/chị,</p>",
  "<p>Em là {senderName}, nhân viên bộ phận Xử lý hồ sơ của Công ty Direct Funder.</p>",
  "<p>Em đã hoàn thành hồ sơ xin hoàn thuế năm {yearsFull} cho anh/chị và submit lên IRS.</p>",
  "<p>Tiền refund sẽ được deposit thẳng vào bank account: [{bankLine}].</p>",
  "<p>Anh/chị vui lòng để ý giao dịch bank account này trong vòng 8-12 tuần tới nhé.</p>",
  "<p>Số tiền bên em xin hoàn thuế cho anh/chị là</p>",
  "{breakdown}",
  '<p style="margin-top:14px;">(Đây là số ước tính, IRS có thể điều chỉnh cao hoặc thấp hơn khi họ duyệt hồ sơ)</p>',
  "<p>Nếu anh/chị nhận được thư của IRS trong thời gian tới, nhờ anh/chị chụp lại đủ trang và gởi cho bên em liền để bên em kịp xử lý khi có vấn đề vì IRS chỉ cho thời hạn 30 ngày tính từ ngày IRS gửi thư.</p>",
  "<p>Xin anh/chị lưu ý:</p>",
  "<p>+ Không nộp thêm bất cứ hồ sơ điều chỉnh thuế năm {yearsFull} lên IRS trong thời gian đợi kết quả của bên em để tránh kéo dài thêm thời gian xử lý hồ sơ của IRS.</p>",
  "<p>+ Nếu anh/chị còn nợ Chính Phủ, xin vui lòng thanh toán hết các khoản nợ (nợ thuế, student loan, ...). Nếu vẫn còn nợ Chính Phủ tại ngày duyệt hồ sơ, IRS sẽ tự động dùng tiền hoàn thuế để cấn trừ vào khoản nợ và anh/chị sẽ nhận tiền ít hơn/ hoặc không nhận được số tiền mà bên em xin cho anh/chị.</p>",
  "<p>Nếu anh/chị cần hỗ trợ, xin liên hệ team Customer Service theo số {supportPhone}.</p>",
  "<p>Cảm ơn anh/chị đã tin tưởng và lựa chọn dịch vụ của Direct Funder</p>",
].join("");

export const DEFAULT_REFUND_EMAIL_BODY_EN = [
  "<p>Hello,</p>",
  "<p>My name is {senderName}, a staff member of the File Processing Department at Direct Funder.</p>",
  "<p>I have completed your {yearsFull} tax refund application and submitted it to the IRS.</p>",
  "<p>The refund will be deposited directly into the following bank account: [{bankLine}].</p>",
  "<p>Please check this bank account for transactions within the next 8-12 weeks.</p>",
  "<p>The amount we are requesting for your refund is:</p>",
  "{breakdown}",
  '<p style="margin-top:14px;">(This is an estimate; the IRS may adjust it higher or lower as they review the application.)</p>',
  "<p>If you receive a letter from the IRS in the near future, please take a picture of all pages and send it to us immediately so we can process it promptly if any issues arise, as the IRS only gives a 30-day period from the date the letter is sent.</p>",
  "<p>Please note:</p>",
  "<p>+ Do not submit any additional tax adjustment filings for {yearsFull} to the IRS while awaiting our results to avoid further delays in IRS processing.</p>",
  "<p>+ If you have outstanding debts to the Government, please pay them off completely (tax debt, student loan, etc.). If you still owe money to the Government on the filing approval date, the IRS will automatically use your tax refund to offset the debt, and you will receive less/or no money than what we requested for you.</p>",
  "<p>If you need assistance, please contact our Customer Service team at {supportPhone}.</p>",
  "<p>Thank you for your trust and for choosing Direct Funder's services.</p>",
].join("");

/** 3 nhãn trong khối {breakdown} — Admin tự sửa qua dialog (hỗ trợ token {year}, render
 * riêng cho từng năm). Số tiền đi kèm luôn tính động ở refund-notification-email.ts, không
 * đi qua các default/nhãn này. */
export const DEFAULT_BREAKDOWN_TAX_CREDIT_LABEL = "{year} tax credit";
export const DEFAULT_BREAKDOWN_TAX_INT_LABEL = "Additional tax on 1099-INT";
export const DEFAULT_BREAKDOWN_ESTIMATED_LABEL = "Estimated refund amount";

export const DEFAULT_SIGNATURE_JOB_TITLE = "Processing Executive";
export const DEFAULT_SIGNATURE_PHONE = "480-660-5741";
export const DEFAULT_SIGNATURE_ADDRESS = "10429 South 51 St, Suite 201, Phoenix, AZ 85044";
export const DEFAULT_SUPPORT_PHONE = "480-863-5845";
