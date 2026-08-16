import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { isValidMonthKey } from "@/lib/cpa-review-month";
import type { FeaturePermissions } from "@/lib/types";

/** GET ?month=YYYY-MM — bảng tổng hợp cho Processor Leader/Quản lý: toàn bộ
 * ProcessorReportMonthlySummary của tháng đó (đọc cache, không tính lại) + danh sách tài
 * khoản role "processor" hiện có (để render cột). */
export async function GET(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "viewForProcessor", me.role)) {
    return NextResponse.json({ error: "Không có quyền truy cập" }, { status: 403 });
  }

  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!isValidMonthKey(month)) return NextResponse.json({ error: "Tháng không hợp lệ" }, { status: 400 });

  const [entries, processors] = await Promise.all([
    prisma.processorReportMonthlySummary.findMany({ where: { month } }),
    prisma.user.findMany({ where: { role: "processor" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return NextResponse.json({ entries, processors });
}
