import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { sheetChangeToPatch } from "@/lib/cpa-review-sheet-columns";
import { yearNoteKey, CPA_REVIEW_YEARS } from "@/lib/cpa-review-columns";
import {
  getCpaReviewSheetConfigMap,
  saveCpaReviewSheetConfigMap,
  findCpaReviewConfigBySecret,
  findRowIndexKeyByRow,
  getCrmSourceOptions,
} from "@/lib/cpa-review-sheet-sync";
import { extractChangedYearStatuses, syncCpaReviewStatusToCase } from "@/lib/cpa-review-case-sync";
import { broadcastCpaReviewChanged } from "@/lib/pusher-server";
import type { Prisma } from "@prisma/client";

/** Khoảng thời gian "app vừa sửa record này" tính là còn mới — nếu webhook Sheet gửi thay
 * đổi tới trong lúc record đã được app cập nhật gần đây hơn khoảng này, coi thay đổi từ
 * Sheet là stale (đụng độ với chính lần app vừa đẩy đi) và bỏ qua — đúng nguyên tắc "App
 * luôn thắng" đã chốt (xem deployment-database-sync.md mục 4.22). */
const APP_WINS_GRACE_MS = 5000;

function isRecentlyUpdatedByApp(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() < APP_WINS_GRACE_MS;
}

