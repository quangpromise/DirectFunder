import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { extractSheetId, extractGid } from "@/lib/sheet-id";
import { getServiceAccountSheetsClient, isServiceAccountConfigured, ServiceAccountNotConfiguredError } from "@/lib/google-service-account";
import {
  resolveTabNameFromGid,
  importSheetRows,
  scanDistinctNames,
  resyncAllRecordsToSheet,
  getCpaReviewSheetConfigMap,
  saveCpaReviewSheetConfigMap,
  mapSheetsError,
  SheetNotAccessibleError,
  ensureSheetGridSize,
  CPA_REVIEW_MIN_GRID,
} from "@/lib/cpa-review-sheet-sync";
import { yearNoteColumnIndex } from "@/lib/cpa-review-sheet-columns";
import { CPA_REVIEW_YEARS } from "@/lib/cpa-review-columns";
import { isValidMonthKey } from "@/lib/cpa-review-month";
import type { CpaReviewSheetConfig, FeaturePermissions } from "@/lib/types";

function buildWebhookUrl(request: NextRequest): string {
  return new URL("/api/cpa-review-sheet/webhook", request.nextUrl.origin).toString();
}

/** Chỉ số cột 1-based (Apps Script Range) ô "Ngày" mỗi năm — dùng để quét Note định kỳ.
 * Tính từ CHÍNH mapping cột thật app đang dùng (yearNoteColumnIndex, 0-based) thay vì hard-
 * code lại số, để không bao giờ lệch nếu cấu trúc cột A-AH đổi sau này. */
function yearNoteColumnsJson(): string {
  const map: Record<string, number> = {};
  for (const year of CPA_REVIEW_YEARS) map[year] = yearNoteColumnIndex(year) + 1;
  return JSON.stringify(map);
}

function buildAppsScript(webhookUrl: string, secret: string, tabName: string): string {
  return `// LƯU Ý: hàm này CỐ Ý không tên "onEdit" — Apps Script tự chạy bất kỳ hàm nào tên
// đúng "onEdit" dưới dạng SIMPLE TRIGGER, mà simple trigger LUÔN chạy ở chế độ hạn chế
// (restricted authorization) và KHÔNG BAO GIỜ được phép gọi UrlFetchApp dù đã Run cấp
// quyền cho cả project — gặp lỗi thật "Specified permissions are not sufficient to call
// UrlFetchApp.fetch" (2026-08-15). Phải đăng ký làm INSTALLABLE TRIGGER (xem
// installCpaReviewTriggers bên dưới) thì mới chạy full authorization, gọi UrlFetchApp được.
function onCpaReviewEdit(e) {
  var sheet = e.range.getSheet();
  var row = e.range.getRow();
  if (row < 4) return; // bỏ qua hàng tiêu đề/tổng (1-3)
  var ssn = sheet.getRange(row, 4).getValue(); // cột D
  if (!ssn) return;
  var col = e.range.getColumn();
  var payload = {
    secret: "${secret}",
    ssn: String(ssn).split("\\n")[0].trim(),
    columnIndex: col - 1,
    rawValue: e.value != null ? String(e.value) : "",
    // Số dòng thật (thêm 2026-08-15) — cần để app phân biệt đúng dòng khi nhiều dòng cùng
    // SSN (vd gửi "Test Sheet" nhiều lần cho cùng khách với năm khác nhau, không gộp).
    row: row
  };
  // Cột B (Name) có thể gắn link tới hồ sơ gốc (vd tax.agentc3.com) — gửi kèm link hiện tại
  // mỗi khi cột này được sửa, để app không làm mất link lúc đồng bộ ngược lại Sheet.
  if (col === 2) {
    payload.nameLink = e.range.getRichTextValue().getLinkUrl() || "";
  }
  UrlFetchApp.fetch("${webhookUrl}", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });
}

// Đồng bộ Ghi chú (Note, chuột phải ô → Insert note) ở ô "Ngày" mỗi năm — Google Sheets
// KHÔNG bắn sự kiện onEdit khi thêm/sửa Note (chỉ bắt được khi sửa GIÁ TRỊ ô), nên phải quét
// định kỳ qua trigger hẹn giờ thay vì tức thời như onEdit ở trên.
var CPA_REVIEW_YEAR_NOTE_COLUMNS = ${yearNoteColumnsJson()};

function syncCpaReviewNotes() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("${tabName}");
  var lastRow = sheet.getLastRow();
  if (lastRow < 4) return;
  var numRows = lastRow - 3;
  var ssnValues = sheet.getRange(4, 4, numRows, 1).getValues();
  var props = PropertiesService.getScriptProperties();
  var cache = JSON.parse(props.getProperty("cpaReviewNoteCache") || "{}");
  var changes = [];
  for (var year in CPA_REVIEW_YEAR_NOTE_COLUMNS) {
    var col = CPA_REVIEW_YEAR_NOTE_COLUMNS[year];
    var notes = sheet.getRange(4, col, numRows, 1).getNotes();
    for (var i = 0; i < numRows; i++) {
      var ssn = String(ssnValues[i][0] || "").split("\\n")[0].trim();
      if (!ssn) continue;
      var note = notes[i][0] || "";
      var key = ssn + "|" + year;
      if (cache[key] !== note) {
        changes.push({ ssn: ssn, year: year, note: note });
        cache[key] = note;
      }
    }
  }
  if (changes.length === 0) return;
  UrlFetchApp.fetch("${webhookUrl}", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ secret: "${secret}", notes: changes })
  });
  props.setProperty("cpaReviewNoteCache", JSON.stringify(cache));
}

// Chạy hàm NÀY 1 lần (chọn "installCpaReviewTriggers" ở dropdown rồi bấm Run) để vừa cấp
// quyền vừa cài 2 trigger: onCpaReviewEdit (installable — chạy full authorization, khác
// simple trigger "onEdit" mặc định bị hạn chế) cho sửa ô tức thời, và trigger hẹn giờ quét
// Note mỗi 5 phút. KHÔNG cần làm lại trừ khi Sheet bị ngắt kết nối rồi kết nối lại (secret
// đổi) — hoặc script này được dán ĐÈ lên 1 bản cũ hơn (xoá trigger cũ trước khi cài lại).
function installCpaReviewTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var handler = triggers[i].getHandlerFunction();
    if (handler === "syncCpaReviewNotes" || handler === "onCpaReviewEdit") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("syncCpaReviewNotes").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("onCpaReviewEdit").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
}`;
}

