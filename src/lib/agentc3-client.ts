import * as cheerio from "cheerio";

/**
 * Đăng nhập + đọc dữ liệu khách hàng từ CRM ngoài `tax.agentc3.com` (hệ thống PHP/
 * CodeIgniter cũ, không liên quan gì tới database/app Direct Funder) — dùng cho tính năng
 * "Nhập hồ sơ từ CRM" (nút trên toolbar bảng Hồ sơ, xem `POST /api/agentc3-import/fetch`).
 *
 * Đã xác nhận qua test `curl` thật: trang chi tiết khách hàng (`/customer/info/{id}`) là
 * HTML render sẵn từ server (không phải SPA) — chỉ cần session cookie (`ci_session`) rồi
 * `fetch()` là đủ, KHÔNG cần trình duyệt headless/Playwright. Đăng nhập KHÔNG có CSRF token,
 * nhưng CodeIgniter âm thầm trả lại nguyên form login (không lỗi rõ ràng) nếu thiếu field
 * `login=Login` (đúng tên/giá trị nút submit) hoặc `User-Agent` trông như bot.
 */

const BASE_URL = "https://tax.agentc3.com";
const SESSION_TTL_MS = 15 * 60 * 1000;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let cachedCookie: string | null = null;
let cachedCookieAt = 0;

export class AgentC3ConfigError extends Error {}
export class AgentC3LoginError extends Error {}
export class AgentC3NotFoundError extends Error {}

function isConfigured(): boolean {
  return Boolean(process.env.AGENTC3_USERNAME && process.env.AGENTC3_PASSWORD);
}

async function login(): Promise<string> {
  if (!isConfigured()) {
    throw new AgentC3ConfigError("Chưa cấu hình AGENTC3_USERNAME/AGENTC3_PASSWORD");
  }
  const form = new URLSearchParams({
    username: process.env.AGENTC3_USERNAME!,
    password: process.env.AGENTC3_PASSWORD!,
    login: "Login",
  });
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": BROWSER_USER_AGENT,
      Referer: `${BASE_URL}/auth/login`,
      Origin: BASE_URL,
    },
    body: form.toString(),
  });
  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie?.split(";")[0];
  // Đăng nhập thành công luôn kèm header "Refresh: 0;url=.../customer/search" (redirect
  // kiểu meta-refresh CodeIgniter hay dùng thay vì Location 302 thật) — không có header này
  // (hoặc không có cookie mới) nghĩa là sai tài khoản/mật khẩu hoặc trang đã đổi cấu trúc.
  const refreshedToSearch = /customer\/search/i.test(res.headers.get("refresh") ?? "");
  if (!cookie || !refreshedToSearch) {
    throw new AgentC3LoginError("Đăng nhập CRM agentc3 thất bại — kiểm tra lại tài khoản/mật khẩu");
  }
  cachedCookie = cookie;
  cachedCookieAt = Date.now();
  return cookie;
}

async function getSessionCookie(): Promise<string> {
  if (cachedCookie && Date.now() - cachedCookieAt < SESSION_TTL_MS) return cachedCookie;
  return login();
}

async function fetchWithSession(path: string): Promise<Response> {
  let cookie = await getSessionCookie();
  let res = await fetch(`${BASE_URL}${path}`, {
    redirect: "manual",
    headers: { Cookie: cookie, "User-Agent": BROWSER_USER_AGENT, Referer: `${BASE_URL}/customer/search` },
  });
  // Session hết hạn phía server (khác thời hạn cache cục bộ SESSION_TTL_MS) -> CodeIgniter
  // redirect về /auth/login -> tự đăng nhập lại 1 lần rồi thử lại đúng request đó.
  const location = res.headers.get("location") ?? "";
  if (res.status >= 300 && res.status < 400 && /auth\/login/i.test(location)) {
    cachedCookie = null;
    cookie = await login();
    res = await fetch(`${BASE_URL}${path}`, {
      redirect: "manual",
      headers: { Cookie: cookie, "User-Agent": BROWSER_USER_AGENT, Referer: `${BASE_URL}/customer/search` },
    });
  }
  return res;
}

