import bcrypt from "bcryptjs";

// Tách riêng khỏi lib/auth.ts vì file đó import "next/headers" (chỉ chạy được trong
// Next.js server runtime) — script seed chạy bằng tsx thuần Node nên cần module không
// phụ thuộc next/headers.
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
