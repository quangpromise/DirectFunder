import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { sanitizeRuleHtml, stripHtmlTags } from "@/lib/rich-text";
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

  const body = (await request.json().catch(() => null)) as { content?: string } | null;
  const content = body?.content ? sanitizeRuleHtml(body.content) : "";
  if (stripHtmlTags(content) === "") {
    return NextResponse.json({ error: "Nội dung rule không được để trống" }, { status: 400 });
  }

  const row = await prisma.rule.update({ where: { id }, data: { content } });
  return NextResponse.json(toRuleRecord(row));
}

/** "Xoá" 1 rule — soft delete (đánh dấu deletedAt/deletedBy), KHÔNG xoá hẳn khỏi DB, để
 * đúng yêu cầu "vẫn hiện, đẩy xuống cuối, gạch ngang chữ" thay vì ẩn đi. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/rules/[id]">) {
  const auth = await requireManageRules();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const row = await prisma.rule.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: auth.me.id } });
  return NextResponse.json(toRuleRecord(row));
}
