/** Đăng 1 tin nhắn text lên kênh Microsoft Teams của Agent 1 (Case.assignedTo) qua webhook
 * URL đã cấu hình (Incoming Webhook cổ điển hoặc Power Automate "Workflows" — cả 2 đều nhận
 * POST JSON tới 1 URL). Gọi từ PATCH /api/cases/[id] khi Processor thêm reply mới vào
 * Description (xem src/app/api/cases/[id]/route.ts).
 *
 * KHÔNG BAO GIỜ throw — giống safeTrigger() của Pusher (src/lib/pusher-server.ts): đây là
 * side-effect phụ trợ, lỗi ở đây (URL sai, Teams tenant chưa cấu hình đúng, timeout mạng...)
 * không được phép làm hỏng request PATCH case chính.
 *
 * Payload `{ text }` là điểm khởi đầu đơn giản nhất — khớp Incoming Webhook cổ điển và hầu
 * hết flow Power Automate "Workflows" cơ bản. Nếu webhook thật của Admin từ chối payload
 * này, đây là nơi DUY NHẤT cần chỉnh lại schema JSON. */
export async function postTeamsMessage(webhookUrl: string, text: string): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`[teams-webhook] POST thất bại (status ${res.status}): ${await res.text().catch(() => "")}`);
    }
  } catch (err) {
    console.error("[teams-webhook] Gửi tin nhắn Teams thất bại:", err);
  }
}
