import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { extractSheetId, extractGid } from "@/lib/sheet-id";
import { GoogleAuthExpiredError } from "@/lib/google-sheets";
import {
  getOwnReportSheetConfigMap,
  saveOwnReportSheetConfigMap,
  connectOwnReportSheet,
  resyncOwnReportSheet,
  SheetNotAccessibleError,
  mapSheetsError,
  DAY_COL_OFFSET,
} from "@/lib/processor-own-report-sheet-sync";
import { isValidMonthKey } from "@/lib/cpa-review-month";

function buildWebhookUrl(request: NextRequest): string {
  return new URL("/api/processor-own-report-sheet/webhook", request.nextUrl.origin).toString();
}

/** Apps Script tự dán vào Sheet RIÊNG của Processor — đơn giản hơn CPA Review (không cần
 * LockService, vì mỗi ô (task, ngày) chỉ upsert theo vị trí cố định, không có rủi ro tạo
 * record trùng như CPA Review dò theo business key). Vẫn lặp qua CẢ vùng e.range (nhiều
 * dòng/cột cùng lúc — paste/xoá hàng loạt) thay vì chỉ ô đầu tiên, đúng quy tắc đã rút ra ở
 * deployment-database-sync.md mục 4.47/workflow-conventions.md (bôi đen nhiều dòng phải đồng
 * bộ đủ, không chỉ dòng/ô đầu).
 *
 * `tabName` guard — Apps Script BOUND VÀO CẢ FILE Spreadsheet, không phải riêng 1 tab, nên
 * sửa/dán dữ liệu ở BẤT KỲ tab nào khác trong cùng file (vd tháng khác, tab nháp riêng của
 * Processor) vẫn kích hoạt trigger này nếu thiếu guard — ĐÚNG bug nghiêm trọng đã gặp với CPA
 * Review (xem deployment-database-sync.md mục 4.51, dữ liệu tab khác bị đồng bộ nhầm thành
 * tháng đang kết nối), phát hiện lại đúng lỗi này ở bảng cá nhân For Processor (2026-09-02) —
 * vá bằng cách chặn ngay đầu nếu tab vừa sửa không khớp `tabName` đã kết nối. */
function buildAppsScript(webhookUrl: string, secret: string, tabName: string): string {
  return `function onOwnReportEdit(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() !== "${tabName}") return; // chỉ đồng bộ đúng tab đã kết nối, bỏ qua tab khác trong cùng file
  var startRow = e.range.getRow();
  var numRows = e.range.getNumRows();
  var startCol = e.range.getColumn() - 1; // 0-based, cột A = 0
  var numCols = e.range.getNumColumns();
  var cells = [];
  for (var r = 0; r < numRows; r++) {
    var row = startRow + r;
    if (row < 2) continue; // dòng 1 = header, không đồng bộ
    for (var c = 0; c < numCols; c++) {
      var col = startCol + c;
      if (col <= ${DAY_COL_OFFSET}) continue; // cột A-H không đồng bộ (ngày bắt đầu từ cột I)
      var v = sheet.getRange(row, col + 1).getValue();
      cells.push({ row: row, col: col, rawValue: (v === "" || v === null || v === undefined) ? "" : String(v) });
    }
  }
  if (cells.length === 0) return;
  UrlFetchApp.fetch("${webhookUrl}", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ secret: "${secret}", cells: cells })
  });
}

function installOwnReportTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) ScriptApp.deleteTrigger(triggers[i]);
  ScriptApp.newTrigger("onOwnReportEdit").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
}`;
}

/** Chỉ chính CHỦ TÀI KHOẢN (role processor) tự kết nối Sheet RIÊNG của họ — không phải tính
 * năng Admin/Leader cấu hình hộ như CPA Review/bảng Report tổng hợp, nên không cần feature
 * permission riêng, chỉ cần đăng nhập đúng role processor. */
async function requireOwnAccess() {
  const me = await requireUser();
  if (!me) return { error: NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 }) } as const;
  if (me.role !== "processor") {
    return { error: NextResponse.json({ error: "Chỉ tài khoản Processor mới có bảng cá nhân để đồng bộ" }, { status: 403 }) } as const;
  }
  return { me } as const;
}

