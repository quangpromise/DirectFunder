import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { syncRecordToCpaReviewSheet, nextAppendCpaReviewSortOrder } from "@/lib/cpa-review-sheet-sync";
import { broadcastCpaReviewChanged } from "@/lib/pusher-server";
import { isValidMonthKey, currentMonthKey } from "@/lib/cpa-review-month";
import type { CpaReviewRecord, FeaturePermissions } from "@/lib/types";
import type { Prisma } from "@prisma/client";

export function toCpaReviewRecord(row: {
  id: string;
  month: string;
  custom: Prisma.JsonValue;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): CpaReviewRecord {
  return {
    id: row.id,
    month: row.month,
    custom: (row.custom as unknown as CpaReviewRecord["custom"]) ?? {},
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Không lọc theo canViewCase — bảng "CPA Review" độc lập hoàn toàn với Case, không có
 * khái niệm "hồ sơ của riêng ai" (đúng yêu cầu 2026-08-14 "không liên kết bất cứ gì"), mọi
 * user đã đăng nhập có quyền viewCpaReview xem được toàn bộ.
 *
 * `?month=YYYY-MM` (thêm 2026-08-16, giảm payload) — UI chỉ bao giờ hiện đúng 1 tháng tại 1
 * thời điểm (CpaReviewMonthPicker) nhưng trước đây route này luôn trả về TOÀN BỘ mọi tháng
 * từng tạo, phình to không giới hạn theo thời gian. Không bắt buộc — thiếu/không hợp lệ vẫn
 * trả về tất cả (giữ tương thích ngược cho bất kỳ nơi gọi nào chưa truyền tham số này). */
export async function GET(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const monthParam = request.nextUrl.searchParams.get("month");
  const month = monthParam && isValidMonthKey(monthParam) ? monthParam : undefined;
  const rows = await prisma.cpaReviewRecord.findMany({
    where: month ? { month } : undefined,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(rows.map(toCpaReviewRecord));
}

export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "addCpaReviewRow", me.role)) {
    return NextResponse.json({ error: "Không có quyền thêm dòng" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Partial<CpaReviewRecord> | null;
  const month = body?.month && isValidMonthKey(body.month) ? body.month : currentMonthKey();
  // sortOrder LUÔN tự tính ở server (nối vào cuối bảng) — bỏ qua giá trị client gửi lên
  // (dòng optimistic client-side chỉ cần hiển thị tạm, sẽ bị thay bằng dòng server trả về).
  const row = await prisma.cpaReviewRecord.create({
    data: {
      id: body?.id,
      month,
      custom: (body?.custom ?? {}) as unknown as Prisma.InputJsonValue,
      sortOrder: await nextAppendCpaReviewSortOrder(month),
    },
  });
  const record = toCpaReviewRecord(row);
  // Đẩy nền lên Sheet "CPA Review" nếu đã kết nối — không chặn response chính (xem
  // deployment-database-sync.md mục 4.22).
  after(() => syncRecordToCpaReviewSheet(record));
  await broadcastCpaReviewChanged(record.id, request.headers.get("x-pusher-socket-id"));

  return NextResponse.json(record, { status: 201 });
}
