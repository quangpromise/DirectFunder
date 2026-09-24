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
import { isValidMonthKey, monthKeyFromTabName } from "@/lib/cpa-review-month";
import type { CpaReviewSheetConfig, CpaReviewSheetConfigMap, FeaturePermissions } from "@/lib/types";

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

/** Mỗi FILE Google Sheet chỉ có 1 Apps Script project — nên sinh 1 script CHUNG cho MỌI tháng
 * đang kết nối vào cùng file đó (vd tab "Aug26" -> 2026-08, "Sep26" -> 2026-09), định tuyến theo
 * TÊN TAB vừa sửa sang đúng secret của tháng tương ứng. Bản cũ sinh 1 script/tháng, cùng tên
 * hàm/trigger: dán script tháng này đè mất script tháng kia, và tab tháng khác trong cùng file
 * có thể bị đồng bộ nhầm (production 2026-09-02, 2026-09-24). Tab không có trong danh sách
 * luôn bị bỏ qua hoàn toàn. */
function buildAppsScript(webhookUrl: string, tabs: { tabName: string; secret: string; month: string }[]): string {
  const tabMap: Record<string, string> = {};
  for (const t of tabs) tabMap[t.tabName] = t.secret;
  const tabList = tabs.map((t) => `//   "${t.tabName}" -> tháng ${t.month}`).join("\n");
  return `// Script đồng bộ CPA Review cho CẢ FILE này — chỉ các tab dưới đây được đồng bộ, mỗi tab
// chỉ vào đúng tháng của nó. Tab khác trong file bị bỏ qua hoàn toàn.
${tabList}
// Khi kết nối thêm 1 tháng mới vào file này, phải dán LẠI script mới (có thêm tab đó) rồi
// chạy lại installCpaReviewTriggers.
var CPA_REVIEW_WEBHOOK_URL = ${JSON.stringify(webhookUrl)};
var CPA_REVIEW_TABS = ${JSON.stringify(tabMap)};

function cpaReviewSecretFor(sheet) {
  var name = sheet.getName();
  return Object.prototype.hasOwnProperty.call(CPA_REVIEW_TABS, name) ? CPA_REVIEW_TABS[name] : null;
}

function cpaReviewPost(payload) {
  UrlFetchApp.fetch(CPA_REVIEW_WEBHOOK_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });
}

// CỐ Ý không tên "onEdit": simple trigger không được gọi UrlFetchApp — phải là installable
// trigger (xem installCpaReviewTriggers).
function onCpaReviewEdit(e) {
  var sheet = e.range.getSheet();
  var secret = cpaReviewSecretFor(sheet);
  if (!secret) return;
  // Bôi đen nhiều dòng rồi sửa/xoá/paste chỉ bắn 1 sự kiện cho cả vùng — lặp từng dòng.
  var startRow = e.range.getRow();
  var numRows = e.range.getNumRows();
  var editedStartIdx = e.range.getColumn() - 1;
  var editedNumCols = e.range.getNumColumns();

  // Khoá tuần tự để gõ nhanh nhiều ô không tạo trùng dòng; hết 10s vẫn chạy tiếp không khoá
  // (mất dữ liệu tệ hơn 1 dòng trùng hiếm gặp).
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(10000);
    locked = true;
  } catch (lockErr) {}

  try {
    for (var i = 0; i < numRows; i++) {
      var row = startRow + i;
      if (row < 4) continue; // hàng 1-3 là tiêu đề/tổng
      onCpaReviewEditLocked(sheet, secret, row, editedStartIdx, editedNumCols);
    }
  } finally {
    if (locked) lock.releaseLock();
  }
}

function onCpaReviewEditLocked(sheet, secret, row, editedStartIdx, editedNumCols) {
  var width = Math.min(sheet.getLastColumn(), 34); // A..AH
  var rowValues = sheet.getRange(row, 1, 1, width).getValues()[0];
  var editedEndIdx = editedStartIdx + editedNumCols - 1;
  var cells = [];
  var hasNonEmpty = false;
  for (var c = 0; c < width; c++) {
    var v = rowValues[c];
    var isEmpty = v === "" || v === null || v === undefined;
    if (!isEmpty) hasNonEmpty = true;
    // Ô rỗng ngoài vùng vừa sửa: bỏ qua (chưa từng điền). Ô rỗng TRONG vùng vừa sửa: người
    // dùng chủ động xoá -> gửi rỗng để app xoá theo.
    var wasJustEdited = c >= editedStartIdx && c <= editedEndIdx;
    if (isEmpty && !wasJustEdited) continue;
    cells.push({ columnIndex: c, rawValue: isEmpty ? "" : String(v) });
  }
  var tab = sheet.getName();
  if (!hasNonEmpty) {
    cpaReviewPost({ secret: secret, tab: tab, row: row, rowCleared: true });
    return;
  }
  var payload = {
    secret: secret,
    tab: tab,
    ssn: String(sheet.getRange(row, 4).getValue() || "").trim(), // cột D, có thể rỗng
    row: row,
    fullRowSync: true,
    cells: cells
  };
  var nameLink = sheet.getRange(row, 2).getRichTextValue().getLinkUrl();
  if (nameLink) payload.nameLink = nameLink;
  cpaReviewPost(payload);
}

// Xoá hẳn dòng trên Sheet -> server tự quét lại cột SSN của ĐÚNG tab/tháng đó.
function onCpaReviewChange(e) {
  if (e.changeType !== "REMOVE_ROW" && e.changeType !== "REMOVE_GRID") return;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var secret = cpaReviewSecretFor(sheet);
  if (!secret) return;
  cpaReviewPost({ secret: secret, tab: sheet.getName(), rowsRemoved: true });
}

// Ghi chú (Note) ở ô "Ngày" mỗi năm — onEdit không bắt được Note, nên quét định kỳ.
var CPA_REVIEW_YEAR_NOTE_COLUMNS = ${yearNoteColumnsJson()};

function syncCpaReviewNotes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var cache = JSON.parse(props.getProperty("cpaReviewNoteCacheByTab") || "{}");
  var seenKeys = {};
  for (var tab in CPA_REVIEW_TABS) {
    var sheet = ss.getSheetByName(tab);
    if (!sheet) continue;
    var lastRow = sheet.getLastRow();
    if (lastRow < 4) continue;
    var numRows = lastRow - 3;
    var ssnValues = sheet.getRange(4, 4, numRows, 1).getValues();
    var changes = [];
    for (var year in CPA_REVIEW_YEAR_NOTE_COLUMNS) {
      var notes = sheet.getRange(4, CPA_REVIEW_YEAR_NOTE_COLUMNS[year], numRows, 1).getNotes();
      for (var i = 0; i < numRows; i++) {
        var ssn = String(ssnValues[i][0] || "").trim();
        if (!ssn) continue;
        var row = 4 + i;
        var note = notes[i][0] || "";
        var key = tab + "|" + row + "|" + year;
        seenKeys[key] = true;
        if (cache[key] !== note) {
          changes.push({ ssn: ssn, year: year, note: note, row: row });
          cache[key] = note;
        }
      }
    }
    if (changes.length > 0) {
      cpaReviewPost({ secret: CPA_REVIEW_TABS[tab], tab: tab, notes: changes });
    }
  }
  for (var k in cache) {
    if (!seenKeys[k]) delete cache[k];
  }
  props.setProperty("cpaReviewNoteCacheByTab", JSON.stringify(cache));
}

// Chạy hàm NÀY 1 lần sau mỗi lần dán script (chọn ở dropdown rồi bấm Run) — xoá trigger cũ
// rồi cài lại 3 trigger dùng chung cho mọi tab tháng trong file.
function installCpaReviewTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var handler = triggers[i].getHandlerFunction();
    if (handler === "syncCpaReviewNotes" || handler === "onCpaReviewEdit" || handler === "onCpaReviewChange") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("syncCpaReviewNotes").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("onCpaReviewEdit").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  ScriptApp.newTrigger("onCpaReviewChange").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onChange().create();
}`;
}