/** GET ?month=YYYY-MM — appsScript build lại từ secret đã lưu nếu tháng này đã kết nối (cho
 * phép lấy lại script bất kỳ lúc nào mà không cần ngắt kết nối, giống cơ chế CPA Review).
 * Không còn trả email Service Account (đã đổi hẳn sang OAuth2 theo user — xem
 * processor-own-report-sheet-sync.ts) — field `serviceAccountConfigured`/`serviceAccountEmail`
 * cũ đã bỏ, thay bằng `googleConnected` (user đã kết nối Google cá nhân hay chưa). */
export async function GET(request: NextRequest) {
  const auth = await requireOwnAccess();
  if ("error" in auth) return auth.error;
  const { me } = auth;

  const user = await prisma.user.findUnique({ where: { id: me.id }, select: { googleRefreshToken: true } });

  const month = request.nextUrl.searchParams.get("month") ?? "";
  let appsScript: string | null = null;
  let config: { sheetId: string; gid: string; tabName: string; connectedAt: string } | null = null;
  if (isValidMonthKey(month)) {
    const map = await getOwnReportSheetConfigMap(me.id);
    const existing = map[month];
    if (existing?.sheetId) {
      appsScript = buildAppsScript(buildWebhookUrl(request), existing.webhookSecret, existing.tabName);
      config = { sheetId: existing.sheetId, gid: existing.gid, tabName: existing.tabName, connectedAt: existing.connectedAt };
    }
  }

  return NextResponse.json({
    googleConnected: Boolean(user?.googleRefreshToken),
    appsScript,
    config,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireOwnAccess();
  if ("error" in auth) return auth.error;
  const { me } = auth;

  const body = await request.json().catch(() => ({}));
  const action = body?.action === "resync" ? "resync" : "connect";
  const month = typeof body?.month === "string" ? body.month : "";
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: "Tháng không hợp lệ" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: me.id }, select: { googleRefreshToken: true } });
  if (!user?.googleRefreshToken) {
    return NextResponse.json({ error: "GOOGLE_NOT_CONNECTED" }, { status: 428 });
  }

  try {
    if (action === "connect") {
      const link = typeof body?.link === "string" ? body.link.trim() : "";
      if (!link) return NextResponse.json({ error: "Thiếu link Google Sheet" }, { status: 400 });
      const sheetId = extractSheetId(link);
      const gid = extractGid(link) ?? "0";
      const webhookSecret = randomBytes(24).toString("hex");
      const newConfig = await connectOwnReportSheet(me.id, month, sheetId, gid, webhookSecret, user.googleRefreshToken);

      const map = await getOwnReportSheetConfigMap(me.id);
      await saveOwnReportSheetConfigMap(me.id, { ...map, [month]: newConfig });

      return NextResponse.json({
        ok: true,
        month,
        sheetId,
        gid,
        tabName: newConfig.tabName,
        webhookUrl: buildWebhookUrl(request),
        appsScript: buildAppsScript(buildWebhookUrl(request), webhookSecret, newConfig.tabName),
      });
    }

    await resyncOwnReportSheet(me.id, month, user.googleRefreshToken);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[processor-own-report-sheet connect/resync] thất bại:", err);
    if (err instanceof GoogleAuthExpiredError) {
      // Token đã thu hồi/hết hạn — xoá luôn để lần bấm kế tiếp phát hiện đúng "chưa kết nối"
      // (428) thay vì thử lại refresh_token đã chết mỗi lần (cùng pattern send-to-sheet route).
      await prisma.user.update({ where: { id: me.id }, data: { googleRefreshToken: null } });
      return NextResponse.json({ error: "GOOGLE_NOT_CONNECTED" }, { status: 428 });
    }
    if (err instanceof SheetNotAccessibleError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: mapSheetsError(err) }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireOwnAccess();
  if ("error" in auth) return auth.error;
  const { me } = auth;

  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!isValidMonthKey(month)) return NextResponse.json({ error: "Tháng không hợp lệ" }, { status: 400 });

  const map = await getOwnReportSheetConfigMap(me.id);
  if (month in map) {
    const next = { ...map };
    delete next[month];
    await saveOwnReportSheetConfigMap(me.id, next);
  }
  return NextResponse.json({ ok: true });
}
