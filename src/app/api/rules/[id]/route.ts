import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { sanitizeRuleHtml, stripHtmlTags } from "@/lib/rich-text";
import { appendRemovedDiff, stripRemovedDiffMarkers } from "@/lib/rule-diff";
import { broadcastRulesChanged } from "@/lib/pusher-server";
import type { FeaturePermissions, RuleRecord } from "@/lib/types";

function toRuleRecord(row: {
  id: string;
  content: string;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
}): RuleRecord {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    deletedBy: row.deletedBy,
  };
}

async function requireManageRules(): Promise<
  { ok: true; me: NonNullable<Awaited<ReturnType<typeof requireUser>>> } | { ok: false; response: NextResponse }
> {
  const me = await requireUser();
  if (!me) return { ok: false, response: NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 }) };
  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "manageRules", me.role)) {
    return { ok: false, response: NextResponse.json({ error: "Không có quyền sửa/xoá rule" }, { status: 403 }) };
  }
  return { ok: true, me };
}

/** Sửa nội dung 1 rule — theo quyền `manageRules` (trang Phân quyền). */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/rules/[id]">) {
  const auth = await requireManageRules();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const existing = await prisma.rule.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Không tìm thấy rule" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { content?: string } | null;
  const raw = body?.content ? sanitizeRuleHtml(body.content) : "";
  if (stripHtmlTags(raw) === "") {
    return NextResponse.json({ error: "Nội dung rule không được để trống" }, { status: 400 });
  }

  // Nội dung nào bị mất so với bản cũ (đã bỏ marker "đã xoá" của lần edit trước, tránh đánh
  // dấu lặp lại) được nối gạch ngang vào cuối — xem appendRemovedDiff (src/lib/rule-diff.ts).
  const merged = appendRemovedDiff(stripRemovedDiffMarkers(existing.content), raw);
  const content = sanitizeRuleHtml(merged);

  const row = await prisma.rule.update({ where: { id }, data: { content } });
  await broadcastRulesChanged(row.id, request.headers.get("x-pusher-socket-id"));
  return NextResponse.json(toRuleRecord(row));
}

/** "Xoá" 1 rule — mặc định soft delete (đánh dấu deletedAt/deletedBy), KHÔNG xoá hẳn khỏi
 * DB, để đúng yêu cầu "vẫn hiện, đẩy xuống cuối, gạch ngang chữ" thay vì ẩn đi.
 *
 * `?hard=1`: xoá VĨNH VIỄN khỏi DB — chỉ áp dụng cho rule ĐÃ soft-delete trước đó (bắt buộc
 * qua 2 bước: xoá mềm rồi mới xoá hẳn, không cho xoá thẳng 1 bước để tránh bấm nhầm mất luôn
 * rule đang hoạt động), và CHỈ role Quản lý (hard-code `role === "manager"`, KHÔNG dùng
 * feature `manageRules` cấu hình được — khác xoá mềm, xoá vĩnh viễn không thể hoàn tác nên
 * không giao được cho role khác qua trang Phân quyền, yêu cầu 2026-08-20). */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/rules/[id]">) {
  const auth = await requireManageRules();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const hard = request.nextUrl.searchParams.get("hard") === "1";
  if (hard) {
    if (auth.me.role !== "manager") {
      return NextResponse.json({ error: "Chỉ Quản lý mới xoá vĩnh viễn được rule" }, { status: 403 });
    }
    const existing = await prisma.rule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Không tìm thấy rule" }, { status: 404 });
    if (!existing.deletedAt) {
      return NextResponse.json({ error: "Chỉ xoá vĩnh viễn được rule đã xoá trước đó" }, { status: 400 });
    }
    await prisma.rule.delete({ where: { id } });
    await broadcastRulesChanged(id, request.headers.get("x-pusher-socket-id"));
    return NextResponse.json({ ok: true });
  }

  const row = await prisma.rule.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: auth.me.id } });
  await broadcastRulesChanged(row.id, request.headers.get("x-pusher-socket-id"));
  return NextResponse.json(toRuleRecord(row));
}
