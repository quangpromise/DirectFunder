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
      username: u.username,
      role: u.role,
      avatarColor: u.avatarColor,
      avatarUrl: u.avatarUrl,
      teamMemberIds: u.teamMemberIds,
      webmailUsername: u.webmailUsername,
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
  const { name, email, password, role, avatarColor, teamMemberIds } = body ?? {};
  if (!name || !email || !password || !role || !avatarColor) {
    return NextResponse.json({ error: "Thiếu dữ liệu tạo tài khoản" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: "Email đã được sử dụng" }, { status: 409 });
  }

  // Username KHÔNG còn là ô Admin tự gõ (2026-08-13) — tự lấy NGUYÊN Họ tên (lowercase, để
  // đăng nhập không phân biệt hoa/thường) làm tên đăng nhập thay thế cho email. Trùng tên
  // với tài khoản khác (không hiếm — Họ tên không có ràng buộc unique) thì bỏ qua, để
  // username = null thay vì chặn tạo tài khoản mới — người dùng vẫn luôn đăng nhập được
  // bằng email trong trường hợp đó.
  const derivedUsername = String(name).trim().toLowerCase();
  const usernameTaken = derivedUsername ? await prisma.user.findUnique({ where: { username: derivedUsername } }) : null;
  const passwordHash = await hashPassword(String(password));
  const user = await prisma.user.create({
    data: {
      name: String(name),
      email: String(email).trim().toLowerCase(),
      username: usernameTaken ? null : derivedUsername || null,
      passwordHash,
      role: String(role),
      avatarColor: String(avatarColor),
      teamMemberIds: Array.isArray(teamMemberIds) ? teamMemberIds.map(String) : [],
    },
  });

  return NextResponse.json(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      avatarColor: user.avatarColor,
      avatarUrl: user.avatarUrl,
      teamMemberIds: user.teamMemberIds,
      webmailUsername: user.webmailUsername,
    },
    { status: 201 }
  );
}
