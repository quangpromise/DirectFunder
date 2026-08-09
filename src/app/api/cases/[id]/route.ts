import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { canEditColumn, hasFeature } from "@/lib/rbac";
import type { ColumnDef, FeaturePermissions } from "@/lib/types";
import type { Prisma } from "@prisma/client";

/** Ánh xạ tên field của Case (Prisma) sang `key` của ColumnDef tương ứng — dùng để
 * kiểm tra quyền editableBy theo cột khi field đó có cột cấu hình. Field không có
 * trong map (orders, ssn, descriptionReplies, assignedTo...) chỉ yêu cầu đã đăng nhập,
 * enforcement chi tiết hơn sẽ bổ sung khi wiring frontend thật (giai đoạn sau). */
const FIELD_TO_COLUMN_KEY: Record<string, string> = {
  status: "status",
  clients: "clientName",
  zipcode: "zipcode",
  phone: "phone",
  address: "address",
  description: "description",
  caseNumber: "caseNumber",
  money: "money",
};

const ALLOWED_FIELDS = new Set([
  "status",
  "clients",
  "clientLink",
  "zipcode",
  "phone",
  "address",
  "description",
  "descriptionReplies",
  "descriptionReadBy",
  "money",
  "orders",
  "ssn",
  "assignedTo",
  "assignedProcessor",
  "custom",
]);

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/cases/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const columns = (config?.columns as ColumnDef[] | undefined) ?? [];

  const data: Prisma.CaseUpdateInput = {};
  for (const [field, value] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(field)) continue;
    const columnKey = FIELD_TO_COLUMN_KEY[field];
    if (columnKey) {
      const column = columns.find((c) => c.key === columnKey);
      if (column && !canEditColumn(me.role, column)) {
        return NextResponse.json({ error: `Không có quyền sửa cột ${column.label}` }, { status: 403 });
      }
    }
    if (field === "custom" && value && typeof value === "object") {
      const existing = await prisma.case.findUnique({ where: { id }, select: { custom: true } });
      const merged = { ...((existing?.custom as Record<string, unknown>) ?? {}), ...(value as Record<string, unknown>) };
      data.custom = merged as Prisma.InputJsonValue;
      continue;
    }
    (data as Record<string, unknown>)[field] = value;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Không có trường hợp lệ để cập nhật" }, { status: 400 });
  }

  const row = await prisma.case.update({ where: { id }, data });
  return NextResponse.json({ id: row.id, updatedAt: row.updatedAt.toISOString() });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/cases/[id]">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "deleteRow", me.role)) {
    return NextResponse.json({ error: "Không có quyền xoá hồ sơ" }, { status: 403 });
  }

  const { id } = await ctx.params;
  await prisma.case.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
