import { NextRequest, NextResponse } from "next/server";
import { renewRingCentralSubscriptionAndSave, isRingCentralConfigured, RingCentralApiError } from "@/lib/ringcentral";

/**
 * Vercel Cron (xem vercel.json, chạy mỗi ngày) — tự gia hạn subscription webhook nhận SMS
 * đến trước khi hết hạn (~7 ngày kể từ lần tạo/gia hạn gần nhất). Gọi mỗi ngày nên KHÔNG
 * bao giờ tới gần ngưỡng 7 ngày, an toàn nếu 1-2 lần cron bị lỡ.
 *
 * Xác thực bằng CRON_SECRET (Vercel tự đính kèm header `Authorization: Bearer $CRON_SECRET`
 * cho request cron thật — xem https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)
 * — KHÔNG dùng session/requireUser() vì Vercel Cron không đăng nhập. Thiếu CRON_SECRET hoặc
 * header không khớp -> 401, chặn ai đó gọi endpoint này để spam gia hạn/reset subscription.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isRingCentralConfigured()) {
    return NextResponse.json({ ok: true, skipped: "not_configured" });
  }

  const webhookUrl = new URL("/api/ringcentral/webhook", request.url).toString();
  try {
    const result = await renewRingCentralSubscriptionAndSave(webhookUrl);
    return NextResponse.json({ ok: true, subscriptionId: result.id, subscriptionExpiresAt: result.expiresAt });
  } catch (err) {
    const message = err instanceof RingCentralApiError ? err.message : "Gia hạn subscription thất bại.";
    console.error("[cron ringcentral-renew]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
