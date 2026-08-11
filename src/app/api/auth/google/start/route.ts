import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { buildGoogleAuthUrl } from "@/lib/google-sheets";
import { signOAuthState } from "@/lib/oauth-state";

/** Mở trong popup (xem connectGoogleAccount trong app-store.ts) — redirect sang màn hình
 * consent Google, không phải API trả JSON. */
export async function GET(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const state = await signOAuthState(me.id, "google");
  const redirectUri = `${request.nextUrl.origin}/api/auth/google/callback`;
  const authUrl = buildGoogleAuthUrl(state, redirectUri);
  return NextResponse.redirect(authUrl);
}
