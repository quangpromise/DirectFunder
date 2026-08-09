import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { canViewCase, hasFeature } from "@/lib/rbac";
import type { CaseRecord, ColumnDef, FeaturePermissions } from "@/lib/types";
import type { Prisma } from "@prisma/client";

function toCaseRecord(row: {
  id: string;
  status: string;
  clients: Prisma.JsonValue;
  clientLink: string | null;
  zipcode: string;
  phone: string;
  address: string;
  description: string;
  descriptionReplies: Prisma.JsonValue;
  descriptionReadBy: string[];
  caseNumber: string;
  money: number;
  orders: Prisma.JsonValue;
  ssn: Prisma.JsonValue;
  assignedTo: string | null;
  assignedProcessor: string | null;
  custom: Prisma.JsonValue;
  updatedAt: Date;
}): CaseRecord {
  return {
    id: row.id,
    status: row.status,
    clients: row.clients as unknown as CaseRecord["clients"],
    clientLink: row.clientLink,
    zipcode: row.zipcode,
    phone: row.phone,
    address: row.address,
    description: row.description,
    descriptionReplies: row.descriptionReplies as unknown as CaseRecord["descriptionReplies"],
    descriptionReadBy: row.descriptionReadBy,
    caseNumber: row.caseNumber,
    money: row.money,
    orders: row.orders as unknown as CaseRecord["orders"],
    ssn: row.ssn as unknown as CaseRecord["ssn"],
    assignedTo: row.assignedTo,
    assignedProcessor: row.assignedProcessor,
    custom: row.custom as unknown as CaseRecord["custom"],
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const rows = await prisma.case.findMany({ orderBy: { createdAt: "asc" } });
  const visible = rows
    .map(toCaseRecord)
    .filter((c) => canViewCase(me.role, me.id, { assignedTo: c.assignedTo, assignedProcessor: c.assignedProcessor }));
  return NextResponse.json(visible);
}

export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "addRow", me.role)) {
    return NextResponse.json({ error: "Không có quyền thêm hồ sơ" }, { status: 403 });
  }

  // Frontend (app-store.ts addRow) đã tự tính sẵn id/số hồ sơ/auto-assign theo đúng
  // logic nghiệp vụ hiện có (xét cả lịch sử xoá) và gửi nguyên object CaseRecord lên —
  // server chỉ việc lưu lại, tránh viết trùng 2 nơi 2 phiên bản logic đánh số khác nhau.
  // Nếu gọi API trực tiếp không kèm body (vd. test), fallback tự sinh tối thiểu.
  const body = (await request.json().catch(() => null)) as Partial<CaseRecord> | null;

  let data: Prisma.CaseCreateInput;
  if (body && typeof body === "object") {
    data = {
      id: body.id,
      status: body.status ?? "",
      clients: (body.clients ?? [
        { firstName: "", lastName: "" },
        { firstName: "", lastName: "" },
      ]) as unknown as Prisma.InputJsonValue,
      clientLink: body.clientLink ?? null,
      zipcode: body.zipcode ?? "",
      phone: body.phone ?? "",
      address: body.address ?? "",
      description: body.description ?? "",
      descriptionReplies: (body.descriptionReplies ?? []) as unknown as Prisma.InputJsonValue,
      descriptionReadBy: body.descriptionReadBy ?? [],
      caseNumber: body.caseNumber ?? String(Date.now()),
      money: body.money ?? 0,
      orders: (body.orders ?? []) as unknown as Prisma.InputJsonValue,
      ssn: (body.ssn ?? [null, null]) as unknown as Prisma.InputJsonValue,
      assignedTo: body.assignedTo ?? null,
      assignedProcessor: body.assignedProcessor ?? null,
      custom: (body.custom ?? {}) as unknown as Prisma.InputJsonValue,
    };
  } else {
    const columns = (config?.columns as ColumnDef[] | undefined) ?? [];
    const statusColumn = columns.find((c) => c.id === "status");
    const last = await prisma.case.findFirst({ orderBy: { caseNumber: "desc" } });
    data = {
      status: statusColumn?.options?.[0]?.id ?? "",
      clients: [
        { firstName: "", lastName: "" },
        { firstName: "", lastName: "" },
      ],
      clientLink: null,
      zipcode: "",
      phone: "",
      address: "",
      description: "",
      descriptionReplies: [],
      descriptionReadBy: [],
      caseNumber: String((Number(last?.caseNumber ?? "1000") || 1000) + 1),
      money: 0,
      orders: [],
      ssn: [null, null],
      assignedTo: me.role === "agent" ? me.id : null,
      assignedProcessor: null,
      custom: {},
    };
  }

  const row = await prisma.case.create({
    data,
  });

  return NextResponse.json(toCaseRecord(row), { status: 201 });
}
