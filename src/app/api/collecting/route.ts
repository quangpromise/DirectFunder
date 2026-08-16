import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import type { CollectingRecord, FeaturePermissions } from "@/lib/types";
import type { Prisma } from "@prisma/client";

export function toCollectingRecord(row: {
  id: string;
  custom: Prisma.JsonValue;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): CollectingRecord {
  return {
    id: row.id,
    custom: (row.custom as unknown as CollectingRecord["custom"]) ?? {},
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Không lọc theo canViewCase như /api/cases — tab "Collecting" chưa có khái niệm "hồ sơ
 * của riêng ai" (không assignedTo/assignedProcessor/createdBy), mọi user đã đăng nhập xem
 * được toàn bộ danh sách (đúng thiết kế hiện tại, "tính năng sẽ thông báo sau"). */
export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const rows = await prisma.collectingRecord.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
  return NextResponse.json(rows.map(toCollectingRecord));
}

export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "addCollectingRow", me.role)) {
    return NextResponse.json({ error: "Không có quyền thêm dòng" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Partial<CollectingRecord> | null;
  const row = await prisma.collectingRecord.create({
    data: {
      id: body?.id,
      custom: (body?.custom ?? {}) as unknown as Prisma.InputJsonValue,
      // Client (app-store.ts addCollectingRow) đã tự tính sẵn -Date.now() cho dòng tạm
      // hiển thị ngay ở đầu bảng — giữ nguyên nếu có, fallback tự tính lại nếu thiếu.
      sortOrder: body?.sortOrder ?? -Date.now(),
    },
  });
  return NextResponse.json(toCollectingRecord(row), { status: 201 });
}
