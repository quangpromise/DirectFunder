import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionCookie, verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Thiếu email hoặc mật khẩu" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Email hoặc mật khẩu không đúng" }, { status: 401 });
  }

  await createSessionCookie(user.id);
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarColor: user.avatarColor,
    avatarUrl: user.avatarUrl,
  });
}
