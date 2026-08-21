import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { canViewCase, hasFeature } from "@/lib/rbac";
import { broadcastCaseChanged } from "@/lib/pusher-server";
import { toE164US } from "@/lib/phone";
import type { CaseRecord, ColumnDef, FeaturePermissions } from "@/lib/types";
import type { Prisma } from "@prisma/client";

export function toCaseRecord(row: {
  id: string;
  status: string;
  clients: Prisma.JsonValue;
  clientLink: string | null;
  zipcode: string;
  phone: string;
  phone2: string;
  email: string;
  dateOfBirth: Prisma.JsonValue;
  address: string;
  description: string;
  descriptionReplies: Prisma.JsonValue;
  descriptionReadBy: string[];
  caseNumber: string;
  money: number;
  refunds: Prisma.JsonValue;
  orders: Prisma.JsonValue;
  ssn: Prisma.JsonValue;
  assignedTo: string | null;
  assignedProcessor: string | null;
  assignedTo2: string | null;
  assignedProcessor2: string | null;
  createdBy: string | null;
  custom: Prisma.JsonValue;
  sheetSentAt: Date | null;
  cpaEmailSentAt: Date | null;
  cpaReviewTestSentAt: Date | null;
  clientEmailSentAt: Date | null;
  sortOrder: number;
  refundYearStatus: Prisma.JsonValue;
  refundYearPendingReason: Prisma.JsonValue;
  refundYearEfileDate: Prisma.JsonValue;
  refundYearAlarm: Prisma.JsonValue;
  fcDate: string | null;
  processingDate: string | null;
  elDate: string | null;
  bankName: string | null;
  routingNumber: string | null;
  accountNumber: string | null;
  note: string | null;
  accountant: string | null;
  accountantSupport: string | null;
  taxIntByYear: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}, hasUnreadSms = false): CaseRecord {
  return {
    id: row.id,
    status: row.status,
    clients: row.clients as unknown as CaseRecord["clients"],
    clientLink: row.clientLink,
    zipcode: row.zipcode,
    phone: row.phone,
    phone2: row.phone2,
    email: row.email,
    dateOfBirth: (row.dateOfBirth as unknown as CaseRecord["dateOfBirth"]) ?? [null, null],
    address: row.address,
    description: row.description,
    descriptionReplies: row.descriptionReplies as unknown as CaseRecord["descriptionReplies"],
    descriptionReadBy: row.descriptionReadBy,
    caseNumber: row.caseNumber,
    money: row.money,
    refunds: (row.refunds as unknown as CaseRecord["refunds"]) ?? {},
    orders: row.orders as unknown as CaseRecord["orders"],
    ssn: row.ssn as unknown as CaseRecord["ssn"],
    assignedTo: row.assignedTo,
    assignedProcessor: row.assignedProcessor,
    assignedTo2: row.assignedTo2,
    assignedProcessor2: row.assignedProcessor2,
    createdBy: row.createdBy,
    custom: row.custom as unknown as CaseRecord["custom"],
    sheetSentAt: row.sheetSentAt ? row.sheetSentAt.toISOString() : null,
    cpaEmailSentAt: row.cpaEmailSentAt ? row.cpaEmailSentAt.toISOString() : null,
    cpaReviewTestSentAt: row.cpaReviewTestSentAt ? row.cpaReviewTestSentAt.toISOString() : null,
    clientEmailSentAt: row.clientEmailSentAt ? row.clientEmailSentAt.toISOString() : null,
    sortOrder: row.sortOrder,
    refundYearStatus: (row.refundYearStatus as unknown as CaseRecord["refundYearStatus"]) ?? {},
    refundYearPendingReason: (row.refundYearPendingReason as unknown as CaseRecord["refundYearPendingReason"]) ?? {},
    refundYearEfileDate: (row.refundYearEfileDate as unknown as CaseRecord["refundYearEfileDate"]) ?? {},
    refundYearAlarm: (row.refundYearAlarm as unknown as CaseRecord["refundYearAlarm"]) ?? {},
    fcDate: row.fcDate,
    processingDate: row.processingDate,
    elDate: row.elDate,
    bankName: row.bankName,
    routingNumber: row.routingNumber,
    accountNumber: row.accountNumber,
    note: row.note,
    accountant: row.accountant,
    accountantSupport: row.accountantSupport,
    taxIntByYear: (row.taxIntByYear as unknown as CaseRecord["taxIntByYear"]) ?? {},
    hasUnreadSms,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const rows = await prisma.case.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
  // Tính hasUnreadSms cho mọi hồ sơ bằng 1 query nhẹ (không JOIN per-row) — lấy tập số điện
  // thoại đang có tin nhắn "in" chưa đọc, rồi so khớp với phone/phone2 từng case khi map.
  const unreadRows = await prisma.smsMessage.findMany({
    where: { direction: "in", readAt: null },
    select: { counterpartNumber: true },
    distinct: ["counterpartNumber"],
  });
  const unreadNumbers = new Set(unreadRows.map((r) => r.counterpartNumber));
  const visible = rows
    .map((row) => {
      const hasUnreadSms = [toE164US(row.phone), toE164US(row.phone2)].some((n) => n !== null && unreadNumbers.has(n));
      return toCaseRecord(row, hasUnreadSms);
    })
    .filter((c) =>
      canViewCase(
        me.role,
        me.id,
        {
          assignedTo: c.assignedTo,
          assignedProcessor: c.assignedProcessor,
          assignedTo2: c.assignedTo2,
          assignedProcessor2: c.assignedProcessor2,
          createdBy: c.createdBy,
        },
        me.teamMemberIds
      )
    );
  return NextResponse.json(visible);
}

/**
 * Tính số hồ sơ (caseNumber) tiếp theo dựa trên TOÀN BỘ case trong DB — không tin số do
 * client gửi lên, vì client (đặc biệt Agent/Processor) chỉ nhìn thấy tập case đã bị lọc
 * theo quyền (canViewCase), nên tính "số lớn nhất + 1" phía client dễ ra số bị trùng với
 * case mà họ không nhìn thấy được, vi phạm ràng buộc unique trên caseNumber.
 */
async function nextCaseNumber(): Promise<string> {
  const rows = await prisma.case.findMany({ select: { caseNumber: true } });
  const max = rows.reduce((m, r) => {
    const n = Number(r.caseNumber);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 1000);
  return String(max + 1);
}

export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "addRow", me.role)) {
    return NextResponse.json({ error: "Không có quyền thêm hồ sơ" }, { status: 403 });
  }

  // Frontend (app-store.ts addRow) đã tự tính sẵn id/auto-assign theo đúng logic nghiệp
  // vụ hiện có và gửi nguyên object CaseRecord lên — server giữ lại các field đó, CHỈ
  // riêng caseNumber luôn tự tính lại server-side (xem nextCaseNumber ở trên) vì đây là
  // field cần đúng trên toàn bộ dữ liệu, không thể tin tưởng góc nhìn đã lọc của client.
  const body = (await request.json().catch(() => null)) as Partial<CaseRecord> | null;
  const caseNumber = await nextCaseNumber();

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
      phone2: body.phone2 ?? "",
      email: body.email ?? "",
      dateOfBirth: (body.dateOfBirth ?? [null, null]) as unknown as Prisma.InputJsonValue,
      address: body.address ?? "",
      description: body.description ?? "",
      descriptionReplies: (body.descriptionReplies ?? []) as unknown as Prisma.InputJsonValue,
      descriptionReadBy: body.descriptionReadBy ?? [],
      caseNumber,
      money: body.money ?? 0,
      refunds: (body.refunds ?? {}) as unknown as Prisma.InputJsonValue,
      orders: (body.orders ?? []) as unknown as Prisma.InputJsonValue,
      ssn: (body.ssn ?? [null, null]) as unknown as Prisma.InputJsonValue,
      assignedTo: body.assignedTo ?? null,
      assignedProcessor: body.assignedProcessor ?? null,
      assignedTo2: body.assignedTo2 ?? null,
      assignedProcessor2: body.assignedProcessor2 ?? null,
      createdBy: body.createdBy ?? me.id,
      custom: (body.custom ?? {}) as unknown as Prisma.InputJsonValue,
      // Client (app-store.ts addRow) đã tự tính sẵn -Date.now() cho dòng tạm hiển thị
      // ngay ở đầu bảng — giữ nguyên giá trị đó nếu có, fallback tự tính lại nếu thiếu.
      sortOrder: body.sortOrder ?? -Date.now(),
      refundYearStatus: (body.refundYearStatus ?? {}) as unknown as Prisma.InputJsonValue,
      refundYearPendingReason: (body.refundYearPendingReason ?? {}) as unknown as Prisma.InputJsonValue,
      refundYearEfileDate: (body.refundYearEfileDate ?? {}) as unknown as Prisma.InputJsonValue,
      refundYearAlarm: (body.refundYearAlarm ?? {}) as unknown as Prisma.InputJsonValue,
      fcDate: body.fcDate ?? null,
      processingDate: body.processingDate ?? null,
      elDate: body.elDate ?? null,
    };
  } else {
    const columns = (config?.columns as ColumnDef[] | undefined) ?? [];
    const statusColumn = columns.find((c) => c.id === "status");
    data = {
      status: statusColumn?.options?.[0]?.id ?? "",
      clients: [
        { firstName: "", lastName: "" },
        { firstName: "", lastName: "" },
      ],
      clientLink: null,
      zipcode: "",
      phone: "",
      phone2: "",
      email: "",
      dateOfBirth: [null, null],
      address: "",
      description: "",
      descriptionReplies: [],
      descriptionReadBy: [],
      caseNumber,
      money: 0,
      refunds: {},
      orders: [],
      ssn: [null, null],
      assignedTo: me.role === "agent" ? me.id : null,
      // Processor luôn tự gán cho người tạo hồ sơ (khớp mặc định ở app-store.ts addRow).
      assignedProcessor: me.id,
      assignedTo2: null,
      assignedProcessor2: null,
      createdBy: me.id,
      // Cột "Case" hiển thị (custom field caseLabel) giờ là số đếm tự động năm Refund >
      // 0 (xem rbac.ts) — hồ sơ mới chưa có refund nào nên mặc định 0, không còn "1" như
      // quy ước cũ (mã hồ sơ nhập tay).
      custom: { caseLabel: 0 },
      sortOrder: -Date.now(),
      refundYearStatus: {},
      refundYearPendingReason: {},
      refundYearEfileDate: {},
      refundYearAlarm: {},
      fcDate: null,
      processingDate: null,
      elDate: null,
    };
  }

  const row = await prisma.case.create({
    data,
  });

  await broadcastCaseChanged(row.id, request.headers.get("x-pusher-socket-id"));

  return NextResponse.json(toCaseRecord(row), { status: 201 });
}
