import * as cheerio from "cheerio";
import { prisma } from "@/lib/prisma";

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
 *
 * **Cache cookie 2 tầng (thêm 2026-08-28)** — tầng 1 (biến module-scope `cachedCookie`) chỉ có
 * tác dụng nếu CÙNG 1 instance serverless xử lý các request liên tiếp, nhưng mỗi route.ts trên
 * Vercel là 1 Serverless Function RIÊNG (module state tách biệt) — bấm nút "Check log" (route
 * check-latest-tts, tự đăng nhập xong) rồi mở chat so sánh WIT/TTS (route compare-tts-wit-chat)
 * vẫn phải đăng nhập lại dù vừa đăng nhập vài giây trước, vì 2 route không chia sẻ bộ nhớ. Tầng
 * 2 (cột `AppConfig.agentc3SessionCookie`/`agentc3SessionCookieAt`, đọc/ghi qua Postgres) giải
 * quyết đúng vấn đề này — MỌI route đọc lại được cookie route khác vừa lưu, chỉ thật sự đăng
 * nhập khi cả 2 tầng đều trống/hết hạn. 1 lượt đọc/ghi DB (~vài chục ms) rẻ hơn nhiều so với 1
 * lượt POST đăng nhập CRM thật (~1-2s).
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
  await saveDbCookie(cookie);
  return cookie;
}

/** Đọc cookie đã lưu ở tầng DB (route KHÁC vừa đăng nhập, hoặc chính route này ở 1 lượt gọi
 * nguội trước đó) — best-effort, lỗi DB (mất kết nối, migration chưa chạy...) không nên chặn
 * hẳn tính năng, cứ coi như không có gì trong cache rồi tự đăng nhập lại như hành vi cũ. */
async function loadDbCookie(): Promise<{ cookie: string; at: number } | null> {
  try {
    const config = await prisma.appConfig.findUnique({
      where: { id: "singleton" },
      select: { agentc3SessionCookie: true, agentc3SessionCookieAt: true },
    });
    if (!config?.agentc3SessionCookie || !config.agentc3SessionCookieAt) return null;
    return { cookie: config.agentc3SessionCookie, at: config.agentc3SessionCookieAt.getTime() };
  } catch {
    return null;
  }
}

/** Lưu cookie vừa đăng nhập xuống DB cho route khác dùng lại — best-effort (không throw), 1
 * request đăng nhập vẫn coi là thành công dù bước lưu DB lỗi. */
async function saveDbCookie(cookie: string): Promise<void> {
  try {
    await prisma.appConfig.update({
      where: { id: "singleton" },
      data: { agentc3SessionCookie: cookie, agentc3SessionCookieAt: new Date() },
    });
  } catch {
    // best-effort
  }
}

/** Gộp các lượt gọi đang chạy đồng thời thành 1 — lỗi thật đo được (2026-08-28): route so sánh
 * WIT/TTS tải TTS + tối đa 2 WIT SONG SONG (`Promise.all`), lúc cache cookie còn trống (request
 * đầu phiên) cả 3 lượt gọi `getSessionCookie()` gần như cùng lúc đều thấy cache trống nên tự
 * đăng nhập RIÊNG (xác nhận qua log: 3 lượt `login()` cách nhau <50ms) — tốn 3 round-trip đăng
 * nhập tới CRM thay vì 1, cộng dồn tải lên server ngoài không cần thiết. Biến này giữ lại promise
 * ĐANG chạy (đọc DB rồi tự đăng nhập nếu cần) — lượt gọi thứ 2/3 tới trong lúc lượt đầu chưa
 * xong sẽ `await` chung đúng promise đó thay vì tự gọi lại. */
let inFlightLogin: Promise<string> | null = null;

async function resolveSessionCookie(): Promise<string> {
  const fromDb = await loadDbCookie();
  if (fromDb && Date.now() - fromDb.at < SESSION_TTL_MS) {
    cachedCookie = fromDb.cookie;
    cachedCookieAt = fromDb.at;
    return fromDb.cookie;
  }
  return login();
}

