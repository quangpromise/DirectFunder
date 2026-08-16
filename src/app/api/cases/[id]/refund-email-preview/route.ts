import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { DEFAULT_SUPPORT_PHONE } from "@/lib/client-email-template";
import { buildRefundEmailContent, type RefundEmailLanguage } from "@/lib/refund-notification-email";
import { REFUND_YEARS } from "@/lib/refund";
import { toCaseRecord } from "@/app/api/cases/route";
import type { ClientEmailTemplate, FeaturePermissions } from "@/lib/types";

/** Dựng trước Subject + nội dung HTML (CHƯA gắn chữ ký) cho màn hình "soạn mail" — bấm
 * "Confirm" ở popup chọn năm (SendClientEmailButton) gọi route này để có nội dung điền sẵn
 * trước khi cho sửa tay, KHÔNG lưu/gửi gì cả (không cần đã kết nối webmail). Gửi thật đi
 * qua POST /api/cases/[id]/send-client-email riêng, nhận thẳng subject/bodyHtml đã sửa
 * (nếu có) từ màn hình soạn mail thay vì tự build lại từ template. */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/refund-email-preview">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendClientEmail", me.role)) {
    return NextResponse.json({ error: "Không có quyền gửi email cho khách hàng" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as
    | { years?: string[]; language?: RefundEmailLanguage; taxInt?: Record<string, string> }
    | null;
  const years = (body?.years ?? []).filter((y): y is string => REFUND_YEARS.includes(y as (typeof REFUND_YEARS)[number]));
  if (years.length === 0) {
    return NextResponse.json({ error: "Chưa chọn năm nào" }, { status: 400 });
  }
  const language: RefundEmailLanguage = body?.language === "en" ? "en" : "vi";
  const taxIntInput = body?.taxInt ?? {};

  const row = await prisma.case.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });

  // Merge giống hệt bước lưu thật (send-client-email/route.ts) để preview khớp đúng số
  // liệu SẼ được lưu — nhưng CHỈ dùng để build nội dung, không ghi xuống DB ở route này.
  const existingTaxInt = (row.taxIntByYear as Record<string, string> | null) ?? {};
  const mergedTaxInt: Record<string, string> = { ...existingTaxInt };
  for (const year of years) {
    if (year in taxIntInput) mergedTaxInt[year] = taxIntInput[year];
  }

  const caseRecord = toCaseRecord(row);
  const templateConfig = config?.clientEmailTemplate as unknown as ClientEmailTemplate | null;

  const userWithCreds = await prisma.user.findUnique({ where: { id: me.id }, select: { webmailUsername: true } });

  const content = buildRefundEmailContent({
    caseRecord,
    years,
    taxIntByYear: mergedTaxInt,
    language,
    senderName: me.name,
    senderEmail: userWithCreds?.webmailUsername || me.email,
    supportPhone: templateConfig?.supportPhone?.trim() || DEFAULT_SUPPORT_PHONE,
    subjectTemplate: language === "vi" ? templateConfig?.subjectTemplateVi : templateConfig?.subjectTemplateEn,
    bodyTemplate: language === "vi" ? templateConfig?.bodyTemplateVi : templateConfig?.bodyTemplateEn,
    breakdownLabels: {
      taxCredit: templateConfig?.breakdownTaxCreditLabel,
      taxInt: templateConfig?.breakdownTaxIntLabel,
      estimated: templateConfig?.breakdownEstimatedLabel,
    },
  });

  // To/Cc mặc định — người dùng có thể sửa tay ở màn hình soạn mail trước khi gửi thật
  // (thêm 2026-08-16). To mặc định lấy email hồ sơ; Cc mặc định = Cc Admin đã cấu hình +
  // chính email webmail người gửi (giống logic cc trong send-client-email/route.ts).
  const to = row.email?.trim() ? [row.email.trim()] : [];
  const senderEmail = userWithCreds?.webmailUsername;
  const ccBase = templateConfig?.cc ?? [];
  const cc = senderEmail ? Array.from(new Set([...ccBase, senderEmail])) : ccBase;

  return NextResponse.json({ ...content, to, cc });
}
