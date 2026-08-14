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
  return `function onEdit(e) {
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
    rawValue: e.value != null ? String(e.value) : ""
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
// quyền vừa cài trigger hẹn giờ quét Note mỗi 5 phút — KHÔNG cần làm lại trừ khi Sheet bị
// ngắt kết nối rồi kết nối lại (secret đổi).
function installCpaReviewTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "syncCpaReviewNotes") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("syncCpaReviewNotes").timeBased().everyMinutes(5).create();
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
 * người bình thường), an toàn hiện cho bất kỳ ai có quyền `manageCpaReviewSheet`. */
export async function GET() {
  const auth = await requireManageAccess();
  if ("error" in auth) return auth.error;
  return NextResponse.json({
    serviceAccountConfigured: isServiceAccountConfigured(),
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
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
    if (err instanceof ServiceAccountNotConfiguredError) {
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
