import { prisma } from "./prisma";
import { getSessionUserId } from "./auth";
import type { Role } from "./types";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarColor: string;
  avatarUrl: string | null;
}

/** Trả về user hiện tại (dựa vào cookie session) hoặc null nếu chưa đăng nhập / user đã bị xoá. */
export async function requireUser(): Promise<SessionUser | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Role,
    avatarColor: user.avatarColor,
    avatarUrl: user.avatarUrl,
  };
}
