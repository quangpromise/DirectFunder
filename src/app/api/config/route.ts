import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";

export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  if (!config) return NextResponse.json({ error: "Chưa có cấu hình" }, { status: 404 });
  return NextResponse.json({ columns: config.columns, featurePermissions: config.featurePermissions });
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

  if (me.role !== "manager") {
    const existing = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
    if (!existing) return NextResponse.json({ error: "Chưa có cấu hình" }, { status: 404 });
    const allowed = isOrderStatusOptionsOnlyChange(
      existing.columns,
      body.columns,
      existing.featurePermissions,
      body.featurePermissions,
      me.role
    );
    if (!allowed) return NextResponse.json({ error: "Không có quyền sửa cấu hình" }, { status: 403 });
  }

  const config = await prisma.appConfig.update({
    where: { id: "singleton" },
    data: { columns: body.columns, featurePermissions: body.featurePermissions },
  });
  return NextResponse.json({ columns: config.columns, featurePermissions: config.featurePermissions });
}
