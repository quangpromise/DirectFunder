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
  const custom = buildCpaReviewCustomFromCase(caseRecord, reviewYears, note);
  const month = currentMonthKey();

  // Gộp vào dòng CPA Review đã có (khớp SSN, cùng tháng) thay vì luôn tạo dòng mới — bấm
  // "Test Sheet" nhiều lần cho CÙNG hồ sơ (vd lần đầu chọn năm 2024, lần sau thêm năm 2025)
  // trước đây tạo ra 2 CpaReviewRecord riêng biệt cùng SSN, phá vỡ giả định "1 SSN = 1 dòng/
  // tháng" mà cả cache rowIndex (đẩy App→Sheet) lẫn webhook (khớp Sheet→App theo SSN) đều
  // dựa vào — hậu quả thật gặp trên production (case "Dinh Hieu Huynh", 2026-08-15): 2 dòng
  // DB giành cùng 1 dòng Sheet, ghi đè lẫn nhau, nhìn như "dòng cũ bị xoá, dòng mới thay vào".
  const ssn = typeof custom.ssn === "string" ? custom.ssn.trim() : "";
  const existing = ssn
    ? (await prisma.cpaReviewRecord.findMany({ where: { month } })).find((r) => {
        const c = r.custom as Record<string, unknown>;
        return typeof c.ssn === "string" && c.ssn.trim() === ssn;
      })
    : undefined;

  const saved = existing
    ? await prisma.cpaReviewRecord.update({
        where: { id: existing.id },
        // Giữ nguyên field cũ (vd năm đã gửi trước đó), chỉ ghi đè/thêm field lần gửi này.
        data: { custom: { ...(existing.custom as Record<string, unknown>), ...custom } as Prisma.InputJsonValue },
      })
    : await prisma.cpaReviewRecord.create({
        data: { month, custom: custom as unknown as Prisma.InputJsonValue, sortOrder: await nextAppendCpaReviewSortOrder(month) },
      });
  const record = toCpaReviewRecord(saved);
  after(() => syncRecordToCpaReviewSheet(record));
  await broadcastCpaReviewChanged(record.id, request.headers.get("x-pusher-socket-id"));

  const updated = await prisma.case.update({ where: { id }, data: { cpaReviewTestSentAt: new Date() } });
  return NextResponse.json({ ok: true, cpaReviewTestSentAt: updated.cpaReviewTestSentAt!.toISOString(), record });
}
