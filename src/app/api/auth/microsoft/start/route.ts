import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { buildMicrosoftAuthUrl } from "@/lib/microsoft-graph";
import { signOAuthState } from "@/lib/oauth-state";

/** Mở trong popup (xem connectMicrosoftAccount trong app-store.ts) — redirect sang màn hình
 * consent Microsoft, không phải API trả JSON. */
export async function GET(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const state = await signOAuthState(me.id, "microsoft");
  const redirectUri = `${request.nextUrl.origin}/api/auth/microsoft/callback`;
  const authUrl = buildMicrosoftAuthUrl(state, redirectUri);
  return NextResponse.redirect(authUrl);
}