async function getSessionCookie(): Promise<string> {
  if (cachedCookie && Date.now() - cachedCookieAt < SESSION_TTL_MS) return cachedCookie;
  if (!inFlightLogin) {
    inFlightLogin = resolveSessionCookie().finally(() => {
      inFlightLogin = null;
    });
  }
  return inFlightLogin;
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

/** Tải bytes 1 file bất kỳ trên CRM (dùng cho link tải TTS/WIT/1040/Other lấy được từ
 * `fetchTtsWitDatesByYear()`, xem tính năng "So sánh WIT vs TTS" —
 * `.claude/skills/crm-tts-wit-compare/SKILL.md`) qua ĐÚNG session cookie đã đăng nhập — khác
 * `fetchWithSession()` (nhận PATH tương đối trên chính CRM), hàm này nhận URL TUYỆT ĐỐI vì
 * link tải file (`download_s3?key=...` hoặc `/uploads/pdfs/...`) là URL đầy đủ CRM trả về sẵn.
 * BẮT BUỘC `url` phải thuộc domain CRM (`BASE_URL`) — chặn SSRF vì URL này do CLIENT gửi lên
 * lại (dù trong luồng UI bình thường client chỉ gửi lại đúng URL đã nhận từ server, request
 * API vẫn có thể bị gọi trực tiếp với URL tuỳ ý). */
export async function fetchAgentC3FileBytes(url: string): Promise<Buffer> {
  if (!url.startsWith(`${BASE_URL}/`)) {
    throw new AgentC3NotFoundError("URL file không thuộc domain CRM agentc3 — từ chối tải");
  }
  const cookie = await getSessionCookie();
  const res = await fetch(url, {
    headers: { Cookie: cookie, "User-Agent": BROWSER_USER_AGENT, Referer: `${BASE_URL}/` },
  });
  if (!res.ok) {
    throw new AgentC3NotFoundError(`CRM trả lỗi ${res.status} khi tải file`);
  }
  return Buffer.from(await res.arrayBuffer());
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

export type CrmDocYear = "2023" | "2024" | "2025";
const TARGET_YEARS: CrmDocYear[] = ["2023", "2024", "2025"];

export interface CrmTtsWitDoc {
  timestamp: string;
  /** Link tải/xem trực tiếp file PDF trên CRM (href gốc của thẻ <a> trong dòng lịch sử upload). */
  url: string;
  /** Tên khách hàng đọc TRỰC TIẾP từ tên file trên CRM (qua `extractPersonNameFromDocUrl`,
   * thêm 2026-08-25) — phân biệt đúng Taxpayer/Spouse khi hồ sơ có nhiều người, mỗi người có
   * file lên cùng ngày (vd 2 WIT cùng ngày, 1 của "Le, Hannie Ngoc" 1 của "Nguyen, Pyon Ngoc").
   * null nếu CRM dùng định dạng tên file cũ không đọc được — phía hiển thị tự fallback về tên
   * khách hàng của hồ sơ trong Direct Funder. */
  personName: string | null;
}

/** Regex phần đuôi CHUNG cho cả 2 biến thể tên file CRM (xem `extractPersonNameFromFileName`) —
 * "{tên} {số} {MM-DD-YYYY} {HHMM}.{ext}", vd " CHAU T PHAM 0035 11-10-2025 0132.pdf" ->
 * capture group 1 = "CHAU T PHAM". */
const FILE_NAME_TRAILING_META = /^\s*(.+?)\s+\d{2,6}\s+\d{2}-\d{2}-\d{4}\s+\d{3,4}\.\w+$/;

/** Đọc tên khách hàng từ chính TÊN FILE HIỂN THỊ trên CRM (text của thẻ `<a>`, KHÔNG phải
 * `href` — thêm 2026-08-27, sửa lỗi thật gặp trên production) — đã khảo sát thật 2 biến thể:
 * - **Có dấu phẩy tách Họ/Tên** (≥4 phần khi `split(",")`): "{năm},{LOẠI},{Họ}, {Tên đệm} {số}
 *   {MM-DD-YYYY} {HHMM}.{ext}" (vd "2023,W&I,Nguyen, Pyon Ngoc 9190 08-12-2026 0104.pdf" ->
 *   "Nguyen, Pyon Ngoc").
 * - **KHÔNG có dấu phẩy tách Họ/Tên** (đúng 3 phần, thêm 2026-08-27 — lỗi thật gặp trên
 *   production, hồ sơ `BY306702`): "{năm},{LOẠI},{Tên đầy đủ, không phẩy} {số} {MM-DD-YYYY}
 *   {HHMM}.{ext}" (vd "2023,RA,CHAU T PHAM 0035 11-10-2025 0132.pdf" -> "CHAU T PHAM") — giữ
 *   NGUYÊN cụm tên, không cố đoán thứ tự Họ/Tên vì không có tín hiệu nào để tách.
 * Trả `null` nếu không khớp CẢ 2 biến thể — CRM có 1 số ít file cũ dùng kiểu đặt tên khác
 * (viết-liền-dấu-gạch, không có timestamp cùng dạng), không cố đoán, để phía hiển thị tự
 * fallback.
 *
 * **Lỗi thật đã gặp trên production trước khi đổi từ `href` sang text hiển thị**: 1 số file
 * (nhất là file đã qua "processing" — thư mục `/uploads/pdfs/processing/...`, khác file tải
 * trực tiếp qua `download_s3?key=...`) có `href` là tên đã SLUGIFY (viết thường, dấu cách/dấu
 * phẩy đổi thành gạch ngang, thêm hậu tố epoch + mã khách hàng, vd
 * "2023,ra,to,-vivian-9406-08-21-2026-2231-1787400627-BY4849-Person1.pdf") — không còn khớp
 * định dạng gốc nên hàm này luôn trả `null` cho các file đó (mất tên/subtype trong dropdown).
 * TEXT HIỂN THỊ của thẻ `<a>` (`linkEl.text()`) luôn giữ NGUYÊN tên gốc có dấu cách/dấu phẩy
 * (vd "2023,RA,TO, VIVIAN 9406 08-21-2026 2231.pdf") bất kể `href` đã bị biến đổi thế nào — dùng
 * nguồn này đáng tin cậy hơn hẳn. */
function extractPersonNameFromFileName(fileName: string): string | null {
  const parts = fileName.split(",");
  if (parts.length < 3) return null;
  if (parts.length >= 4) {
    const lastName = parts[2].trim();
    if (!lastName) return null;
    const rest = parts.slice(3).join(",");
    const m = FILE_NAME_TRAILING_META.exec(rest);
    if (!m) return null;
    const firstMiddle = m[1].trim();
    return firstMiddle ? `${lastName}, ${firstMiddle}` : lastName;
  }
  // Đúng 3 phần — không có dấu phẩy tách tên, giữ nguyên cụm tên trong parts[2].
  const m = FILE_NAME_TRAILING_META.exec(parts[2]);
  if (!m) return null;
  const name = m[1].trim();
  return name || null;
}

/** Đọc loại tài liệu WIT (token thứ 2 trong TÊN FILE HIỂN THỊ, vd "W&I" = Wage & Income
 * Transcript gốc, "W&IS" = bản Summary — CRM lưu 2 loại khác nhau CÙNG dưới 1 mục "{năm} WI
 * Transcript", thêm 2026-08-25) — dùng để hiện đúng tên loại tài liệu trong nhãn lựa chọn thay
 * vì gộp chung "WIT" chung chung. Chỉ cần đúng ≥2 phần khi `split(",")` (năm + loại) — KHÔNG
 * phụ thuộc file có phần tên dạng nào (đã sửa 2026-08-27, trước đó đòi ≥4 phần nên bỏ sót cả
 * subtype của biến thể tên file không dấu phẩy, xem `extractPersonNameFromFileName`). Cùng
 * nguồn dữ liệu (text hiển thị, không phải `href`) — trả `null` nếu không khớp. */
function extractDocSubTypeFromFileName(fileName: string): string | null {
  const parts = fileName.split(",");
  if (parts.length < 2) return null;
  const subType = parts[1].trim();
  return subType || null;
}

/** Bỏ đuôi mở rộng (".pdf", ".html"...) khỏi tên file hiển thị — dùng cho nhãn của link "1040
 * Tax Return" (xem bên dưới). */
function stripFileExtension(name: string): string {
  return name.replace(/\.[a-zA-Z0-9]{1,5}$/, "").trim();
}

/** Với mỗi năm/loại tài liệu: tìm NGÀY (phần "YYYY-MM-DD" của timestamp) lớn nhất, giữ lại
 * MỌI file upload đúng ngày đó (không chỉ file có giờ:phút lớn nhất — nhiều file có thể lên
 * cùng ngày, vd 1 người upload nhiều trang/phần cùng lúc, hoặc Taxpayer+Spouse cùng ngày), sắp
 * xếp mới nhất trước. Dùng chung cho TTS/WIT lẫn "1040 Tax Return". */
function latestDayOnly(docs: CrmTtsWitDoc[]): CrmTtsWitDoc[] {
  if (docs.length === 0) return [];
  const latestDate = docs.reduce((max, d) => (d.timestamp.slice(0, 10) > max ? d.timestamp.slice(0, 10) : max), "");
  return docs
    .filter((d) => d.timestamp.slice(0, 10) === latestDate)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
}

export interface CrmTtsWitDates {
  tts: Record<CrmDocYear, CrmTtsWitDoc[]>;
  wit: Record<CrmDocYear, CrmTtsWitDoc[]>;
  /** Bảng "1040 Tax Return" mới (thêm 2026-08-25) — mọi file "{năm} 1040 Tax return" upload
   * vào đúng ngày mới nhất, năm 2023-2025 (bỏ 2022 theo yêu cầu). */
  taxReturns: Record<CrmDocYear, CrmTtsWitDoc[]>;
  /** Field "Other" (thêm 2026-08-25) — CHỈ 1 link MỚI NHẤT (không phải mọi link cùng ngày như
   * 3 bảng trên, đúng yêu cầu "lấy link mới nhất của nó kèm tên") — mục "Other" trên CRM không
   * theo năm, không có cấu trúc tên file cố định (thường là ảnh chụp màn hình/tin nhắn tự do,
   * đã khảo sát thật). `null` nếu hồ sơ chưa có file "Other" nào. */
  other: CrmTtsWitDoc | null;
}

/** Đọc tab Documentation của khách hàng 1 LẦN, trả về mọi file TTS/WIT VÀ "1040 Tax Return"
 * upload vào ĐÚNG NGÀY gần nhất (không chỉ 1 file mới nhất — nhiều file có thể lên cùng ngày,
 * vd 1 người upload nhiều trang/phần cùng lúc, thêm 2026-08-25 sau yêu cầu "lấy tất cả link
 * mới nhất được up cùng ngày") cho từng năm 2023/2024/2025, cộng field "Other" (không theo
 * năm, chỉ lấy 1 link MỚI NHẤT — thêm 2026-08-25) — dùng cho nút "TTS & WIT" ở cột "Check CRM"
 * (xem POST /api/agentc3-import/check-latest-tts), hiện thẳng lên popup kết quả mỗi lần bấm
 * (KHÔNG so sánh/lưu mốc, không tạo Notification — đơn giản hoá 2026-08-23 sau phản hồi thực
 * tế; thêm link 2026-08-24; thêm bảng "1040 Tax Return"/"Other" 2026-08-25). Đã khảo sát
 * thật cấu trúc trang: mỗi loại tài liệu là 1 dòng "header" (vd "Pitbulltax 2024 TTS", "2023 WI
 * Transcript" — tên WIT thật trên CRM là "{năm} WI Transcript", KHÔNG phải "Wage & Income
 * Transcript" như tưởng ban đầu, dò được qua toàn bộ danh mục title_ind 1-103; "2023 1040 Tax
 * return" cho bảng mới), theo sau là 0..N dòng "lịch sử upload" (cột đầu là số thứ tự thuần,
 * kèm timestamp thật "YYYY-MM-DD HH:MM:SS" ở cột thứ 3) cho tới khi gặp dòng header kế tiếp.
 * KHÁC TTS/WIT: link "1040 Tax Return" KHÔNG theo 1 định dạng tên file cố định nào (đã khảo sát
 * thật — có khi chỉ "2022.pdf", có khi "Tax 2023 Jose E Sanchez- Ngoc Anh T Nguyen.pdf") nên
 * KHÔNG cố regex-parse tên người như TTS/WIT — lấy nguyên TEXT hiển thị của link trên CRM (tên
 * file gốc lúc upload, đã tự mang đủ thông tin phân biệt trong đa số trường hợp thực tế, bỏ
 * đuôi mở rộng) làm nhãn hiển thị (`personName`). */
export async function fetchTtsWitDatesByYear(customerId: string): Promise<CrmTtsWitDates> {
  const res = await fetchWithSession(`/customer/info/${encodeURIComponent(customerId)}/documentation_edil`);
  if (res.status === 404) throw new AgentC3NotFoundError(`Không tìm thấy khách hàng ${customerId} trên CRM`);
  if (!res.ok) throw new AgentC3NotFoundError(`CRM trả lỗi ${res.status} khi đọc tài liệu ${customerId}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Thu thập TOÀN BỘ dòng lịch sử upload trước (chưa lọc theo ngày) — chỉ sau khi có đủ dữ
  // liệu 1 năm/loại mới xác định được ngày mới nhất thật sự là ngày nào.
  const all: {
    tts: Record<CrmDocYear, CrmTtsWitDoc[]>;
    wit: Record<CrmDocYear, CrmTtsWitDoc[]>;
    taxReturns: Record<CrmDocYear, CrmTtsWitDoc[]>;
    other: CrmTtsWitDoc[];
  } = {
    tts: { "2023": [], "2024": [], "2025": [] },
    wit: { "2023": [], "2024": [], "2025": [] },
    taxReturns: { "2023": [], "2024": [], "2025": [] },
    other: [],
  };
  let currentTitle = "";

  $("table.table-striped tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 5) return;
    const firstText = $(tds[0]).text().trim();
    const isHistoryRow = /^\d+$/.test(firstText);
    if (!isHistoryRow) {
      if (firstText) currentTitle = firstText;
      return;
    }

    // "Other" không theo năm nào — kiểm tra riêng TRƯỚC yêu cầu năm bên dưới (khớp CHÍNH XÁC
    // "Other", không dùng includes để tránh khớp nhầm "Other IRS letters").
    if (currentTitle.trim().toLowerCase() === "other") {
      const timestamp = $(tds[2]).text().trim();
      const linkEl = $(tds[1]).find("a").first();
      const url = linkEl.attr("href");
      if (!timestamp || !url) return;
      const fileName = stripFileExtension(linkEl.text().trim());
      all.other.push({ timestamp, url, personName: fileName || null });
      return;
    }

    const isTts = /TTS/i.test(currentTitle);
    const isWit = /WI Transcript/i.test(currentTitle);
    const isTaxReturn = /1040 Tax return/i.test(currentTitle);
    if (!isTts && !isWit && !isTaxReturn) return;

    const timestamp = $(tds[2]).text().trim();
    const linkEl = $(tds[1]).find("a").first();
    const url = linkEl.attr("href");
    const linkText = linkEl.text().trim();
    if (!timestamp || !url) return;

    // Bình thường năm nằm sẵn trong tiêu đề mục ("Pitbulltax 2024 TTS", "2023 WI Transcript",
    // "2025 1040 Tax return") — NHƯNG mục "1040 Tax returns" (số nhiều, không năm) đã xác nhận
    // thật trên production gộp CHUNG nhiều năm (2022/2023/2024) vào 1 mục duy nhất, năm chỉ còn
    // đọc được qua chính tên file (vd "VIVIAN 2023.pdf") — đây là nguyên nhân thật khiến 1 số
    // năm "biến mất" khỏi bảng "1040 Tax Return" dù CRM có đủ file (bug đã sửa 2026-08-27, xem
    // .claude/skills/crm-tts-wit-compare/SKILL.md).
    const titleYear = /\b(20\d{2})\b/.exec(currentTitle)?.[1];
    const year = titleYear ?? (isTaxReturn ? /\b(20\d{2})\b/.exec(linkText)?.[1] : undefined);
    if (!year || !TARGET_YEARS.includes(year as CrmDocYear)) return;

    if (isTaxReturn) {
      const fileName = stripFileExtension(linkText);
      all.taxReturns[year as CrmDocYear].push({ timestamp, url, personName: fileName || null });
      return;
    }
    if (isWit) {
      // WIT gộp 2 loại tài liệu khác nhau ("W&I"/"W&IS") dưới cùng 1 mục "{năm} WI
      // Transcript" trên CRM — đưa tên loại lên ĐẦU nhãn (vd "W&I - Nguyen, Pyon Ngoc") để
      // phân biệt khi chọn (thêm 2026-08-27 theo yêu cầu "W&I và W&IS sẽ đưa lên đầu tên").
      const person = extractPersonNameFromFileName(linkText);
      const subType = extractDocSubTypeFromFileName(linkText);
      const label = subType ? (person ? `${subType} - ${person}` : subType) : person;
      all.wit[year as CrmDocYear].push({ timestamp, url, personName: label });
      return;
    }
    all.tts[year as CrmDocYear].push({ timestamp, url, personName: extractPersonNameFromFileName(linkText) });
  });

  // "Other" chỉ lấy ĐÚNG 1 link mới nhất (khác 3 bảng trên lấy mọi link cùng ngày).
  const latestOther = all.other.reduce<CrmTtsWitDoc | null>(
    (latest, d) => (!latest || d.timestamp > latest.timestamp ? d : latest),
    null
  );

  return {
    tts: {
      "2023": latestDayOnly(all.tts["2023"]),
      "2024": latestDayOnly(all.tts["2024"]),
      "2025": latestDayOnly(all.tts["2025"]),
    },
    wit: {
      "2023": latestDayOnly(all.wit["2023"]),
      "2024": latestDayOnly(all.wit["2024"]),
      "2025": latestDayOnly(all.wit["2025"]),
    },
    taxReturns: {
      "2023": latestDayOnly(all.taxReturns["2023"]),
      "2024": latestDayOnly(all.taxReturns["2024"]),
      "2025": latestDayOnly(all.taxReturns["2025"]),
    },
    other: latestOther,
  };
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