/**
 * Webhook nhận thay đổi TỪ Google Sheet (Apps Script `onEdit`/`syncCpaReviewNotes`) — public
 * route (Apps Script không có session cookie), xác thực bằng `secret` sinh ngẫu nhiên lúc
 * kết nối. MỖI THÁNG 1 secret riêng (thêm 2026-08-14) — route tự dò xem secret khớp tháng
 * nào trong map cấu hình (Apps Script không gửi kèm tháng, không cần thiết vì 1 script chỉ
 * gắn với đúng 1 Sheet/1 tháng). Bảng "CPA Review" độc lập hoàn toàn (không phải Case) — SSN
 * không khớp record nào có sẵn TRONG CÙNG THÁNG thì TỰ TẠO record mới (SSN không còn duy
 * nhất toàn bảng, chỉ duy nhất trong 1 tháng — khách quay lại tháng sau là 1 dòng mới).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const secret = typeof body?.secret === "string" ? body.secret : "";
  if (!secret) {
    return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });
  }

  const configMap = await getCpaReviewSheetConfigMap();
  const found = findCpaReviewConfigBySecret(configMap, secret);
  if (!found) {
    return NextResponse.json({ error: "Secret không hợp lệ" }, { status: 401 });
  }
  const { month, config: sheetConfig } = found;

  // Payload dạng batch Ghi chú (Note) — gửi định kỳ bởi trigger hẹn giờ `syncCpaReviewNotes`
  // trong Apps Script (KHÁC payload sửa giá trị ô thường ở dưới: onEdit không bắn sự kiện
  // khi thêm/sửa Note nên không thể tức thời, xem deployment-database-sync.md mục 4.22).
  if (Array.isArray(body?.notes)) {
    const validYears = new Set<string>(CPA_REVIEW_YEARS);
    const changes = (body.notes as unknown[]).filter(
      (n): n is { ssn: string; year: string; note: string } =>
        Boolean(n) &&
        typeof (n as Record<string, unknown>).ssn === "string" &&
        typeof (n as Record<string, unknown>).year === "string" &&
        validYears.has((n as Record<string, unknown>).year as string) &&
        typeof (n as Record<string, unknown>).note === "string"
    );
    if (changes.length === 0) {
      return NextResponse.json({ ok: true, skipped: "no_valid_notes" });
    }

    const rows = await prisma.cpaReviewRecord.findMany({ where: { month } });
    const bySsn = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const custom = row.custom as Record<string, unknown>;
      if (typeof custom.ssn === "string" && custom.ssn.trim()) bySsn.set(custom.ssn.trim(), row);
    }

    const updatedIds = new Set<string>();
    for (const change of changes) {
      const row = bySsn.get(change.ssn.trim());
      if (!row) continue; // SSN lạ chưa từng đồng bộ — chỉ tạo record mới từ giá trị ô, không tạo riêng từ Note.
      if (isRecentlyUpdatedByApp(row.updatedAt)) continue; // "App luôn thắng".
      const key = yearNoteKey(change.year);
      const custom = { ...((row.custom as Record<string, unknown>) ?? {}) };
      if (change.note) custom[key] = change.note;
      else delete custom[key];
      const updated = await prisma.cpaReviewRecord.update({ where: { id: row.id }, data: { custom: custom as Prisma.InputJsonValue } });
      row.custom = updated.custom;
      row.updatedAt = updated.updatedAt;
      updatedIds.add(row.id);
    }
    for (const id of updatedIds) {
      await broadcastCpaReviewChanged(id, null);
    }
    return NextResponse.json({ ok: true, updated: updatedIds.size });
  }

  const ssn = typeof body?.ssn === "string" ? body.ssn.trim() : "";
  const columnIndex = typeof body?.columnIndex === "number" ? body.columnIndex : Number(body?.columnIndex);
  const rawValue = typeof body?.rawValue === "string" ? body.rawValue : "";
  // Số dòng thật trên Sheet (thêm 2026-08-15) — CẦN để phân biệt đúng dòng khi nhiều
  // CpaReviewRecord cùng chia sẻ 1 SSN (vd nút "Test Sheet" gửi nhiều lần, mỗi lần 1 năm
  // khác nhau, không gộp — xem pushRecordToSheet trong cpa-review-sheet-sync.ts). Có thể
  // thiếu (`undefined`) nếu Apps Script cũ chưa dán lại script mới — vẫn hoạt động được nhờ
  // fallback khớp theo SSN bên dưới, chỉ kém chính xác hơn khi thật sự có nhiều dòng trùng
  // SSN chưa từng được cache theo dòng.
  const sheetRow = typeof body?.row === "number" ? body.row : Number(body?.row);
  const hasSheetRow = Number.isFinite(sheetRow);
  // Link đính kèm ô Name (cột B) — Apps Script chỉ gửi field này khi cột vừa sửa là cột B
  // (xem buildAppsScript trong /api/config/cpa-review-sheet), rỗng "" nghĩa là Admin vừa GỠ
  // link (không phải "không gửi") nên vẫn cần merge để xoá đúng `custom.nameLink` cũ.
  const nameLink = typeof body?.nameLink === "string" ? body.nameLink : undefined;
  if (!ssn || !Number.isFinite(columnIndex)) {
    return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });
  }

  const crmSourceOptions = await getCrmSourceOptions();
  const patch = sheetChangeToPatch({ columnIndex, rawValue }, sheetConfig.nameToUserId, crmSourceOptions);
  if (!patch) {
    // Log rõ cột/giá trị bị bỏ qua — trước đây im lặng hoàn toàn, khiến báo cáo "sửa Sheet
    // nhưng app không cập nhật" không có manh mối gì để tra (chỉ xem được qua Vercel Runtime
    // Logs, không hiện gì phía Apps Script vì webhook vẫn trả 200 OK có chủ đích).
    console.warn(`[cpa-review-sheet webhook] bỏ qua columnIndex=${columnIndex} rawValue="${rawValue}" (ssn=${ssn}, month=${month}) — không map được cột hoặc không parse được giá trị`);
    return NextResponse.json({ ok: true, skipped: "column_not_writable_or_unparseable" });
  }

  // Status theo năm (key `status_<năm>`) đổi sang Accepted/TTS Refund/Done/Resubmitted qua
  // SHEET (khác đổi tay trong app, vốn đã xử lý ở PATCH /api/cpa-review/[id]) -> cũng phải
  // tự đổi refundYearStatus tương ứng của Case khớp SSN — trước đây route này hoàn toàn
  // thiếu bước này (chỉ PATCH mới có), khiến đổi Status trực tiếp trên Sheet không bao giờ
  // phản ánh sang popup "Refund by years" (bug thật gặp trên production 2026-08-15, case
  // "Dinh Hieu Huynh"). Dùng lại đúng `ssn` webhook nhận được (đã trim).
  const changedYearStatuses = extractChangedYearStatuses({ [patch.key]: patch.value });

  const rows = await prisma.cpaReviewRecord.findMany({ where: { month } });
  // Ưu tiên khớp theo SỐ DÒNG thật (qua rowIndex cache đã lưu id/ssn -> dòng) — chỉ fallback
  // khớp theo SSN (hành vi cũ, có thể chọn NHẦM dòng nếu nhiều dòng cùng SSN chưa từng được
  // cache theo dòng) khi không có `sheetRow` hoặc dòng đó chưa từng xuất hiện trong cache.
  const cachedKey = hasSheetRow ? findRowIndexKeyByRow(sheetConfig.rowIndex, sheetRow) : undefined;
  const row =
    (cachedKey ? rows.find((r) => r.id === cachedKey) : undefined) ??
    rows.find((r) => {
      const custom = r.custom as Record<string, unknown>;
      return typeof custom.ssn === "string" && custom.ssn.trim() === ssn;
    });

  if (!row) {
    // Dòng mới trong Sheet (chưa từng đồng bộ) — tạo record mới trong đúng tháng, bắt đầu
    // từ đúng SSN + ô vừa sửa, các ô khác điền dần qua những lần onEdit tiếp theo.
    const initialCustom: Record<string, string | number> = { ssn, [patch.key]: patch.value };
    if (nameLink) initialCustom.nameLink = nameLink;
    const created = await prisma.cpaReviewRecord.create({
      data: { custom: initialCustom, sortOrder: -Date.now(), month },
    });
    // Cache NGAY theo dòng thật (nếu Apps Script có gửi kèm) — để lần App→Sheet đẩy tiếp
    // theo cho ĐÚNG record này ghi lại vào đúng dòng vừa gõ tay, không append nhầm 1 dòng
    // mới trùng lặp bên cạnh.
    if (hasSheetRow) {
      await saveCpaReviewSheetConfigMap({
        ...configMap,
        [month]: { ...sheetConfig, rowIndex: { ...sheetConfig.rowIndex, [created.id]: sheetRow } },
      });
    }
    if (changedYearStatuses.length > 0) {
      after(() => syncCpaReviewStatusToCase(ssn, changedYearStatuses));
    }
    // Không có Pusher socket của trình duyệt nào để loại trừ (nguồn là Apps Script, không
    // phải 1 tab đang mở) -> socketId luôn null, mọi tab đều tự refetch (xem use-realtime.ts).
    await broadcastCpaReviewChanged(created.id, null);
    return NextResponse.json({ ok: true, created: created.id });
  }

  // "App luôn thắng": record vừa được app cập nhật gần đây hơn grace window -> coi thay
  // đổi Sheet này là đụng độ với chính lần app vừa đẩy đi, bỏ qua.
  if (isRecentlyUpdatedByApp(row.updatedAt)) {
    return NextResponse.json({ ok: true, skipped: "app_wins_recent_update" });
  }

  const merged: Record<string, unknown> = { ...((row.custom as Record<string, unknown>) ?? {}), [patch.key]: patch.value };
  if (nameLink !== undefined) {
    if (nameLink) merged.nameLink = nameLink;
    else delete merged.nameLink;
  }
  const updated = await prisma.cpaReviewRecord.update({
    where: { id: row.id },
    data: { custom: merged as Prisma.InputJsonValue },
  });
  // Tự "chữa lành" cache về đúng key mới (record.id) nếu dòng này vừa được khớp qua SSN
  // (cache kiểu cũ, hoặc chưa từng cache) hay lệch số dòng — để lần push App→Sheet kế tiếp
  // (và lần webhook kế tiếp) không còn phải dò lại qua SSN nữa.
  if (hasSheetRow && sheetConfig.rowIndex[row.id] !== sheetRow) {
    await saveCpaReviewSheetConfigMap({
      ...configMap,
      [month]: { ...sheetConfig, rowIndex: { ...sheetConfig.rowIndex, [row.id]: sheetRow } },
    });
  }
  if (changedYearStatuses.length > 0) {
    after(() => syncCpaReviewStatusToCase(ssn, changedYearStatuses));
  }
  await broadcastCpaReviewChanged(updated.id, null);

  return NextResponse.json({ ok: true, updatedAt: updated.updatedAt.toISOString() });
}
