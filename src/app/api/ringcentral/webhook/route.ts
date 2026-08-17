import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchRecentInboundSms, isRingCentralConfigured } from "@/lib/ringcentral";
import { broadcastCaseChanged } from "@/lib/pusher-server";

/**
 * Webhook nhận SMS đến real-time (RingCentral subscription, xem POST /api/config/ringcentral
 * cho việc tạo/gia hạn subscription trỏ vào route này). KHÔNG cần auth/session — RingCentral
 * gọi thẳng route này, không phải user đăng nhập trong app.
 *
 * 2 loại request:
 * 1. Validation handshake — RingCentral gửi NGAY lúc tạo subscription, kèm header
 *    "Validation-Token", yêu cầu route echo lại ĐÚNG giá trị đó trong response header trong
 *    vài giây, không thì subscription creation thất bại. Không có body cần xử lý.
 * 2. Event notification thật — body chỉ báo "có thay đổi" (KHÔNG kèm nội dung SMS thật, xem
 *    ghi chú trong ringcentral.ts) — route tự gọi lại GET /message-store lấy tin nhắn mới,
 *    lưu (bỏ qua nếu đã có sẵn theo ringcentralMessageId, chống xử lý trùng nếu RingCentral
 *    gửi lại event), rồi bắn tín hiệu case:changed (dùng lại kênh Pusher có sẵn, KHÔNG tạo
 *    kênh mới) để bảng Hồ sơ đang mở ở mọi trình duyệt tự refetch và thấy icon đỏ ngay.
 */
export async function POST(request: Request) {
  const validationToken = request.headers.get("Validation-Token");
  if (validationToken) {
    return new NextResponse(null, { status: 200, headers: { "Validation-Token": validationToken } });
  }

  if (!isRingCentralConfigured()) {
    // Subscription lẽ ra không thể tồn tại nếu chưa cấu hình, nhưng vẫn trả 200 (không phải
    // lỗi của RingCentral) để tránh RingCentral retry vô ích.
    return NextResponse.json({ ok: true, skipped: "not_configured" });
  }

  try {
    // Cửa sổ 15 phút — đủ rộng để không bỏ sót tin nhắn nếu webhook tới trễ vài phút, unique
    // constraint trên ringcentralMessageId tự chống chèn trùng nếu quét lại cùng 1 tin.
    const sinceIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const inbound = await fetchRecentInboundSms(sinceIso);
    let createdCount = 0;
    for (const msg of inbound) {
      try {
        await prisma.smsMessage.create({
          data: {
            direction: "in",
            counterpartNumber: msg.fromNumber,
            text: msg.text,
            ringcentralMessageId: msg.id,
            createdAt: new Date(msg.creationTime),
          },
        });
        createdCount += 1;
      } catch {
        // Unique constraint vi phạm (ringcentralMessageId đã có) — tin nhắn này đã lưu từ
        // lần webhook trước, bỏ qua, không phải lỗi thật.
      }
    }
    if (createdCount > 0) {
      await broadcastCaseChanged("sms", null);
    }
    return NextResponse.json({ ok: true, created: createdCount });
  } catch (err) {
    console.error("[ringcentral webhook] Lỗi xử lý tin nhắn đến:", err);
    // Vẫn trả 200 — trả lỗi 5xx sẽ khiến RingCentral coi webhook "hỏng" và có thể huỷ
    // subscription sau nhiều lần thất bại liên tiếp.
    return NextResponse.json({ ok: false });
  }
}
