import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import type { EditHistoryRecord } from "@/lib/types";

function toEditHistoryRecord(row: {
  id: string;
  caseId: string;
  ssn: string | null;
  clientName: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
  editedByUserId: string;
  editedAt: Date;
}): EditHistoryRecord {
  return {
    id: row.id,
    caseId: row.caseId,
    ssn: row.ssn,
    clientName: row.clientName,
    fieldLabel: row.fieldLabel,
    oldValue: row.oldValue,
    newValue: row.newValue,
    editedByUserId: row.editedByUserId,
    editedAt: row.editedAt.toISOString(),
  };
}

/** Không lọc theo người xem — MỌI user đăng nhập đều xem được TOÀN BỘ lịch sử chỉnh sửa
 * (yêu cầu 2026-08-13), không giới hạn chỉ thấy thay đổi của chính mình. */
export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const rows = await prisma.editHistoryEntry.findMany({ orderBy: { editedAt: "desc" }, take: 1000 });
  return NextResponse.json(rows.map(toEditHistoryRecord));
}

/** Client tự tính oldValue/newValue (đã biết rõ nhất giá trị trước/sau ngay tại nơi gọi
 * action, xem logEdit trong app-store.ts) — server chỉ ghi lại + ép editedByUserId về đúng
 * người đang đăng nhập (không tin giá trị client gửi lên cho field này). */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { caseId, ssn, clientName, fieldLabel, oldValue, newValue } = body ?? {};
  if (!caseId || !fieldLabel) {
    return NextResponse.json({ error: "Thiếu dữ liệu lịch sử chỉnh sửa" }, { status: 400 });
  }

  const row = await prisma.editHistoryEntry.create({
    data: {
      caseId: String(caseId),
      ssn: typeof ssn === "string" ? ssn : null,
      clientName: String(clientName ?? ""),
      fieldLabel: String(fieldLabel),
      oldValue: String(oldValue ?? ""),
      newValue: String(newValue ?? ""),
      editedByUserId: me.id,
    },
  });
  return NextResponse.json(toEditHistoryRecord(row), { status: 201 });
}
