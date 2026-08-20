import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { hasFeature } from "@/lib/rbac";
import type { FeaturePermissions } from "@/lib/types";

async function canManageUsers(role: string): Promise<boolean> {
  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  return !!featurePermissions && hasFeature(featurePermissions, "manageUsers", role as never);
}

/**
 * Sửa 1 tài khoản: role/avatar chỉ Quản lý được đổi; đổi mật khẩu (currentPassword +
 * newPassword) thì chính chủ tài khoản tự làm, không cần quyền manageUsers.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/users/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });

  if (typeof body.currentPassword === "string" && typeof body.newPassword === "string") {
    if (me.id !== id) return NextResponse.json({ error: "Chỉ tự đổi mật khẩu của chính mình" }, { status: 403 });
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || !(await verifyPassword(body.currentPassword, target.passwordHash))) {
      return NextResponse.json({ error: "Mật khẩu hiện tại không đúng" }, { status: 400 });
    }
    const passwordHash = await hashPassword(body.newPassword);
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    return NextResponse.json({ ok: true });
  }

  // Admin đặt lại mật khẩu tài khoản KHÁC — không cần biết mật khẩu cũ (khác nhánh
  // "tự đổi mật khẩu của chính mình" ở trên), chỉ cần quyền manageUsers.
  if (typeof body.adminNewPassword === "string") {
    if (!(await canManageUsers(me.role))) {
      return NextResponse.json({ error: "Không có quyền đặt lại mật khẩu tài khoản khác" }, { status: 403 });
    }
    const passwordHash = await hashPassword(body.adminNewPassword);
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    return NextResponse.json({ ok: true });
  }

  const patch: { role?: string; email?: string; avatarUrl?: string | null; teamMemberIds?: string[] } = {};
  if (typeof body.role === "string") {
    if (!(await canManageUsers(me.role))) {
      return NextResponse.json({ error: "Không có quyền quản lý tài khoản" }, { status: 403 });
    }
    patch.role = body.role;
  }
  if (typeof body.email === "string") {
    if (!(await canManageUsers(me.role))) {
      return NextResponse.json({ error: "Không có quyền đổi email tài khoản" }, { status: 403 });
    }
    const nextEmail = body.email.trim().toLowerCase();
    if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return NextResponse.json({ error: "Email không hợp lệ" }, { status: 400 });
    }
    const existing = await prisma.user.findUnique({ where: { email: nextEmail } });
    if (existing && existing.id !== id) {
      return NextResponse.json({ error: "Email đã được sử dụng" }, { status: 409 });
    }
    patch.email = nextEmail;
  }
  if ("avatarUrl" in body) {
    if (me.id !== id && !(await canManageUsers(me.role))) {
      return NextResponse.json({ error: "Không có quyền sửa avatar tài khoản này" }, { status: 403 });
    }
    patch.avatarUrl = body.avatarUrl;
  }
  if (Array.isArray(body.teamMemberIds)) {
    if (!(await canManageUsers(me.role))) {
      return NextResponse.json({ error: "Không có quyền quản lý tài khoản" }, { status: 403 });
    }
    patch.teamMemberIds = body.teamMemberIds.map(String);
  }
  const user = await prisma.user.update({ where: { id }, data: patch });
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    avatarColor: user.avatarColor,
    avatarUrl: user.avatarUrl,
    teamMemberIds: user.teamMemberIds,
    webmailUsername: user.webmailUsername,
  });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/users/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (!(await canManageUsers(me.role))) {
    return NextResponse.json({ error: "Không có quyền quản lý tài khoản" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (id === me.id) return NextResponse.json({ error: "Không thể tự xoá chính mình" }, { status: 400 });
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
