import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hashPassword } from "@/lib/password";
import { hasFeature } from "@/lib/rbac";
import type { FeaturePermissions } from "@/lib/types";

export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      avatarColor: u.avatarColor,
      avatarUrl: u.avatarUrl,
    }))
  );
}

export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "manageUsers", me.role)) {
    return NextResponse.json({ error: "Không có quyền quản lý tài khoản" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { name, email, password, role, avatarColor } = body ?? {};
  if (!name || !email || !password || !role || !avatarColor) {
    return NextResponse.json({ error: "Thiếu dữ liệu tạo tài khoản" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: "Email đã được sử dụng" }, { status: 409 });
  }

  const passwordHash = await hashPassword(String(password));
  const user = await prisma.user.create({
    data: {
      name: String(name),
      email: String(email).trim().toLowerCase(),
      passwordHash,
      role: String(role),
      avatarColor: String(avatarColor),
    },
  });

  return NextResponse.json(
    { id: user.id, name: user.name, email: user.email, role: user.role, avatarColor: user.avatarColor, avatarUrl: user.avatarUrl },
    { status: 201 }
  );
}
