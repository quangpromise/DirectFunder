import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { appendRowToSheet, GoogleAuthExpiredError } from "@/lib/google-sheets";
import { getColumnValue, SEND_DATE_COLUMN_ID } from "@/lib/sheet-row-columns";
import { formatDateValue, todayIsoDate } from "@/lib/date-format";
import { buildMonthYear } from "@/lib/month-year";
import { toCaseRecord } from "@/app/api/cases/route";
import type { ColumnDef, FeaturePermissions, GoogleSheetConfig } from "@/lib/types";

/** Đẩy 1 dòng dữ liệu hồ sơ vào tab tháng hiện tại của Google Sheet chung — chỉ cho hồ sơ
 * đang ở trạng thái "cpa_review" (nút Send ở cột Status chỉ hiện trong trạng thái này).
 * KHÔNG ghi gì vào bảng Case, lịch sử chỉ lưu ở Edit History phía client (giống
 * send-cpa-email). Auth Google Sheets là OAuth2 THEO TỪNG USER (googleRefreshToken trên
 * User), không phải 1 service account chung. */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/send-to-sheet">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  // reviewYears: (các) năm CPA Review người dùng chọn ở popup trước khi Send — CHỌN ĐƯỢC
  // NHIỀU NĂM cùng lúc (xem SendToSheetButton) — chỉ dùng cho cột ảo
  // CPA_REVIEW_MONEY_COLUMN_ID (giá trị = TỔNG refund các năm đã chọn), optional vì
  // request cũ/hồ sơ không dùng cột này vẫn gửi được bình thường.
  const body = await request.json().catch(() => ({}));
  const reviewYears = Array.isArray(body?.reviewYears) ? body.reviewYears.filter((y: unknown) => typeof y === "string") : undefined;

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendToGoogleSheet", me.role)) {
    return NextResponse.json({ error: "Không có quyền gửi dữ liệu lên Google Sheet" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const row = await prisma.case.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });
  if (row.status !== "cpa_review") {
    return NextResponse.json({ error: "Hồ sơ không còn ở trạng thái Kế toán duyệt" }, { status: 400 });
  }

  const sheetConfig = config?.googleSheetConfig as unknown as GoogleSheetConfig | null;
  if (!sheetConfig?.sheetId || sheetConfig.columnIds.length === 0) {
    return NextResponse.json({ error: "Admin chưa cấu hình Google Sheet — vào trang Phân quyền để cấu hình" }, { status: 400 });
  }

  const userWithToken = await prisma.user.findUnique({ where: { id: me.id }, select: { googleRefreshToken: true } });
  if (!userWithToken?.googleRefreshToken) {
    return NextResponse.json({ error: "GOOGLE_NOT_CONNECTED" }, { status: 428 });
  }

  const columns = (config?.columns as unknown as ColumnDef[]) ?? [];
  const columnById = new Map(columns.map((c) => [c.id, c]));
  const caseRecord = toCaseRecord(row);
  // Mặc định mm/dd/yy khi Admin chưa từng lưu lựa chọn (googleSheetConfig.dateFormat
  // undefined) — CHỈ áp dụng khi thật sự chưa cấu hình, không ghi đè lựa chọn "iso" Admin
  // đã cố tình chọn (xem GoogleSheetConfigDialog, dropdown cũng mặc định "mdy2" cho khớp).
  const dateFormat = sheetConfig.dateFormat ?? "mdy2";
  const values = sheetConfig.columnIds.map((colId) => {
    if (colId === SEND_DATE_COLUMN_ID) return formatDateValue(todayIsoDate(), dateFormat);
    // Cột ảo (năm refund cụ thể / "Số tiền CPA Review" / "Để trống") không nằm trong
    // AppConfig.columns thật — getColumnValue tự nhận diện qua col.id (xem
    // sheet-row-columns.ts), chỉ cần id đúng là đủ, không cần label/type/editableBy thật.
    // BLANK_COLUMN_ID và mọi id lạ khác cũng rơi vào nhánh này, tự trả "" đúng ý muốn.
    const col = columnById.get(colId) ?? ({ id: colId, key: colId, label: "", type: "text", editableBy: [] } as ColumnDef);
    return getColumnValue(caseRecord, col, "vi", dateFormat, reviewYears);
  });

  try {
    await appendRowToSheet({
      refreshToken: userWithToken.googleRefreshToken,
      sheetId: sheetConfig.sheetId,
      tabName: buildMonthYear(new Date()),
      values,
    });
  } catch (err) {
    if (err instanceof GoogleAuthExpiredError) {
      // Token đã thu hồi/hết hạn — xoá luôn để lần bấm Send kế tiếp phát hiện đúng
      // "chưa kết nối" (428) thay vì thử lại refresh_token đã chết mỗi lần.
      await prisma.user.update({ where: { id: me.id }, data: { googleRefreshToken: null } });
      return NextResponse.json({ error: "GOOGLE_NOT_CONNECTED" }, { status: 428 });
    }
    const message = err instanceof Error ? err.message : "Gửi dữ liệu lên Google Sheet thất bại, thử lại sau.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
