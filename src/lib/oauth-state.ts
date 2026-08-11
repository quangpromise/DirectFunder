import { SignJWT, jwtVerify } from "jose";

/** "state" param dùng chung cho MỌI OAuth2 flow trong app (Google, Microsoft...) — chống
 * CSRF, ký bằng chính AUTH_SECRET đang dùng cho session cookie (không cần secret riêng).
 * Gắn userId vào state để callback đối chiếu đúng người đã bấm "Kết nối..." ban đầu, không
 * chỉ dựa vào cookie session hiện tại (phòng trường hợp popup mất cookie/đổi tab). Gắn thêm
 * `provider` để state ký cho luồng Google không thể bị dùng lại (replay) ở callback
 * Microsoft hay ngược lại, dù dùng chung 1 secret. */
const STATE_TTL_SECONDS = 10 * 60; // 10 phút — đủ cho người dùng thao tác trên màn hình consent

export type OAuthProvider = "google" | "microsoft";

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Thiếu biến môi trường AUTH_SECRET");
  return new TextEncoder().encode(secret);
}

export async function signOAuthState(userId: string, provider: OAuthProvider): Promise<string> {
  return new SignJWT({ userId, provider })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Trả về userId đã ký trong state, null nếu state không hợp lệ/hết hạn/sai provider. */
export async function verifyOAuthState(state: string, provider: OAuthProvider): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(state, secretKey());
    if (payload.provider !== provider) return null;
    return typeof payload.userId === "string" ? payload.userId : null;
  } catch {
    return null;
  }
}
