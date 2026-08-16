import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { toCaseRecord } from "@/app/api/cases/route";
import { toCpaReviewRecord } from "@/app/api/cpa-review/route";
import { buildCpaReviewCustomFromCase } from "@/lib/case-to-cpa-review";
import { syncRecordToCpaReviewSheet, nextAppendCpaReviewSortOrder } from "@/lib/cpa-review-sheet-sync";
import { broadcastCpaReviewChanged } from "@/lib/pusher-server";
import { currentMonthKey } from "@/lib/cpa-review-month";
import type { FeaturePermissions } from "@/lib/types";
import type { Prisma } from "@prisma/client";

/**
 * Nút "Test Sheet" cạnh Status (thêm 2026-08-14) — tạo 1 dòng MỚI trong tab "CPA Review"
 * (tháng hiện tại) từ dữ liệu hồ sơ hiện có, đồng thời lưu `cpaReviewTestSentAt` xuống bảng
 * Case (giống hệt cơ chế sheetSentAt/cpaEmailSentAt — xem send-to-sheet/send-cpa-email)
 * để nút giữ đúng trạng thái "đã gửi" (xanh) qua reload. `manual`/`clear` cùng ngữ nghĩa
 * với 2 route kia: "Mark as sent" chỉ lưu mốc thời gian (không tạo dòng CPA Review), "muốn
 * gửi lại" xoá mốc để nút quay về mặc định.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/test-cpa-review-sheet">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const reviewYears = Array.isArray(body?.reviewYears) ? body.reviewYears.filter((y: unknown) => typeof y === "string") : [];
  const note = typeof body?.note === "string" ? body.note : "";
  const crmSource = typeof body?.crmSource === "string" ? body.crmSource : "";
  const manual = body?.manual === true;
  const clear = body?.clear === true;

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "addCpaReviewRow", me.role)) {
    return NextResponse.json({ error: "Không có quyền thêm dòng CPA Review" }, { status: 403 });
  }

  const { id } = await ctx.params;

  if (clear) {
    const updated = await prisma.case.update({ where: { id }, data: { cpaReviewTestSentAt: null } });
    return NextResponse.json({ ok: true, cpaReviewTestSentAt: updated.cpaReviewTestSentAt });
  }
  if (manual) {
    const updated = await prisma.case.update({ where: { id }, data: { cpaReviewTestSentAt: new Date() } });
    return NextResponse.json({ ok: true, cpaReviewTestSentAt: updated.cpaReviewTestSentAt!.toISOString() });
  }

  const row = await prisma.case.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });

  const caseRecord = toCaseRecord(row);
  const custom = buildCpaReviewCustomFromCase(caseRecord, reviewYears, note, crmSource);
  const month = currentMonthKey();
  // Luôn tạo 1 dòng MỚI — kể cả gửi nhiều lần cho CÙNG hồ sơ với năm khác nhau, mỗi lần
  // gửi vẫn là 1 dòng CPA Review riêng (yêu cầu 2026-08-15, "khác năm thì tạo dòng mới,
  // không gộp"). An toàn để nhiều dòng cùng SSN/tháng tồn tại — vị trí trên Sheet giờ được
  // cache theo record.id thay vì SSN (xem pushRecordToSheet trong cpa-review-sheet-sync.ts),
  // nên các dòng không còn tranh nhau ghi đè cùng 1 dòng Sheet như bug thật gặp trước đó
  // (case "Dinh Hieu Huynh").
  const created = await prisma.cpaReviewRecord.create({
    data: { month, custom: custom as unknown as Prisma.InputJsonValue, sortOrder: await nextAppendCpaReviewSortOrder(month) },
  });
  const record = toCpaReviewRecord(created);
  after(() => syncRecordToCpaReviewSheet(record));
  await broadcastCpaReviewChanged(record.id, request.headers.get("x-pusher-socket-id"));

  const updated = await prisma.case.update({ where: { id }, data: { cpaReviewTestSentAt: new Date() } });
  return NextResponse.json({ ok: true, cpaReviewTestSentAt: updated.cpaReviewTestSentAt!.toISOString(), record });
}
