/**
 * Microsoft Graph API qua OAuth2 THEO TỪNG USER (không phải 1 mailbox chung như Gmail
 * App Password ở mailer.ts) — mỗi Processor/Manager tự đăng nhập mailbox Outlook
 * @directfunder.com của mình 1 lần, refresh_token lưu riêng ở User.microsoftRefreshToken.
 * Chỉ lưu refresh_token; access_token luôn xin mới qua refresh_token ngay trước mỗi lần
 * gọi API, cùng cơ chế với google-sheets.ts. Dùng `fetch` thuần (không cài @azure/msal-node
 * hay Graph SDK) — chỉ cần 3 lệnh REST, đối xứng với cách google-sheets.ts tự gọi tay.
 *
 * Cần tạo App registration (Single tenant) trên Azure Portal, cấp quyền Delegated
 * Mail.Send, đăng ký đủ redirect URI dev + production — xem .env.example.
 */

const SCOPES = ["openid", "profile", "offline_access", "https://graph.microsoft.com/Mail.Send"];

/** Refresh_token bị thu hồi/hết hạn (invalid_grant) hoặc access_token hết hạn giữa chừng
 * (401 từ /sendMail) — API route bắt riêng lỗi này để trả mã cho client biết cần mở lại
 * popup kết nối Outlook, khác với lỗi gửi thất bại thông thường. */
export class MicrosoftAuthExpiredError extends Error {}

function getTenantId(): string {
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  if (!tenantId) throw new Error("Thiếu MICROSOFT_TENANT_ID trong biến môi trường");
  return tenantId;
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Thiếu MICROSOFT_OAUTH_CLIENT_ID/MICROSOFT_OAUTH_CLIENT_SECRET trong biến môi trường");
  }
  return { clientId, clientSecret };
}

function tokenEndpoint(): string {
  return `https://login.microsoftonline.com/${getTenantId()}/oauth2/v2.0/token`;
}

export function buildMicrosoftAuthUrl(state: string, redirectUri: string): string {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES.join(" "),
    // Luôn hiện màn hình chọn tài khoản, kể cả khi trình duyệt đã đăng nhập sẵn 1
    // tài khoản Microsoft — cho phép đổi sang mailbox @directfunder.com khác mỗi lần
    // kết nối lại, giống hành vi "select_account" đã dùng cho luồng Google.
    prompt: "select_account",
    state,
  });
  return `https://login.microsoftonline.com/${getTenantId()}/oauth2/v2.0/authorize?${params.toString()}`;
}

interface TokenErrorBody {
  error?: string;
  error_description?: string;
}

function isInvalidGrantError(body: TokenErrorBody | undefined): boolean {
  return body?.error === "invalid_grant";
}

export async function exchangeCodeForRefreshToken(code: string, redirectUri: string): Promise<string> {
  const { clientId, clientSecret } = getClientCredentials();
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      scope: SCOPES.join(" "),
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.refresh_token) {
    throw new Error(
      "Microsoft không trả về refresh_token — thử kết nối lại và đảm bảo đồng ý đầy đủ quyền truy cập được yêu cầu."
    );
  }
  return data.refresh_token as string;
}

async function getAccessTokenFromRefreshToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getClientCredentials();
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: SCOPES.join(" "),
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    if (isInvalidGrantError(data as TokenErrorBody)) {
      throw new MicrosoftAuthExpiredError("Kết nối Outlook đã hết hạn hoặc bị thu hồi — cần kết nối lại.");
    }
    throw new Error((data as TokenErrorBody).error_description || "Không lấy được access token từ Microsoft.");
  }
  return data.access_token as string;
}

interface GraphErrorBody {
  error?: { code?: string; message?: string };
}

function mapGraphError(body: GraphErrorBody | undefined): string {
  const code = body?.error?.code;
  if (code === "ErrorAccessDenied" || code === "Authorization_RequestDenied") {
    return "Tài khoản Outlook chưa được cấp quyền gửi mail — liên hệ Admin.";
  }
  if (code === "ErrorInvalidRecipients") {
    return "Địa chỉ email khách hàng không hợp lệ.";
  }
  return "Gửi email thất bại, thử lại sau.";
}

export interface SendClientEmailInput {
  refreshToken: string;
  /** Email khách hàng — người nhận duy nhất, không có Cc theo yêu cầu tính năng. */
  to: string;
  subject: string;
  html: string;
}

export async function sendClientEmail(input: SendClientEmailInput): Promise<void> {
  const accessToken = await getAccessTokenFromRefreshToken(input.refreshToken);
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: "HTML", content: input.html },
        toRecipients: [{ emailAddress: { address: input.to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (res.status === 401) {
    throw new MicrosoftAuthExpiredError("Kết nối Outlook đã hết hạn hoặc bị thu hồi — cần kết nối lại.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as GraphErrorBody | undefined;
    throw new Error(mapGraphError(body));
  }
}
