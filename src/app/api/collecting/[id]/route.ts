import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import type { FeaturePermissions } from "@/lib/types";
import type { Prisma } from "@prisma/client";

const ALLOWED_FIELDS = new Set(["custom", "sortOrder"]);

/** Không kiểm tra editableBy theo từng key trong `custom` ở server (cùng cách PATCH
 * /api/cases/[id] xử lý field "custom" của bảng Hồ sơ) — enforcement thực tế nằm ở client
 * (EditableCell chỉ cho sửa khi canEditColumn(role, col) true), server chỉ yêu cầu đã đăng
 * nhập. Đủ dùng ở giai đoạn "khung bảng", có thể siết chặt hơn khi tính năng cụ thể rõ ràng. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/collecting/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });

  const data: Prisma.CollectingRecordUpdateInput = {};
  for (const [field, value] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(field)) continue;
    if (field === "custom" && value && typeof value === "object") {
      // Client chỉ gửi lên đúng key vừa đổi — merge cộng dồn vào JSON hiện có trên DB,
      // tránh ghi đè mất giá trị các cột khác nếu 2 người sửa gần như cùng lúc (cùng cơ
      // chế với "custom" của Case, xem PATCH /api/cases/[id]).
      const existing = await prisma.collectingRecord.findUnique({ where: { id }, select: { custom: true } });
      const merged = { ...((existing?.custom as Record<string, unknown>) ?? {}), ...(value as Record<string, unknown>) };
      data.custom = merged as Prisma.InputJsonValue;
      continue;
    }
    (data as Record<string, unknown>)[field] = value;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Không có trường hợp lệ để cập nhật" }, { status: 400 });
  }

  const row = await prisma.collectingRecord.update({ where: { id }, data });
  return NextResponse.json({ id: row.id, updatedAt: row.updatedAt.toISOString() });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/collecting/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "deleteCollectingRow", me.role)) {
    return NextResponse.json({ error: "Không có quyền xoá dòng" }, { status: 403 });
  }

  const { id } = await ctx.params;
  await prisma.collectingRecord.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