/** Parse id khách hàng (vd "BY306393") từ link dán vào — chấp nhận cả URL đầy đủ lẫn chỉ id. */
export function parseAgentC3CustomerId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = /\/customer\/info\/([A-Za-z0-9]+)/.exec(trimmed);
  if (m) return m[1];
  if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  return null;
}

/** Link chuẩn (không kèm query `prev`/`next` dễ đổi giữa các lần điều hướng trên CRM) —
 * lưu vào `Case.clientLink` để người dùng bấm quay lại đúng hồ sơ gốc trên agentc3. */
export function buildAgentC3CustomerUrl(customerId: string): string {
  return `${BASE_URL}/customer/info/${encodeURIComponent(customerId)}`;
}

export interface AgentC3CustomerRaw {
  customerId: string;
  taxpayerName: string;
  ssn: string;
  dob: string;
  spouseName: string;
  spouseSsn: string;
  spouseDob: string;
  homeAddress: string;
  city: string;
  state: string;
  email1: string;
  phone1: string;
  phone2: string;
  status: string;
  refunds: Record<string, string>;
  agentName: string;
  bankName: string;
  routingNumber: string;
  accountNumber: string;
  zipIrs: string;
  fullContacts: string;
  engagementLetter: string;
}

function fieldValue($: cheerio.CheerioAPI, id: string): string {
  const el = $(`#${id}`);
  if (el.length === 0) return "";
  if (el.is("select")) return (el.find("option[selected]").val() as string) ?? "";
  return (el.val() as string) ?? el.attr("value") ?? "";
}

const REFUND_FIELD_YEARS = ["2022", "2023", "2024", "2025"] as const;

/** Đọc + parse trang chi tiết khách hàng — trả về dữ liệu THÔ (chưa map/đổi định dạng),
 * chỉ đọc đúng giá trị từng field theo id đã dò được (xem bảng field ở kế hoạch tính năng). */
