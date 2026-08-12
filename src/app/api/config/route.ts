import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import type { FeaturePermissions } from "@/lib/types";
import type { Prisma } from "@prisma/client";

export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  if (!config) return NextResponse.json({ error: "Chưa có cấu hình" }, { status: 404 });
  return NextResponse.json({
    columns: config.columns,
    featurePermissions: config.featurePermissions,
    cpaEmailDefaults: config.cpaEmailDefaults,
    // Chỉ đọc, không qua PUT — tài khoản Gmail dùng để gửi luôn hiện công khai ở "From"
    // của mọi mail đã gửi nên không phải bí mật, dùng làm fallback nếu {senderName}
    // (tên người dùng đang đăng nhập — xem cases/page.tsx) không có sẵn.
    cpaSenderEmail: process.env.GMAIL_USER ?? null,
    googleSheetConfig: config.googleSheetConfig,
    clientEmailTemplate: config.clientEmailTemplate,
    refundYearStatusOptions: config.refundYearStatusOptions,
    collectingColumns: config.collectingColumns,
  });
}

/** 2 cột Status riêng của tab Order (Order 8821 / Order TTS & WIT) — Support được cấp
 * quyền quản lý toàn bộ danh sách trạng thái (thêm/sửa/xóa/đổi màu) qua ColumnSettingsDialog
 * dù không có quyền "editColumn" đầy đủ (xem orders/page.tsx canManageOptions). Chỉ cho
 * phép PUT khi request KHÔNG phải manager nếu nó thực sự chỉ đổi "options" của 2 cột này,
 * mọi thứ khác (tên cột, quyền sửa theo role, featurePermissions, cột khác) phải giữ
 * nguyên y hệt bản trên server — tránh 1 request giả mạo từ tài khoản Support đổi được
 * cấu hình ngoài phạm vi 2 cột Status của tab Order. */
const ORDER_STATUS_COLUMN_IDS = new Set(["orderStatusOrder8821", "orderStatusOrderTtsWit"]);

function isOrderStatusOptionsOnlyChange(
  before: unknown,
  after: unknown,
  featurePermsBefore: unknown,
  featurePermsAfter: unknown,
  role: string
): boolean {
  if (JSON.stringify(featurePermsBefore) !== JSON.stringify(featurePermsAfter)) return false;
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return false;
  for (let i = 0; i < before.length; i++) {
    const b = before[i] as Record<string, unknown>;
    const a = after[i] as Record<string, unknown>;
    if (!b || !a || b.id !== a.id) return false;
    if (ORDER_STATUS_COLUMN_IDS.has(b.id as string)) {
      const editableBy = Array.isArray(b.editableBy) ? (b.editableBy as string[]) : [];
      if (!editableBy.includes(role)) return false;
      const { options: bOptions, ...bRest } = b;
      const { options: aOptions, ...aRest } = a;
      void bOptions;
      void aOptions;
      if (JSON.stringify(bRest) !== JSON.stringify(aRest)) return false;
    } else if (JSON.stringify(b) !== JSON.stringify(a)) {
      return false;
    }
  }
  return true;
}

/** Quản lý (manager) sửa toàn bộ cấu hình. Vai trò khác chỉ được PUT nếu thay đổi nằm
 * gọn trong "options" của 2 cột Status thuộc tab Order — xem isOrderStatusOptionsOnlyChange. */
export async function PUT(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.columns || !body?.featurePermissions) {
    return NextResponse.json({ error: "Thiếu columns hoặc featurePermissions" }, { status: 400 });
  }

  // Nạp existing sớm và luôn luôn (kể cả role manager) — vừa dùng cho carve-out order-status
  // ở role khác, vừa dùng để kiểm tra quyền addCollectingColumn/editCollectingColumn bên
  // dưới (áp dụng cho MỌI role, kể cả manager vì đơn giản đọc code hơn dùng lại 1 nguồn).
  const existing = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  if (!existing) return NextResponse.json({ error: "Chưa có cấu hình" }, { status: 404 });

  if (me.role !== "manager") {
    const allowed = isOrderStatusOptionsOnlyChange(
      existing.columns,
      body.columns,
      existing.featurePermissions,
      body.featurePermissions,
      me.role
    );
    if (!allowed) return NextResponse.json({ error: "Không có quyền sửa cấu hình" }, { status: 403 });
  }

  // cpaEmailDefaults là field độc lập, riêng biệt với cụm columns/featurePermissions ở
  // trên (không đi qua isOrderStatusOptionsOnlyChange) — chỉ manager mới được set, role
  // khác gửi kèm field này thì âm thầm bỏ qua (không set, không 403 cả request) vì
  // columns/featurePermissions của họ (nhánh order-status-options-only) vẫn hợp lệ.
  const data: Prisma.AppConfigUpdateInput = {
    columns: body.columns,
    featurePermissions: body.featurePermissions,
  };
  if (me.role === "manager" && "cpaEmailDefaults" in body) {
    data.cpaEmailDefaults = body.cpaEmailDefaults;
  }
  if (me.role === "manager" && "googleSheetConfig" in body) {
    data.googleSheetConfig = body.googleSheetConfig;
  }
  if (me.role === "manager" && "clientEmailTemplate" in body) {
    data.clientEmailTemplate = body.clientEmailTemplate;
  }
  // Option id "pending" gắn liền logic nhấp nháy đỏ + ô nhập lý do ở client
  // (hasPendingRefundYear, src/lib/refund-status.ts) — chặn ở server để không thể xoá dù
  // request PUT bị chỉnh tay bỏ qua guard phía client (removeRefundYearStatusOption).
  if (me.role === "manager" && "refundYearStatusOptions" in body) {
    const options = body.refundYearStatusOptions;
    const hasPending = Array.isArray(options) && options.some((o: { id?: unknown }) => o?.id === "pending");
    if (Array.isArray(options) && !hasPending) {
      return NextResponse.json({ error: "Không thể xoá trạng thái hệ thống 'pending'" }, { status: 400 });
    }
    data.refundYearStatusOptions = options;
  }
  // collectingColumns KHÁC các field "chỉ manager" ở trên — cho phép cả role được cấp
  // addCollectingColumn/editCollectingColumn qua trang Phân quyền (tab Collecting dùng
  // đúng cơ chế ColumnSettingsDialog như bảng Hồ sơ, không nên khoá cứng cho riêng manager).
  // Dùng featurePermissions HIỆN CÓ trên server (existing), không tin body.featurePermissions
  // gửi lên (role không phải manager không sửa được featurePermissions nên existing luôn
  // đúng nguồn thật).
  if (
    "collectingColumns" in body &&
    (hasFeature(existing.featurePermissions as FeaturePermissions, "editCollectingColumn", me.role) ||
      hasFeature(existing.featurePermissions as FeaturePermissions, "addCollectingColumn", me.role))
  ) {
    data.collectingColumns = body.collectingColumns;
  }

  const config = await prisma.appConfig.update({
    where: { id: "singleton" },
    data,
  });
  return NextResponse.json({
    columns: config.columns,
    featurePermissions: config.featurePermissions,
    cpaEmailDefaults: config.cpaEmailDefaults,
    googleSheetConfig: config.googleSheetConfig,
    clientEmailTemplate: config.clientEmailTemplate,
    refundYearStatusOptions: config.refundYearStatusOptions,
    collectingColumns: config.collectingColumns,
  });
}
