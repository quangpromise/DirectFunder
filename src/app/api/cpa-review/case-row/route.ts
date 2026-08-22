import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";

/**
 * Tra số thứ tự dòng (row, khớp đúng số hiển thị ở cột gutter ngoài cùng trên tab CPA
 * Review — `i + 4`, quy ước hàng 1-3 là header giống Google Sheet thật) của hồ sơ có SSN
 * khớp `?ssn=` — dùng cho popup chọn năm gửi mới ở "Send mail to CPA" (thêm 2026-08-22),
 * điền tự động vào nội dung mail ({cpaReviewRow}) thay vì để trống cho CPA tự tìm.
 *
 * 1 hồ sơ có thể có NHIỀU dòng trên CPA Review (mỗi lần bấm "Test Sheet" tạo 1 dòng mới,
 * không ghi đè) — lấy dòng có `updatedAt` gần đây nhất trong số các dòng khớp SSN, theo
 * đúng lựa chọn đã xác nhận với user. Không lọc theo canViewCase — CPA Review độc lập hoàn
 * toàn với Case (xem GET /api/cpa-review), route này chỉ cần đăng nhập, không cần quyền
 * riêng vì chỉ trả về đúng 1 số row (không lộ dữ liệu CPA Review nào khác).
 */
export async function GET(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const ssnDigits = (request.nextUrl.searchParams.get("ssn") ?? "").replace(/\D/g, "");
  if (!ssnDigits) return NextResponse.json({ found: false });

  const all = await prisma.cpaReviewRecord.findMany({
    select: { id: true, month: true, sortOrder: true, custom: true, updatedAt: true },
  });

  const matches = all.filter((r) => {
    const custom = r.custom as Record<string, unknown> | null;
    const ssnValue = typeof custom?.ssn === "string" ? custom.ssn : "";
    return ssnValue.replace(/\D/g, "").includes(ssnDigits);
  });
  if (matches.length === 0) return NextResponse.json({ found: false });

  matches.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const target = matches[0];

  const monthRows = all.filter((r) => r.month === target.month).sort((a, b) => a.sortOrder - b.sortOrder);
  const index = monthRows.findIndex((r) => r.id === target.id);

  return NextResponse.json(index >= 0 ? { found: true, rowNumber: index + 4, month: target.month } : { found: false });
}
