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

export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  // Rule còn hiệu lực (deletedAt null) lên trước, mới nhất trước; rule đã xoá dồn xuống
  // cuối — sort thật ở client (sortRulesForDisplay, lib/rules.ts) vì Prisma orderBy theo
  // nulls-first chỉ xếp đúng thứ 2 nhóm, không tự xếp lại thứ tự bên trong từng nhóm theo
  // đúng ý muốn ở mọi trường hợp; lấy hết rồi để store/UI tự sort là đơn giản/rõ ràng hơn.
  const rows = await prisma.rule.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(rows.map(toRuleRecord));
}

export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "manageRules", me.role)) {
    return NextResponse.json({ error: "Không có quyền thêm rule" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { content?: string } | null;
  // sanitizeRuleHtml là nguồn xử lý CHÍNH (client cũng gọi lại để hiển thị ngay, nhưng
  // không được tin — mọi request có thể tới thẳng API, không qua UI) — chỉ giữ lại tag/
  // attribute RichTextEditor có thể sinh ra (b/i/span style font-family.../font face...),
  // loại bỏ mọi HTML khác kể cả script/event handler.
  const content = body?.content ? sanitizeRuleHtml(body.content) : "";
  if (stripHtmlTags(content) === "") {
    return NextResponse.json({ error: "Nội dung rule không được để trống" }, { status: 400 });
  }

  const row = await prisma.rule.create({ data: { content, createdBy: me.id } });
  return NextResponse.json(toRuleRecord(row), { status: 201 });
}
