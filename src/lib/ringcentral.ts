import crypto from "crypto";

/**
 * Tích hợp RingCentral SMS (nhắn/nhận tin nhắn theo hồ sơ, thêm 2026-08-17) — JWT auth
 * server-to-server, dùng CHUNG 1 số điện thoại công ty (RINGCENTRAL_SMS_FROM_NUMBER) cho
 * mọi user, không phải OAuth2 theo từng user như webmail/Google Sheets OAuth. Access token
 * đổi từ JWT credential (tạo 1 lần trên RingCentral Developer Console, không tự hết hạn —
 * khác access token đổi ra từ nó, chỉ sống ~1h, cache trong bộ nhớ + tự refresh khi gần hết
 * hạn). Thiếu env -> mọi hàm ở đây throw RingCentralNotConfiguredError, nơi gọi tự bắt +
 * no-op/trả lỗi rõ ràng, KHÔNG crash app (cùng pattern google-service-account.ts).
 *
 * Nhận tin nhắn đến: RingCentral subscription webhook chỉ báo "có thay đổi" (newCount tăng),
 * KHÔNG kèm nội dung tin nhắn thật trong payload push — route webhook phải tự gọi lại GET
 * /message-store để lấy tin nhắn mới, xem fetchRecentInboundSms + route.ts.
 */

export class RingCentralNotConfiguredError extends Error {}
export class RingCentralApiError extends Error {}

interface RingCentralEnv {
  clientId: string;
  clientSecret: string;
  jwt: string;
  fromNumber: string;
  serverUrl: string;
}

function requiredEnv(): RingCentralEnv {
  const clientId = process.env.RINGCENTRAL_CLIENT_ID;
  const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET;
  const jwt = process.env.RINGCENTRAL_JWT;
  const fromNumber = process.env.RINGCENTRAL_SMS_FROM_NUMBER;
  const serverUrl = process.env.RINGCENTRAL_SERVER_URL || "https://platform.ringcentral.com";
  if (!clientId || !clientSecret || !jwt || !fromNumber) {
    throw new RingCentralNotConfiguredError(
      "Thiếu RINGCENTRAL_CLIENT_ID/RINGCENTRAL_CLIENT_SECRET/RINGCENTRAL_JWT/RINGCENTRAL_SMS_FROM_NUMBER trong biến môi trường"
    );
  }
  return { clientId, clientSecret, jwt, fromNumber, serverUrl };
}

/** true nếu đã cấu hình đủ env — dùng để UI/API tự tắt tính năng thay vì throw giữa chừng. */
export function isRingCentralConfigured(): boolean {
  return Boolean(
    process.env.RINGCENTRAL_CLIENT_ID &&
      process.env.RINGCENTRAL_CLIENT_SECRET &&
      process.env.RINGCENTRAL_JWT &&
      process.env.RINGCENTRAL_SMS_FROM_NUMBER
  );
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<{ token: string; serverUrl: string }> {
  const { clientId, clientSecret, jwt, serverUrl } = requiredEnv();
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return { token: cachedToken.accessToken, serverUrl };
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${serverUrl}/restapi/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RingCentralApiError(`Xác thực RingCentral thất bại (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return { token: cachedToken.accessToken, serverUrl };
}

/** Gửi 1 SMS từ số công ty (RINGCENTRAL_SMS_FROM_NUMBER) tới `to` (E.164). */
export async function sendRingCentralSms(to: string, text: string): Promise<{ id: string }> {
  const { token, serverUrl } = await getAccessToken();
  const { fromNumber } = requiredEnv();
  const res = await fetch(`${serverUrl}/restapi/v1.0/account/~/extension/~/sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ from: { phoneNumber: fromNumber }, to: [{ phoneNumber: to }], text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RingCentralApiError(`Gửi SMS thất bại (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id: number | string };
  return { id: String(data.id) };
}

interface RingCentralInboundMessage {
  id: string;
  fromNumber: string;
  text: string;
  creationTime: string;
}

/** Gọi GET /message-store lấy tin SMS đến (Inbound) tạo từ `sinceIso` tới giờ — dùng ngay
 * sau khi nhận tín hiệu webhook "có thay đổi" (payload push không kèm nội dung thật). */
export async function fetchRecentInboundSms(sinceIso: string): Promise<RingCentralInboundMessage[]> {
  const { token, serverUrl } = await getAccessToken();
  const url = new URL(`${serverUrl}/restapi/v1.0/account/~/extension/~/message-store`);
  url.searchParams.set("messageType", "SMS");
  url.searchParams.set("direction", "Inbound");
  url.searchParams.set("dateFrom", sinceIso);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RingCentralApiError(`Đọc tin nhắn đến thất bại (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    records?: { id: number | string; from?: { phoneNumber?: string }; subject?: string; creationTime: string }[];
  };
  return (data.records ?? [])
    .filter((r) => r.from?.phoneNumber)
    .map((r) => ({
      id: String(r.id),
      fromNumber: r.from!.phoneNumber!,
      text: r.subject ?? "",
      creationTime: r.creationTime,
    }));
}

/** Tạo mới hoặc gia hạn subscription webhook nhận SMS đến real-time. Subscription
 * RingCentral sống tối đa ~7 ngày (604799s) — `existingId` truyền vào để thử gia hạn trước,
 * chỉ tạo mới nếu gia hạn thất bại (đã hết hạn hẳn/bị xoá). */
export async function createOrRenewRingCentralSubscription(
  webhookUrl: string,
  existingId?: string | null
): Promise<{ id: string; expiresAt: string }> {
  const { token, serverUrl } = await getAccessToken();

  if (existingId) {
    const renewRes = await fetch(`${serverUrl}/restapi/v1.0/subscription/${existingId}/renew`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (renewRes.ok) {
      const data = (await renewRes.json()) as { id: string; expirationTime: string };
      return { id: data.id, expiresAt: data.expirationTime };
    }
  }

  const res = await fetch(`${serverUrl}/restapi/v1.0/subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      eventFilters: ["/restapi/v1.0/account/~/extension/~/message-store"],
      deliveryMode: { transportType: "WebHook", address: webhookUrl },
      expiresIn: 604799,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RingCentralApiError(`Tạo subscription nhận SMS thất bại (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id: string; expirationTime: string };
  return { id: data.id, expiresAt: data.expirationTime };
}

/** Sinh secret ngẫu nhiên — dự phòng nếu sau này cần ký xác minh webhook (RingCentral hiện
 * dùng cơ chế Validation-Token lúc tạo subscription, không cần secret riêng cho mỗi request
 * — giữ hàm này để nhất quán nếu RingCentral đổi cơ chế). */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(24).toString("hex");
}
