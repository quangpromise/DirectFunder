import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionCookie, verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  // Chấp nhận cả email lẫn username trong 1 ô nhập — "identifier" là tên field mới, giữ
  // "email" làm alias để tương thích client cũ/request thủ công (curl...) vẫn hoạt động.
  const raw = typeof body?.identifier === "string" ? body.identifier : typeof body?.email === "string" ? body.email : "";
  const identifier = raw.trim().toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  if (!identifier || !password) {
    return NextResponse.json({ error: "Thiếu email/username hoặc mật khẩu" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Email/Username hoặc mật khẩu không đúng" }, { status: 401 });
  }

  await createSessionCookie(user.id);
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    avatarColor: user.avatarColor,
    avatarUrl: user.avatarUrl,
  });
}
