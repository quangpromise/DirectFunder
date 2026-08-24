import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { parseMyNotesData, sanitizeMyNotesData, serializeMyNotesData } from "@/lib/my-notes";

/**
 * "My Notes" — ghi chú cá nhân rich text, chỉ chính chủ tài khoản đọc/sửa được (thêm
 * 2026-08-23, thêm nhiều tab 2026-08-24). CỐ Ý là route riêng, KHÔNG gộp vào GET /api/users hay
 * PATCH /api/users/[id] — danh sách users trả về cho MỌI user xem (để gán việc), nếu nhét
 * `myNotesHtml` vào đó sẽ lộ ghi chú riêng tư của người khác. Route này luôn thao tác trên
 * `me.id`, không nhận `id` từ client nên không có đường nào đọc/sửa note của tài khoản khác.
 *
 * Vẫn lưu trong ĐÚNG cột `User.myNotesHtml` cũ (String?, không đổi schema) — nội dung lưu giờ
 * là JSON.stringify(MyNotesData) thay vì raw HTML, xem src/lib/my-notes.ts cho cơ chế nhận
 * diện + bọc dữ liệu CŨ (raw HTML 1 ghi chú, trước khi có tab) thành tab đầu tiên.
 */
export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: me.id }, select: { myNotesHtml: true } });
  return NextResponse.json(parseMyNotesData(user?.myNotesHtml ?? null));
}

export async function PATCH(request: Request) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });
  }

  const cleaned = sanitizeMyNotesData(body);
  await prisma.user.update({ where: { id: me.id }, data: { myNotesHtml: serializeMyNotesData(cleaned) } });
  return NextResponse.json({ ok: true, ...cleaned });
}
