import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";

export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  if (!config) return NextResponse.json({ error: "Chưa có cấu hình" }, { status: 404 });
  return NextResponse.json({ columns: config.columns, featurePermissions: config.featurePermissions });
}

/** Chỉ Quản lý (manager) được sửa cấu hình cột/phân quyền — đúng logic hasFeature() vốn
 * luôn cho phép manager bất kể cấu hình. */
export async function PUT(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (me.role !== "manager") return NextResponse.json({ error: "Chỉ Quản lý được sửa cấu hình" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.columns || !body?.featurePermissions) {
    return NextResponse.json({ error: "Thiếu columns hoặc featurePermissions" }, { status: 400 });
  }

  const config = await prisma.appConfig.update({
    where: { id: "singleton" },
    data: { columns: body.columns, featurePermissions: body.featurePermissions },
  });
  return NextResponse.json({ columns: config.columns, featurePermissions: config.featurePermissions });
}
