import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { appendRowToSheet, GoogleAuthExpiredError, type CellWrite } from "@/lib/google-sheets";
import { getColumnValue, SEND_DATE_COLUMN_ID } from "@/lib/sheet-row-columns";
import { formatDateValue, todayIsoDate } from "@/lib/date-format";
import { buildMonthYear } from "@/lib/month-year";
import { toCaseRecord } from "@/app/api/cases/route";
import type { ColumnDef, FeaturePermissions, GoogleSheetConfig } from "@/lib/types";

/** Đẩy 1 dòng dữ liệu hồ sơ vào tab tháng hiện tại của Google Sheet chung — chỉ cho hồ sơ
 * đang ở trạng thái "cpa_review" (nút Send ở cột Status chỉ hiện trong trạng thái này).
 * Lưu `sheetSentAt` xuống bảng Case (gửi thật hoặc "Mark as sent" thủ công đều lưu) để
 * nút Send giữ đúng trạng thái xanh (đã gửi) qua reload/deploy lại — trước đây chỉ lưu ở
 * React state nên mất ngay khi F5. `clear: true` (bấm "muốn gửi lại") xoá lại giá trị này.
 * Auth Google Sheets là OAuth2 THEO TỪNG USER (googleRefreshToken trên User), không phải
 * 1 service account chung — 2 nhánh manual/clear không đụng gì tới Google cả, chỉ ghi DB. */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/send-to-sheet">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  // reviewYears: (các) năm CPA Review người dùng chọn ở popup trước khi Send — CHỌN ĐƯỢC
  // NHIỀU NĂM cùng lúc (xem SendToSheetButton) — chỉ dùng cho cột ảo
  // CPA_REVIEW_MONEY_COLUMN_ID (giá trị = TỔNG refund các năm đã chọn), optional vì
  // request cũ/hồ sơ không dùng cột này vẫn gửi được bình thường.
  // manual: bấm "Mark as sent" (đã gửi qua đường khác, KHÔNG gọi Google Sheets API thật).
  // clear: bấm xác nhận "muốn gửi lại" (xoá sheetSentAt, không gọi Google Sheets API).
  const body = await request.json().catch(() => ({}));
  const reviewYears = Array.isArray(body?.reviewYears) ? body.reviewYears.filter((y: unknown) => typeof y === "string") : undefined;
  const manual = body?.manual === true;
  const clear = body?.clear === true;

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

  if (clear) {
    const updated = await prisma.case.update({ where: { id }, data: { sheetSentAt: null } });
    return NextResponse.json({ ok: true, sheetSentAt: updated.sheetSentAt });
  }
  if (manual) {
    const updated = await prisma.case.update({ where: { id }, data: { sheetSentAt: new Date() } });
    return NextResponse.json({ ok: true, sheetSentAt: updated.sheetSentAt!.toISOString() });
  }

  const sheetConfig = config?.googleSheetConfig as unknown as GoogleSheetConfig | null;
  // `?? []`: phòng cấu hình cũ còn sót lại từ trước khi đổi sang columnMappings (thiết kế
  // dùng columnIds trước đây) — tránh crash khi field mới chưa tồn tại trên bản ghi cũ,
  // coi như chưa cấu hình thay vì lỗi 500.
  if (!sheetConfig?.sheetId || (sheetConfig.columnMappings ?? []).length === 0) {
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
  // Chỉ tạo 1 ô ghi cho ĐÚNG cột Admin đã gán (sheetColumn) — cột nào không có trong
  // columnMappings (dù nằm giữa 2 cột khác có mapping) tuyệt đối không được đưa vào
  // `cells`, nên appendRowToSheet không bao giờ động tới, an toàn cho dropdown/công thức
  // Admin đã cấu hình sẵn ở các cột đó trên Sheet thật.
  const cells: CellWrite[] = sheetConfig.columnMappings.map(({ colId, sheetColumn }) => {
    if (colId === SEND_DATE_COLUMN_ID) {
      return { column: sheetColumn, value: formatDateValue(todayIsoDate(), dateFormat) };
    }
    const col =
      columnById.get(colId) ?? ({ id: colId, key: colId, label: "", type: "text", editableBy: [] } as ColumnDef);
    const value = getColumnValue(caseRecord, col, "vi", dateFormat, reviewYears);
    // Client Name có Liên kết đính kèm (nút icon link cạnh tên trên bảng chính) -> ghi
    // dạng công thức HYPERLINK để tên trên Google Sheet cũng bấm được thẳng vào link đó,
    // giống hệt hành vi trên bảng chính — chỉ cột clientName mới cần công thức, mọi cột
    // khác vẫn ghi RAW như cũ (xem writeCells).
    if (colId === "clientName" && caseRecord.clientLink && typeof value === "string" && value) {
      const escapedUrl = caseRecord.clientLink.replace(/"/g, '""');
      const escapedLabel = value.replace(/"/g, '""');
      return { column: sheetColumn, value: `=HYPERLINK("${escapedUrl}","${escapedLabel}")`, isFormula: true };
    }
    return { column: sheetColumn, value };
  });

  try {
    await appendRowToSheet({
      refreshToken: userWithToken.googleRefreshToken,
      sheetId: sheetConfig.sheetId,
      tabName: buildMonthYear(new Date()),
      cells,
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

  const updated = await prisma.case.update({ where: { id }, data: { sheetSentAt: new Date() } });
  return NextResponse.json({ ok: true, sheetSentAt: updated.sheetSentAt!.toISOString() });
}