async function requireManageAccess() {
  const me = await requireUser();
  if (!me) return { error: NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 }) } as const;
  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "manageCpaReviewSheet", me.role)) {
    return { error: NextResponse.json({ error: "Không có quyền cấu hình đồng bộ CPA Review" }, { status: 403 }) } as const;
  }
  return { me } as const;
}

/** Cho popup "Hướng dẫn" trên tab CPA Review — email Service Account (để Admin share quyền
 * Editor Sheet) không phải bí mật (chỉ là 1 địa chỉ email để mời làm Editor, giống mời 1
 * người bình thường), an toàn hiện cho bất kỳ ai có quyền `manageCpaReviewSheet`.
 *
 * Kèm `?month=YYYY-MM` (tháng ĐÃ kết nối) -> trả thêm `appsScript` build lại từ đúng
 * secret/tabName đã lưu — cho phép xem/copy lại đoạn script bất kỳ lúc nào (vd khi script
 * generator có sửa lỗi, hoặc script trong Sheet bị xoá nhầm) mà KHÔNG cần ngắt kết nối rồi
 * kết nối lại (sẽ đổi secret, phải dán Apps Script mới + mất rowIndex cache đã quét). Thêm
 * 2026-08-15 sau khi phát hiện lỗi "onEdit" giản đơn không gọi được UrlFetchApp.
 */