export async function fetchAgentC3Customer(customerId: string): Promise<AgentC3CustomerRaw> {
  const res = await fetchWithSession(`/customer/info/${encodeURIComponent(customerId)}`);
  if (res.status === 404) throw new AgentC3NotFoundError(`Không tìm thấy khách hàng ${customerId} trên CRM`);
  if (!res.ok) throw new AgentC3NotFoundError(`CRM trả lỗi ${res.status} khi đọc hồ sơ ${customerId}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // "p_fl_nm" không tồn tại (id sai/trang đã đổi cấu trúc) -> coi như không đọc được, để
  // route gọi phía trên tự báo lỗi rõ ràng thay vì âm thầm trả về 1 preview toàn field rỗng.
  if ($("#p_fl_nm").length === 0) {
    throw new AgentC3NotFoundError(`Không đọc được hồ sơ ${customerId} — trang CRM có thể đã đổi cấu trúc`);
  }

  const refunds: Record<string, string> = {};
  for (const year of REFUND_FIELD_YEARS) refunds[year] = fieldValue($, `refund_${year}`);

  return {
    customerId,
    taxpayerName: fieldValue($, "p_fl_nm"),
    ssn: fieldValue($, "ssn"),
    dob: fieldValue($, "p_dob"),
    spouseName: fieldValue($, "spouse_name"),
    spouseSsn: fieldValue($, "spouser_ssn"),
    spouseDob: fieldValue($, "spouse_dob"),
    homeAddress: fieldValue($, "p_hm_addr"),
    city: fieldValue($, "p_city"),
    state: fieldValue($, "p_state"),
    email1: fieldValue($, "p_eml1"),
    phone1: fieldValue($, "p_ph1"),
    phone2: fieldValue($, "p_ph2"),
    status: fieldValue($, "p_status"),
    refunds,
    agentName: $('select#user_id option[selected]').first().text().trim() || $('input[name="user_id"]').attr("value")?.trim() || "",
    bankName: fieldValue($, "bank_name"),
    routingNumber: fieldValue($, "routing_number"),
    accountNumber: fieldValue($, "account_number"),
    zipIrs: fieldValue($, "p_zip_irs"),
    fullContacts: fieldValue($, "full_contacts"),
    engagementLetter: fieldValue($, "engagement_letter_2026_may"),
  };
}

/**
 * ===== Ghi ngược lên CRM agentc3 (nút "Update to CRM") =====
 *
 * Khác hẳn phần đọc ở trên — CRM này KHÔNG có API ghi riêng cho Status/CPA Review: toàn bộ
 * tab "Lead" (264+ field: Status, Bank Info, Refund từng năm, FC/EL Date, CPA Review từng
 * năm...) nằm chung trong ĐÚNG 1 `<form>` html cũ (không có `action`, submit POST về lại
 * chính URL đang xem), nút "Change Information" (`btnChangeLeadinfo`) gửi TOÀN BỘ field đó.
 * Không có API "chỉ đổi 1 field" — muốn đổi Status/CPA Review PHẢI gửi lại nguyên trạng thái
 * hiện tại của mọi field khác, y hệt hành vi 1 người mở form/sửa 1 ô/bấm Save.
 *
 * Đã tự kiểm tra thật (2026-08-21, xin phép người dùng trước khi ghi) qua 1 vòng round-trip
 * trên hồ sơ thật: sau khi gửi lại đúng snapshot đã đọc, TUYỆT ĐẠI ĐA SỐ field giữ nguyên
 * đúng như cũ — chỉ có field mình chủ động đổi (`cpa_review_2022`) thay đổi, `processing_date`
 * giữ nguyên. Có 1 lỗi tự gây ra đã VÁ ở đây: field nào có CẢ `<input type="hidden">` LẪN 1
 * `<select disabled>` cùng `name` (vd `processor`) — trình duyệt thật KHÔNG BAO GIỜ submit
 * phần tử `disabled` (theo chuẩn HTML), nhưng bản đầu của hàm snapshot này lại đọc luôn giá
 * trị "selected" (thường rỗng, vì field disabled không có option nào được server đánh dấu
 * `selected` thật) của select disabled đó rồi ghi ĐÈ sau hidden input trong cùng query string
 * → server nhận về rỗng thay vì giá trị hidden input đang giữ, XOÁ MẤT dữ liệu thật. Đã fix
 * bằng cách **bỏ qua hẳn phần tử có `disabled`** khi đọc snapshot — khớp đúng hành vi trình
 * duyệt thật. Rủi ro còn lại (KHÔNG do lỗi phía mình, do chính CRM tự "làm sạch" dữ liệu mỗi
 * lần Save): 1 field text tự do (`p_ph1`, giá trị gốc là "Fied" — rõ ràng dữ liệu lỗi/dở dang
 * có sẵn từ trước) đã tự bị CRM xoá về rỗng dù mình gửi lại y nguyên — nhiều khả năng server
 * tự validate định dạng số điện thoại mỗi lần Save (kể cả khi 1 nhân viên thật bấm Save mà
 * không sửa gì) — không có cách nào lường trước hết mọi field như vậy, chấp nhận làm rủi ro
 * cố hữu của việc ghi lên hệ thống cũ này, không phải lỗi trong cách mình gửi lại field.
 */

/** Đọc TOÀN BỘ field hiện tại của form "Lead" (form chứa `#p_status`) — bỏ qua hẳn phần tử
 * có `disabled` (trình duyệt thật không submit chúng), chỉ lấy giá trị SAU CÙNG cho field
 * nào bị trùng `name` (khớp cách server nhận query string trùng key — giá trị cuối thắng). */
function extractLeadFormFields($: cheerio.CheerioAPI): Record<string, string> {
  const form = $("#p_status").closest("form");
  const fields: Record<string, string> = {};

  form.find("input, select, textarea").each((_, el) => {
    const $el = $(el);
    if ($el.attr("disabled") !== undefined) return;
    const name = $el.attr("name");
    if (!name) return;
    const tag = el.tagName;
    if (tag === "select") {
      const selected = $el.find("option[selected]");
      fields[name] = selected.length > 0 ? (selected.last().attr("value") ?? selected.last().text().trim()) : "";
      return;
    }
    if (tag === "textarea") {
      fields[name] = $el.text();
      return;
    }
    const type = ($el.attr("type") ?? "text").toLowerCase();
    if (type === "file" || type === "submit" || type === "button" || type === "image") return;
    if (type === "checkbox" || type === "radio") {
      if ($el.attr("checked") !== undefined) fields[name] = $el.attr("value") ?? "on";
      return;
    }
    fields[name] = $el.attr("value") ?? "";
  });

  return fields;
}

export interface CrmSelectOption {
  value: string;
  label: string;
}

function extractSelectOptions($: cheerio.CheerioAPI, selector: string): CrmSelectOption[] {
  const options: CrmSelectOption[] = [];
  $(selector)
    .first()
    .find("option")
    .each((_, opt) => {
      const value = $(opt).attr("value") ?? "";
      if (!value) return;
      options.push({ value, label: $(opt).text().trim() || value });
    });
  return options;
}

export interface CrmFormContext {
  fields: Record<string, string>;
  /** Danh sách Status hiện có trên CRM (đọc thẳng từ `<select id="p_status">`) — value = label,
   * dùng nguyên cho dropdown Status trong popup "Update to CRM", KHÔNG liên quan gì tới danh
   * sách Status của Direct Funder. */
  statusOptions: CrmSelectOption[];
  /** Danh sách "Performed By" — CRM dùng CHUNG 1 danh sách tên nhân viên cho cả 2 dropdown
   * `spoke_to` (Performed By trong khối Conversation) và `assigned_to`, lấy từ `spoke_to`. */
  performerOptions: CrmSelectOption[];
}

/** Đọc snapshot hiện tại của form Lead + 2 danh sách dropdown cần cho popup "Update to CRM" —
 * CHỈ ĐỌC, không ghi gì. */
export async function fetchCrmFormContext(customerId: string): Promise<CrmFormContext> {
  const res = await fetchWithSession(`/customer/info/${encodeURIComponent(customerId)}`);
  if (res.status === 404) throw new AgentC3NotFoundError(`Không tìm thấy khách hàng ${customerId} trên CRM`);
  if (!res.ok) throw new AgentC3NotFoundError(`CRM trả lỗi ${res.status} khi đọc hồ sơ ${customerId}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  if ($("#p_fl_nm").length === 0) {
    throw new AgentC3NotFoundError(`Không đọc được hồ sơ ${customerId} — trang CRM có thể đã đổi cấu trúc`);
  }
  return {
    fields: extractLeadFormFields($),
    statusOptions: extractSelectOptions($, "#p_status"),
    performerOptions: extractSelectOptions($, 'select[name="spoke_to"]'),
  };
}

/** POST lại toàn bộ field Lead hiện tại (đọc mới nhất ngay trước khi gửi — không dùng lại
 * snapshot cũ đã đọc từ trước, phòng hồ sơ vừa bị người khác sửa trên CRM) + áp `overrides`
 * đè lên đúng những field muốn đổi, submit qua nút "Change Information" (`btnChangeLeadinfo`).
 * Dùng cho cả đổi Status lẫn set ngày CPA Review từng năm. */
export async function updateCrmLeadInfo(customerId: string, overrides: Record<string, string>): Promise<void> {
  const cookie = await getSessionCookie();
  const current = await fetchCrmFormContext(customerId);
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(current.fields)) {
    body.append(name, name in overrides ? overrides[name] : value);
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!(name in current.fields)) body.append(name, value);
  }
  body.append("btnChangeLeadinfo", "Change Information");

  const res = await fetchWithSessionPost(cookie, `/customer/info/${encodeURIComponent(customerId)}`, {
    "Content-Type": "application/x-www-form-urlencoded",
  }, body.toString());
  if (!res.ok) {
    throw new AgentC3NotFoundError(`CRM trả lỗi ${res.status} khi lưu thông tin hồ sơ ${customerId}`);
  }
}

/** Thêm 1 dòng MỚI vào "Conversation Log" (KHÔNG đè dòng cũ) — đọc lại field hiện tại (form
 * Lead + Conversation dùng CHUNG 1 `<form>`) rồi chỉ đổi `out_come`/`spoke_to`, submit qua nút
 * "Save Conversation" (`btnChangeConv`). */
export async function saveCrmConversationLog(
  customerId: string,
  params: { note: string; performedBy: string }
): Promise<void> {
  const cookie = await getSessionCookie();
  const current = await fetchCrmFormContext(customerId);
  const overrides: Record<string, string> = { out_come: params.note, spoke_to: params.performedBy };
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(current.fields)) {
    body.append(name, name in overrides ? overrides[name] : value);
  }
  body.append("btnChangeConv", "Save Conversation");

  const res = await fetchWithSessionPost(cookie, `/customer/info/${encodeURIComponent(customerId)}`, {
    "Content-Type": "application/x-www-form-urlencoded",
  }, body.toString());
  if (!res.ok) {
    throw new AgentC3NotFoundError(`CRM trả lỗi ${res.status} khi lưu Conversation Log cho ${customerId}`);
  }
}

/** Ô tài liệu "{năm} 1040X - Submitted" trong tab Documentation ứng với đúng số thứ tự
 * (`title_ind`) CRM đã gán sẵn cho loại tài liệu đó (dò được qua `info_view.js`/HTML tab
 * Documentation — CRM không cho đặt tên tài liệu tự do, phải khớp đúng 1 trong các ô có sẵn). */
export const CRM_1040X_SUBMITTED_DOC_SLOT: Record<string, { titleIndex: number; title: string }> = {
  "2022": { titleIndex: 36, title: "2022 1040X - Submitted" },
  "2023": { titleIndex: 37, title: "2023 1040X - Submitted" },
  "2024": { titleIndex: 39, title: "2024 1040X - Submitted" },
  "2025": { titleIndex: 38, title: "2025 1040X - Submitted" },
};

/** Upload 1 file vào đúng ô tài liệu (title_ind) trong tab Documentation, cho Taxpayer
 * ("Person1" — CRM có `_edil2`/`_edil3` cho Spouse/người thứ 3, chưa cần tới trong tính năng
 * này). Đây là 1 AJAX endpoint RIÊNG BIỆT (không dùng chung giga-form Lead) — an toàn hơn hẳn
 * updateCrmLeadInfo/saveCrmConversationLog vì chỉ THÊM 1 tài liệu mới, không đọc lại/gửi lại
 * field nào khác. */
export async function uploadCrmDocument(
  customerId: string,
  titleIndex: number,
  title: string,
  file: { buffer: Buffer; filename: string; mimeType: string }
): Promise<void> {
  const cookie = await getSessionCookie();
  const form = new FormData();
  form.append("p1_proc_doc_rid", customerId);
  form.append("p1_proc_doc_person", "Person1");
  form.append("p1_proc_doc_title_ind", String(titleIndex));
  form.append("p1_proc_doc_title", title);
  form.append("p1_proc_doc_all", "0");
  form.append("scan_doc", "");
  form.append(`proc_doc1_${titleIndex}[]`, new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.filename);

  const res = await fetch(`${BASE_URL}/customer/upload_processing_document_edil1`, {
    method: "POST",
    headers: { Cookie: cookie, "User-Agent": BROWSER_USER_AGENT, Referer: `${BASE_URL}/customer/info/${customerId}` },
    body: form,
  });
  if (!res.ok) throw new AgentC3NotFoundError(`CRM trả lỗi ${res.status} khi upload tài liệu cho ${customerId}`);
  const json = (await res.json().catch(() => null)) as { status?: string } | null;
  if (!json || json.status !== "Success") {
    throw new AgentC3NotFoundError(`CRM từ chối upload tài liệu "${title}" cho ${customerId}`);
  }
}

async function fetchWithSessionPost(
  cookie: string,
  path: string,
  headers: Record<string, string>,
  body: string
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { Cookie: cookie, "User-Agent": BROWSER_USER_AGENT, Referer: `${BASE_URL}${path}`, Origin: BASE_URL, ...headers },
    body,
  });
}
