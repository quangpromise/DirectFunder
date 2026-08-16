import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { toCaseRecord } from "@/app/api/cases/route";
import { toCollectingRecord } from "@/app/api/collecting/route";
import { buildCollectingCustomFromCase } from "@/lib/case-to-collecting";
import type { CollectingReportManualFields, FeaturePermissions } from "@/lib/types";
import type { Prisma } from "@prisma/client";

function numberOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function parseManualFields(body: Record<string, unknown>): CollectingReportManualFields {
  return {
    program: typeof body.program === "string" ? body.program : "",
    taxOffset: body.taxOffset === true,
    approvedAmt: numberOrNull(body.approvedAmt),
    upfrontFees: numberOrNull(body.upfrontFees),
    totalCollected: numberOrNull(body.totalCollected),
    pmtMethod: typeof body.pmtMethod === "string" ? body.pmtMethod : "",
    note: typeof body.note === "string" ? body.note : "",
    tips: numberOrNull(body.tips),
    receiptCheckNo: typeof body.receiptCheckNo === "string" ? body.receiptCheckNo : "",
    receiptCheckAmt: numberOrNull(body.receiptCheckAmt),
  };
}

/**
 * Nút "Send Collecting Report" đặt trước mỗi năm trong popup "Refund by years" (thêm
 * 2026-08-16) — tạo 1 dòng MỚI trong tab "Collecting" từ dữ liệu hồ sơ hiện có + đúng số
 * refund của năm được bấm + các trường nhập tay ở popup xác nhận (Program, Tax Offset,
 * Approved amt, Upfront fee, Total Collected, Pmt method, Note, Tip, Receipt/Check #,
 * Receipt/Check Amt.), dùng lại quyền `addCollectingRow` đã có sẵn (giống cách "Test Sheet"
 * dùng lại `addCpaReviewRow`) — không thêm feature key mới. Không có trạng thái "đã gửi" bền
 * vững như Test Sheet/Send to Sheet: bấm là tạo dòng mới ngay, có thể bấm nhiều lần cho các
 * năm khác nhau (mỗi lần luôn ra 1 dòng Collecting riêng).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/send-collecting-report">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const year = typeof body?.year === "string" ? body.year : "";
  if (!year) return NextResponse.json({ error: "Thiếu năm" }, { status: 400 });
  const manual = parseManualFields(body ?? {});

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "addCollectingRow", me.role)) {
    return NextResponse.json({ error: "Không có quyền thêm dòng Collecting" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const row = await prisma.case.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });

  const caseRecord = toCaseRecord(row);
  const agentIds = [caseRecord.assignedTo, caseRecord.assignedTo2].filter((v): v is string => Boolean(v));
  const agents = agentIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: agentIds } } }) : [];
  const agentName = agents.find((u) => u.id === caseRecord.assignedTo)?.name ?? "";
  const agentName2 = agents.find((u) => u.id === caseRecord.assignedTo2)?.name ?? "";

  const custom = buildCollectingCustomFromCase(caseRecord, year, agentName, agentName2, manual);
  const created = await prisma.collectingRecord.create({
    data: { custom: custom as unknown as Prisma.InputJsonValue, sortOrder: -Date.now() },
  });
  return NextResponse.json({ ok: true, record: toCollectingRecord(created) }, { status: 201 });
}