/** Script cho FILE Sheet chứa tháng `month` — gồm mọi tháng đang kết nối vào cùng file đó. */
function buildAppsScriptForFile(webhookUrl: string, map: CpaReviewSheetConfigMap, sheetId: string): string {
  const tabs = Object.entries(map)
    .filter(([, c]) => c?.sheetId === sheetId)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, c]) => ({ tabName: c.tabName, secret: c.webhookSecret, month }));
  return buildAppsScript(webhookUrl, tabs);
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
      appsScript = buildAppsScriptForFile(buildWebhookUrl(request), map, existing.sheetId);
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
  const action = body?.action === "resync" ? "resync" : body?.action === "rescan-names" ? "rescan-names" : "connect";
  const month = typeof body?.month === "string" ? body.month : "";
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: "Tháng không hợp lệ" }, { status: 400 });
  }

  try {
    if (action === "rescan-names") {
      // Quét lại DANH SÁCH TÊN Processor/Agent xuất hiện trên Sheet — CHỈ ĐỌC, không đụng gì
      // tới CpaReviewRecord/rowIndex (khác "connect"/"reconnect" vốn chạy lại importSheetRows
      // toàn bộ). Thêm vì bug thật gặp: dialog chỉ hiện danh sách tên lúc VỪA connect xong
      // (connectResult.distinctNames) — tên MỚI gõ thêm vào Sheet sau đó không hiện lại cho
      // tới khi mở dialog lần sau (fallback về Object.keys(nameToUserId), chỉ có tên ĐÃ map),
      // khiến Admin không tìm thấy tên mới để ánh xạ mà không phải "Kết nối lại" (rủi ro hơn
      // vì chạy lại importSheetRows đầy đủ, có thể gộp nhầm 2 dòng cùng SSN khác nhau).
      const map = await getCpaReviewSheetConfigMap();
      const existing = map[month];
      if (!existing?.sheetId) return NextResponse.json({ error: "Tháng này chưa kết nối Sheet" }, { status: 400 });
      const sheets = getServiceAccountSheetsClient();
      const distinctNames = await scanDistinctNames(sheets, existing.sheetId, existing.tabName);
      return NextResponse.json({ ok: true, distinctNames });
    }

    if (action === "connect") {
      const sheets = getServiceAccountSheetsClient();
      const link = typeof body?.link === "string" ? body.link.trim() : "";
      if (!link) return NextResponse.json({ error: "Thiếu link Google Sheet" }, { status: 400 });
      const sheetId = extractSheetId(link);
      const gid = extractGid(link) ?? "0";
      const tabName = await resolveTabNameFromGid(sheets, sheetId, gid);

      // Mỗi tháng chỉ được nối đúng tab của tháng đó — chặn dán nhầm link tab tháng khác và
      // chặn 1 tab bị nối cho 2 tháng (cả 2 sẽ cùng đọc/ghi đè 1 tab).
      const tabMonth = monthKeyFromTabName(tabName);
      if (tabMonth && tabMonth !== month) {
        return NextResponse.json(
          { error: `Tab "${tabName}" là của tháng ${tabMonth}, không phải tháng ${month} đang chọn. Hãy mở đúng tab tháng ${month} rồi copy lại link.` },
          { status: 400 }
        );
      }
      const currentMap = await getCpaReviewSheetConfigMap();
      const clash = Object.entries(currentMap).find(
        ([m, c]) => m !== month && c?.sheetId === sheetId && (c.gid === gid || c.tabName === tabName)
      );
      if (clash) {
        return NextResponse.json(
          { error: `Tab "${tabName}" đang được kết nối cho tháng ${clash[0]}. Mỗi tháng phải dùng 1 tab riêng.` },
          { status: 400 }
        );
      }
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
      const nextMap = { ...map, [month]: newConfig };
      await saveCpaReviewSheetConfigMap(nextMap);

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
        appsScript: buildAppsScriptForFile(buildWebhookUrl(request), nextMap, sheetId),
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
