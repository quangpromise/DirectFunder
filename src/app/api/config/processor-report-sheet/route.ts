import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { extractSheetId, extractGid } from "@/lib/sheet-id";
import { isServiceAccountConfigured, ServiceAccountNotConfiguredError } from "@/lib/google-service-account";
import {
  connectProcessorReportSheet,
  resyncProcessorReportSheet,
  getProcessorReportSheetConfigMap,
  saveProcessorReportSheetConfigMap,
  mapSheetsError,
} from "@/lib/processor-report-sheet-sync";
import { isValidMonthKey } from "@/lib/cpa-review-month";
import type { FeaturePermissions } from "@/lib/types";

function buildWebhookUrl(request: NextRequest): string {
  return new URL("/api/processor-report-sheet/webhook", request.nextUrl.origin).toString();
}

/** LƯU Ý: hàm xử lý sửa ô KHÔNG được đặt tên "onEdit" (Apps Script tự chạy dưới dạng simple
 * trigger, luôn bị hạn chế, không gọi được UrlFetchApp) — xem cùng gotcha đã gặp thật ở tab
 * CPA Review, .claude/skills/google-sheet-sync/SKILL.md. */
function buildAppsScript(webhookUrl: string, secret: string): string {
  return `// LƯU Ý: hàm này CỐ Ý không tên "onEdit" — xem giải thích trong
// .claude/skills/google-sheet-sync/SKILL.md (gotcha #2).
function onProcessorReportEdit(e) {
  var row = e.range.getRow();
  var col = e.range.getColumn() - 1; // 0-based, khớp payload app dùng
  if (row < 2 || col < 1) return; // bỏ qua header/section-total (cột A) và hàng tiêu đề
  UrlFetchApp.fetch("${webhookUrl}", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      secret: "${secret}",
      row: row,
      col: col,
      value: e.value != null ? String(e.value) : ""
    })
  });
}

// Chạy hàm NÀY 1 lần (chọn "installProcessorReportTriggers" ở dropdown rồi bấm Run) để vừa
// cấp quyền vừa cài trigger installable (khác simple trigger "onEdit" mặc định bị hạn chế,
// không gọi được UrlFetchApp).
function installProcessorReportTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "onProcessorReportEdit") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("onProcessorReportEdit").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
}`;
}

async function requireManageAccess() {
  const me = await requireUser();
  if (!me) return { error: NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 }) } as const;
  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "manageProcessorReportSheet", me.role)) {
    return { error: NextResponse.json({ error: "Không có quyền cấu hình đồng bộ Google Sheet" }, { status: 403 }) } as const;
  }
  return { me } as const;
}

/** Cho dialog "Kết nối Sheet"/"Hướng dẫn" trên popup "For Processor" — email Service Account
 * không phải bí mật. Kèm `?month=YYYY-MM` trả thêm trạng thái kết nối của tháng đó (không lộ
 * webhookSecret/taskRowMap/userColumnMap) + `appsScript` build lại từ secret đã lưu, cho phép
 * xem/copy lại bất kỳ lúc nào mà không cần ngắt/kết nối lại. */
export async function GET(request: NextRequest) {
  const auth = await requireManageAccess();
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") ?? "";
  let appsScript: string | null = null;
  let connected: { sheetId: string; gid: string; tabName: string; connectedAt: string } | null = null;
  if (isValidMonthKey(month)) {
    const map = await getProcessorReportSheetConfigMap();
    const existing = map[month];
    if (existing?.sheetId) {
      appsScript = buildAppsScript(buildWebhookUrl(request), existing.webhookSecret);
      connected = { sheetId: existing.sheetId, gid: existing.gid, tabName: existing.tabName, connectedAt: existing.connectedAt };
    }
  }

  return NextResponse.json({
    serviceAccountConfigured: isServiceAccountConfigured(),
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    appsScript,
    connected,
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
  if (!isValidMonthKey(month)) return NextResponse.json({ error: "Tháng không hợp lệ" }, { status: 400 });

  try {
    if (action === "connect") {
      const link = typeof body?.link === "string" ? body.link.trim() : "";
      if (!link) return NextResponse.json({ error: "Thiếu link Google Sheet" }, { status: 400 });
      const sheetId = extractSheetId(link);
      const gid = extractGid(link) ?? "0";
      const webhookSecret = randomBytes(24).toString("hex");

      const newConfig = await connectProcessorReportSheet(sheetId, gid, month, me.id, webhookSecret);
      const map = await getProcessorReportSheetConfigMap();
      await saveProcessorReportSheetConfigMap({ ...map, [month]: newConfig });

      return NextResponse.json({
        ok: true,
        month,
        sheetId,
        gid,
        tabName: newConfig.tabName,
        webhookSecret,
        webhookUrl: buildWebhookUrl(request),
        appsScript: buildAppsScript(buildWebhookUrl(request), webhookSecret),
      });
    }

    const pushed = await resyncProcessorReportSheet(month);
    return NextResponse.json({ ok: true, pushed });
  } catch (err) {
    console.error("[processor-report-sheet connect/resync] thất bại:", err);
    if (err instanceof ServiceAccountNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: mapSheetsError(err) }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireManageAccess();
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!isValidMonthKey(month)) return NextResponse.json({ error: "Tháng không hợp lệ" }, { status: 400 });

  const map = await getProcessorReportSheetConfigMap();
  if (month in map) {
    const next = { ...map };
    delete next[month];
    await saveProcessorReportSheetConfigMap(next);
  }
  return NextResponse.json({ ok: true });
}
