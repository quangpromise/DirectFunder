import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { canEditCase, canEditColumn } from "@/lib/rbac";
import { computeRefundSummary } from "@/lib/refund";
import type { ClientNameEntry, ColumnDef } from "@/lib/types";
import type { Prisma } from "@prisma/client";

/** Ánh xạ field trong payload -> `key` của ColumnDef tương ứng dùng để kiểm tra
 * editableBy — đúng các cột "ẩn" (hidden: true) khai báo riêng cho popup "Edit Hồ sơ"
 * trong DEFAULT_COLUMNS (dateOfBirth/phone2/email/refunds), cộng thêm 3 cột đã có sẵn
 * (clientName/ssn/phone/zipcode/address) nay khoá sửa NGOÀI bảng nhưng vẫn dùng lại
 * ĐÚNG editableBy hiện có cho popup này — 1 nguồn phân quyền duy nhất, không tách biệt. */
const FIELD_TO_COLUMN_KEY: Record<string, string> = {
  clients: "clientName",
  ssn: "ssn",
  dateOfBirth: "dateOfBirth",
  phone: "phone",
  phone2: "phone2",
  zipcode: "zipcode",
  address: "address",
  email: "email",
  refunds: "refunds",
  fcDate: "fcDate",
  processingDate: "processingDate",
  elDate: "elDate",
  bankName: "bankName",
  routingNumber: "routingNumber",
  accountNumber: "accountNumber",
  note: "note",
  accountant: "accountant",
  accountantSupport: "accountantSupport",
};

interface ClientProfilePayload {
  clients?: [ClientNameEntry, ClientNameEntry];
  ssn?: [string | null, string | null];
  dateOfBirth?: [string | null, string | null];
  phone?: string;
  phone2?: string;
  zipcode?: string;
  address?: string;
  email?: string;
  refunds?: Record<string, number>;
  fcDate?: string | null;
  processingDate?: string | null;
  elDate?: string | null;
  bankName?: string | null;
  routingNumber?: string | null;
  accountNumber?: string | null;
  note?: string | null;
  accountant?: string | null;
  accountantSupport?: string | null;
}

/**
 * Lưu toàn bộ nội dung popup "Edit Hồ sơ" (ClientProfileDialog) trong 1 lần gọi — tách
 * riêng khỏi PATCH /api/cases/[id] (dùng cho sửa từng ô lẻ trong bảng chính) vì 2 lý do:
 * 1. Cần TỰ TÍNH `money` (= tổng refunds) và `custom.caseLabel` (= số năm refund > 0)
 *    ở server, không tin giá trị client gửi — 2 field này có editableBy rỗng trong
 *    DEFAULT_COLUMNS (khoá sửa trực tiếp), chỉ đổi được gián tiếp qua route này.
 * 2. Muốn atomic: lưu 1 lần toàn bộ field liên quan thay vì nhiều PATCH rời rạc.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/cases/[id]/client-profile">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => null)) as ClientProfilePayload | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });
  }

  const target = await prisma.case.findUnique({
    where: { id },
    select: {
      assignedTo: true,
      assignedProcessor: true,
      assignedTo2: true,
      assignedProcessor2: true,
      createdBy: true,
      custom: true,
    },
  });
  if (!target) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });
  if (
    (me.role === "agent_leader" || me.role === "processor_leader") &&
    !canEditCase(me.role, me.id, target, me.teamMemberIds)
  ) {
    return NextResponse.json({ error: "Không có quyền sửa hồ sơ này" }, { status: 403 });
  }

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const columns = (config?.columns as ColumnDef[] | undefined) ?? [];

  const data: Prisma.CaseUpdateInput = {};
  for (const [field, value] of Object.entries(body)) {
    if (!(field in FIELD_TO_COLUMN_KEY) || value === undefined) continue;
    const column = columns.find((c) => c.key === FIELD_TO_COLUMN_KEY[field]);
    if (!column || !canEditColumn(me.role, column)) {
      return NextResponse.json({ error: `Không có quyền sửa trường ${field}` }, { status: 403 });
    }
    (data as Record<string, unknown>)[field] = value;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Không có trường hợp lệ để cập nhật" }, { status: 400 });
  }

  // money/caseLabel LUÔN tự tính lại từ refunds đã kiểm tra quyền ở trên (nếu payload có
  // gửi refunds) — không có nhánh nào cho phép client tự set trực tiếp 2 giá trị này.
  if (body.refunds) {
    const { money, caseCount } = computeRefundSummary(body.refunds);
    data.money = money;
    const existingCustom = (target.custom as Record<string, unknown>) ?? {};
    data.custom = { ...existingCustom, caseLabel: caseCount } as Prisma.InputJsonValue;
  }

  const row = await prisma.case.update({ where: { id }, data });
  return NextResponse.json({
    id: row.id,
    money: row.money,
    custom: row.custom,
    updatedAt: row.updatedAt.toISOString(),
  });
}
