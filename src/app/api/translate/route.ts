import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { GoogleTranslateApiError, GoogleTranslateConfigError, translateText } from "@/lib/google-translate";

const MAX_TEXT_LENGTH = 5000;

export async function POST(request: Request) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  const target = typeof body?.target === "string" ? body.target : "";
  const source = typeof body?.source === "string" && body.source ? body.source : undefined;

  if (!text.trim() || !target) {
    return NextResponse.json({ error: "Thiếu nội dung cần dịch hoặc ngôn ngữ đích" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: `Văn bản quá dài (tối đa ${MAX_TEXT_LENGTH} ký tự)` }, { status: 400 });
  }

  try {
    const result = await translateText(text, target, source);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof GoogleTranslateConfigError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    if (err instanceof GoogleTranslateApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Dịch thất bại, thử lại sau" }, { status: 500 });
  }
}
