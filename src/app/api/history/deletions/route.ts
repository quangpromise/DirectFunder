import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import type { CaseRecord, DeletedRowRecord } from "@/lib/types";

function toDeletedRowRecord(row: {
  id: string;
  caseSnapshot: unknown;
  deletedByUserId: string;
  deletedAt: Date;
}): DeletedRowRecord {
  return {
    id: row.id,
    caseSnapshot: row.caseSnapshot as CaseRecord,
    deletedByUserId: row.deletedByUserId,
    deletedAt: row.deletedAt.toISOString(),
  };
}

/** Không lọc theo người xem — MỌI user đăng nhập đều xem được TOÀN BỘ lịch sử xoá hồ sơ
 * (yêu cầu 2026-08-13), cùng nguyên tắc với GET /api/history/edits. */
export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const rows = await prisma.deletedRowEntry.findMany({ orderBy: { deletedAt: "desc" }, take: 500 });
  return NextResponse.json(rows.map(toDeletedRowRecord));
}

/** caseSnapshot do client gửi lên NGUYÊN VẸN CaseRecord vừa bị xoá cục bộ (đã có đủ dữ liệu
 * ngay tại nơi gọi deleteRow trong app-store.ts) — server chỉ ép deletedByUserId về đúng
 * người đang đăng nhập, không tin giá trị client gửi lên cho field này. */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { caseSnapshot } = body ?? {};
  if (!caseSnapshot || typeof caseSnapshot !== "object") {
    return NextResponse.json({ error: "Thiếu dữ liệu hồ sơ đã xoá" }, { status: 400 });
  }

  const row = await prisma.deletedRowEntry.create({
    data: { caseSnapshot, deletedByUserId: me.id },
  });
  return NextResponse.json(toDeletedRowRecord(row), { status: 201 });
}