export async function GET(request: NextRequest) {
  const auth = await requireManageAccess();
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") ?? "";
  let appsScript: string | null = null;
  if (isValidMonthKey(month)) {
    const map = await getCpaReviewSheetConfigMap();
    const existing = map[month];
    if (existing?.sheetId) {
      appsScript = buildAppsScript(buildWebhookUrl(request), existing.webhookSecret, existing.tabName);
    }
  }

  return NextResponse.json({
    serviceAccountConfigured: isServiceAccountConfigured(),
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    appsScript,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireManageAccess();
  if ("error" in auth) return auth.error;
  const { me } = auth;

  if (!isServiceAccountConfigured()) {
    return NextResponse.json(
      { error: "Chưa cấu hình GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY trên server" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const action = body?.action === "resync" ? "resync" : "connect";
  const month = typeof body?.month === "string" ? body.month : "";
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: "Tháng không hợp lệ" }, { status: 400 });
  }

  try {
    if (action === "connect") {
      const sheets = getServiceAccountSheetsClient();
      const link = typeof body?.link === "string" ? body.link.trim() : "";
      if (!link) return NextResponse.json({ error: "Thiếu link Google Sheet" }, { status: 400 });
      const sheetId = extractSheetId(link);
      const gid = extractGid(link) ?? "0";
      const tabName = await resolveTabNameFromGid(sheets, sheetId, gid);
      // Tab mới/trống mặc định chỉ 1000 dòng x 26 cột (Z) — nhỏ hơn layout A-AH x 3003 dòng
      // cần dùng, tự phóng to trước khi quét/ghi để tránh lỗi "exceeds grid limits" (gặp
      // thật 2026-08-15). Chỉ tăng, không đụng dữ liệu hiện có.
      await ensureSheetGridSize(sheets, sheetId, gid, CPA_REVIEW_MIN_GRID.rows, CPA_REVIEW_MIN_GRID.cols);
      // Bảng độc lập hoàn toàn (không liên kết Case) — kết nối lần đầu NHẬP TOÀN BỘ dòng
      // có SSN trong Sheet thành CpaReviewRecord mới, gắn vào đúng THÁNG đang kết nối (khác
      // thiết kế cũ chỉ quét/đối chiếu Case có sẵn), xem deployment-database-sync.md mục 4.22.
      const { rowIndex, imported } = await importSheetRows(sheets, sheetId, tabName, month);
      const distinctNames = await scanDistinctNames(sheets, sheetId, tabName);
      const webhookSecret = randomBytes(24).toString("hex");

      const newConfig: CpaReviewSheetConfig = {
        sheetId,
        gid,
        tabName,
        rowIndex,
        webhookSecret,
        nameToUserId: {},
        connectedAt: new Date().toISOString(),
        connectedByUserId: me.id,
      };
      const map = await getCpaReviewSheetConfigMap();
      await saveCpaReviewSheetConfigMap({ ...map, [month]: newConfig });

      return NextResponse.json({
        ok: true,
        month,
        sheetId,
        gid,
        tabName,
        importedCount: imported,
        distinctNames,
        webhookSecret,
        webhookUrl: buildWebhookUrl(request),
        appsScript: buildAppsScript(buildWebhookUrl(request), webhookSecret, tabName),
      });
    }

    // action === "resync" — đẩy lại TOÀN BỘ record của THÁNG này lên đúng Sheet tháng đó,
    // dùng sau khi thêm/sửa nhiều dòng cùng lúc hoặc khi nghi ngờ rowIndex cache bị lệch.
    const pushed = await resyncAllRecordsToSheet(month);
    return NextResponse.json({ ok: true, pushed });
  } catch (err) {
    // Log lỗi gốc — trước đây chỉ trả message đã map, không log gì, nên lỗi thật (auth
    // key sai định dạng, quota, lỗi mạng...) hoàn toàn không thấy được qua Vercel Runtime
    // Logs khi debug production.
    console.error("[cpa-review-sheet connect/resync] thất bại:", err);
    if (err instanceof ServiceAccountNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // SheetNotAccessibleError đã có message cụ thể (vd "Không tìm thấy tab (gid=...)") —
    // KHÔNG đi qua mapSheetsError (chỉ xử lý lỗi từ Google API, sẽ thay bằng message
    // chung chung kém hữu ích hơn nếu không tách riêng ở đây).
    if (err instanceof SheetNotAccessibleError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: mapSheetsError(err) }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireManageAccess();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const month = typeof body?.month === "string" ? body.month : "";
  const patch = body?.nameToUserId;
  if (!isValidMonthKey(month)) return NextResponse.json({ error: "Tháng không hợp lệ" }, { status: 400 });
  if (!patch || typeof patch !== "object") {
    return NextResponse.json({ error: "Thiếu nameToUserId" }, { status: 400 });
  }

  const map = await getCpaReviewSheetConfigMap();
  const existing = map[month];
  if (!existing?.sheetId) return NextResponse.json({ error: "Chưa kết nối Sheet CPA Review cho tháng này" }, { status: 400 });

  const merged: CpaReviewSheetConfig = { ...existing, nameToUserId: { ...existing.nameToUserId, ...patch } };
  await saveCpaReviewSheetConfigMap({ ...map, [month]: merged });
  return NextResponse.json({ ok: true, nameToUserId: merged.nameToUserId });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireManageAccess();
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!isValidMonthKey(month)) return NextResponse.json({ error: "Tháng không hợp lệ" }, { status: 400 });

  const map = await getCpaReviewSheetConfigMap();
  if (month in map) {
    const next = { ...map };
    delete next[month];
    await saveCpaReviewSheetConfigMap(next);
  }
  return NextResponse.json({ ok: true });
}
