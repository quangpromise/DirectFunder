import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { askGeneralChat, GeminiChatConfigError, type GeneralChatMessage } from "@/lib/gemini-general-chat";
import { GeminiRateLimitError } from "@/lib/gemini-retry";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Chat AI tự do (nút nổi "Trợ lý AI", mọi màn hình dashboard) — bất kỳ user đã đăng nhập nào
 * đều gọi được, không gate theo feature permission nào (không đọc/ghi dữ liệu hồ sơ nào cả,
 * khác `compare-tts-wit-chat` vốn cần `canViewCase`). Không lưu DB — lịch sử chat chỉ tồn tại
 * trong state React lúc popup đang mở, mất khi đóng/reload (giống compare-tts-wit-chat). */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ ok: false, error: "Chưa đăng nhập" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { message?: string; history?: GeneralChatMessage[] } | null;
  const message = body?.message?.trim();
  if (!message) return NextResponse.json({ ok: false, error: "Thiếu message" }, { status: 400 });
  // Giữ ngắn — mỗi lượt chat gửi lại toàn bộ lịch sử, không giới hạn sẽ tốn token vô ích.
  const history = Array.isArray(body?.history) ? body.history.slice(-20) : [];

  try {
    const reply = await askGeneralChat(history, message);
    return NextResponse.json({ ok: true, reply });
  } catch (err) {
    if (err instanceof GeminiChatConfigError) {
      return NextResponse.json({ ok: false, error: "Chưa cấu hình GEMINI_API_KEY" }, { status: 501 });
    }
    if (err instanceof GeminiRateLimitError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
    }
    console.error("[ai-chat] Lỗi không xác định:", err);
    return NextResponse.json({ ok: false, error: "Không gọi được AI — thử lại sau" }, { status: 502 });
  }
}
