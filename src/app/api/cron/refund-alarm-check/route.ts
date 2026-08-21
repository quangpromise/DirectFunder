import { NextRequest, NextResponse } from "next/server";
import { checkAndFireRefundYearAlarms } from "@/lib/refund-alarm";

/**
 * KHÔNG nằm trong vercel.json (xem comment ở cron/ringcentral-renew) — việc quét lịch nhắc
 * TTS & WIT thật sự chạy tự động piggyback trên cron đó mỗi ngày. Route này chỉ để test tay
 * qua curl (cùng xác thực CRON_SECRET) khi cần kiểm tra riêng logic quét mà không đụng tới
 * RingCentral.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await checkAndFireRefundYearAlarms();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron refund-alarm-check]", err);
    return NextResponse.json({ ok: false, error: "Quét lịch nhắc TTS & WIT thất bại." }, { status: 502 });
  }
}
