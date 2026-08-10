import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { exchangeCodeForRefreshToken } from "@/lib/google-sheets";
import { verifyGoogleOAuthState } from "@/lib/google-oauth-state";

/** Trang HTML nhỏ tự đóng popup — báo kết quả về cửa sổ chính (window.opener) qua
 * postMessage rồi tự window.close(), không render UI thật cho người dùng thấy lâu. */
function popupResultHtml(ok: boolean, message?: string): string {
  const payload = JSON.stringify({ type: "google-oauth-done", ok, message: message ?? null });
  return `<!doctype html><html><body style="font-family:sans-serif;background:#0a0a0f;color:#f2f0ec;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<p>${ok ? "Kết nối Google thành công, đang đóng cửa sổ..." : "Kết nối Google thất bại, đang đóng cửa sổ..."}</p>
<script>
  if (window.opener) { window.opener.postMessage(${payload}, window.location.origin); }
  window.close();
</script>
</body></html>`;
}

function htmlResponse(body: string): NextResponse {
  return new NextResponse(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(request: NextRequest) {
  const me = await requireUser();
  if (!me) return htmlResponse(popupResultHtml(false, "Chưa đăng nhập"));

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const googleError = request.nextUrl.searchParams.get("error");

  if (googleError) {
    return htmlResponse(popupResultHtml(false, "Bạn đã huỷ kết nối Google"));
  }
  if (!code || !state) {
    return htmlResponse(popupResultHtml(false, "Thiếu code/state từ Google"));
  }

  const stateUserId = await verifyGoogleOAuthState(state);
  if (!stateUserId || stateUserId !== me.id) {
    return htmlResponse(popupResultHtml(false, "Phiên kết nối không hợp lệ hoặc đã hết hạn, thử lại"));
  }

  try {
    const redirectUri = `${request.nextUrl.origin}/api/auth/google/callback`;
    const refreshToken = await exchangeCodeForRefreshToken(code, redirectUri);
    await prisma.user.update({ where: { id: me.id }, data: { googleRefreshToken: refreshToken } });
    return htmlResponse(popupResultHtml(true));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kết nối Google thất bại";
    return htmlResponse(popupResultHtml(false, message));
  }
}
