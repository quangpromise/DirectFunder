import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export { hashPassword, verifyPassword } from "./password";

const SESSION_COOKIE = "direct-funder-session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 ngày

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Thiếu biến môi trường AUTH_SECRET");
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
}

export async function createSessionCookie(userId: string): Promise<void> {
  const token = await new SignJWT({ userId } satisfies SessionPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** Đọc userId từ cookie session hiện tại — trả về null nếu chưa đăng nhập hoặc token hết hạn/không hợp lệ. */
export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.userId === "string" ? payload.userId : null;
  } catch {
    return null;
  }
}
