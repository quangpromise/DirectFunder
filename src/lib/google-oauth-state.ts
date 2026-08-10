import { SignJWT, jwtVerify } from "jose";

/** "state" param của OAuth2 flow — chống CSRF (Google khuyến nghị), ký bằng chính
 * AUTH_SECRET đang dùng cho session cookie (không cần secret riêng). Gắn userId vào state
 * để callback đối chiếu đúng người đã bấm "Kết nối Google" ban đầu, không chỉ dựa vào
 * cookie session hiện tại (phòng trường hợp popup mất cookie/đổi tab). */
const STATE_TTL_SECONDS = 10 * 60; // 10 phút — đủ cho người dùng thao tác trên màn hình consent Google

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Thiếu biến môi trường AUTH_SECRET");
  return new TextEncoder().encode(secret);
}

export async function signGoogleOAuthState(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Trả về userId đã ký trong state, null nếu state không hợp lệ/hết hạn. */
export async function verifyGoogleOAuthState(state: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(state, secretKey());
    return typeof payload.userId === "string" ? payload.userId : null;
  } catch {
    return null;
  }
}
