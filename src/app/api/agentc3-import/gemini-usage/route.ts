import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getGeminiUsageSummary } from "@/lib/gemini-usage";

export const runtime = "nodejs";

/** Bảng "Rate Limit" trong popup "Get Files" (so sánh WIT/TTS AI) — chỉ cần đăng nhập là xem
 * được (usage Gemini dùng CHUNG 1 API key cho mọi user, không phải dữ liệu riêng theo hồ sơ nên
 * không cần `canViewCase`). Xem `src/lib/gemini-usage.ts` cho cách tính RPM/TPM/RPD. */
export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ ok: false, error: "Chưa đăng nhập" }, { status: 401 });

  try {
    const usage = await getGeminiUsageSummary();
    return NextResponse.json({ ok: true, usage });
  } catch (err) {
    console.error("[agentc3-import/gemini-usage] Lỗi đọc usage:", err);
    return NextResponse.json({ ok: false, error: "Không đọc được mức dùng Gemini" }, { status: 502 });
  }
}
