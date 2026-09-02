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
  rebuildCpaReviewRowIndex,
} from "@/lib/cpa-review-sheet-sync";
import { getServiceAccountSheetsClient } from "@/lib/google-service-account";
import {
  extractChangedYearStatuses,
  syncCpaReviewStatusToCase,
  extractRejectedYearStatuses,
  notifyProcessorOnRejectedCpaReviewStatus,
} from "@/lib/cpa-review-case-sync";

/** "fromUserId" gán cho Notification bắn qua chiều Sheet→App (không có phiên user nào —
 * webhook xác thực bằng secret) — cùng quy ước "system:<nguồn>" đã dùng cho các tác vụ hệ
 * thống khác trong repo (vd "system:agentc3-crm-sync"), thêm 2026-09-02. */
const NOTIFY_FROM_SHEET_SYNC = "system:cpa-review-sheet-sync";
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

/** Field nội bộ đánh dấu LẦN GHI GẦN NHẤT tới từ đâu — "app" (PATCH /api/cpa-review/[id]) hay
 * "sheet" (chính webhook này) — thêm 2026-08-31, sửa bug thật gặp lúc tự test: `onCpaReviewEdit`
 * giờ gửi lại TOÀN BỘ dòng ở MỌI lần sửa (không chỉ 1 ô), nên gõ liên tiếp nhiều ô trong Sheet
 * (vd Name rồi Phone rồi SSN trong vài giây, cách nhập tay bình thường) khiến lượt gửi SAU tự
 * bị `isRecentlyUpdatedByApp` chặn nhầm — hàm đó chỉ nhìn THỜI GIAN, không phân biệt được
 * "app vừa ghi" với "chính webhook này vừa ghi trước đó vài giây". Không leak ra Sheet (chỉ
 * `CPA_REVIEW_SHEET_COLUMN_MAP` mới được ghi lên Sheet) hay UI (chỉ đọc field có tên cụ thể). */
function isSourcedFromApp(custom: unknown): boolean {
  return Boolean(custom && typeof custom === "object" && (custom as Record<string, unknown>).__syncedFrom === "app");
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
      (n): n is { ssn: string; year: string; note: string; row?: number } =>
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
    // Ưu tiên khớp theo SỐ DÒNG (rowIndex cache), CHỈ fallback theo SSN khi thiếu `row`
    // (Apps Script chưa dán lại bản mới) — nhiều record cùng SSN (nút "Test Sheet" gửi nhiều
    // năm) khiến khớp thuần theo SSN gán NHẦM ghi chú cho record khác/không đúng cái vừa sửa
    // (bug thật gặp production 2026-08-15, "insert note từ Sheet không nhận"). Cùng cơ chế
    // với payload sửa 1 ô thường ở dưới.
    const bySsn = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const custom = row.custom as Record<string, unknown>;
      if (typeof custom.ssn === "string" && custom.ssn.trim()) bySsn.set(custom.ssn.trim(), row);
    }

    const updatedIds = new Set<string>();
    for (const change of changes) {
      const hasRow = typeof change.row === "number" && Number.isFinite(change.row);
      const cachedKey = hasRow ? findRowIndexKeyByRow(sheetConfig.rowIndex, change.row as number) : undefined;
      const row = (cachedKey ? rows.find((r) => r.id === cachedKey) : undefined) ?? bySsn.get(change.ssn.trim());
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

  // Tín hiệu "có dòng vừa bị xoá trực tiếp trên Sheet" (thêm 2026-08-15, yêu cầu "xoá phải
  // giống nhau ở cả 2 chiều"; SỬA LẠI cùng ngày sau khi phát hiện bug thật trên production —
  // bản đầu (so khớp SSN với snapshot PropertiesService) có 2 lỗi: (1) snapshot CHỈ được cập
  // nhật lúc XOÁ, không bao giờ cập nhật lúc THÊM dòng (kể cả thêm qua "Test Sheet"/Service
  // Account) -> dòng thêm sau lần xoá gần nhất không có trong snapshot -> xoá dòng đó sau này
  // không phát hiện được gì (prevSsns/currentSsns giống hệt nhau); (2) so khớp theo TẬP HỢP
  // SSN (Set) không phân biệt được SỐ LƯỢNG dòng cùng SSN — 2 dòng cùng SSN (đúng thiết kế
  // "Test Sheet" gửi nhiều năm, không gộp) mà xoá 1 dòng thì SSN vẫn còn xuất hiện (dòng kia)
  // nên coi như "không có gì xoá". SỬA TRIỆT ĐỂ: bỏ hẳn snapshot, Apps Script chỉ cần báo
  // "vừa có dòng bị xoá" (không cần biết SSN/dòng nào) — server tự QUÉT LẠI TOÀN BỘ cột SSN
  // (rebuildCpaReviewRowIndex, đã sửa để khớp ĐÚNG THỨ TỰ khi nhiều bản ghi cùng SSN) rồi so
  // với danh sách record đang có trong DB: bản ghi nào KHÔNG khớp được dòng nào nữa (không có
  // mặt trong rowIndex mới) coi là đã bị xoá trên Sheet -> xoá luôn trong DB. Không còn phụ
  // thuộc trạng thái lưu ở phía Apps Script nên không thể bị "quên cập nhật" như trước.
  if (body?.rowsRemoved === true) {
    const sheets = getServiceAccountSheetsClient();
    const nextRowIndex = await rebuildCpaReviewRowIndex(sheets, sheetConfig, month);
    const matchedIds = new Set(Object.keys(nextRowIndex));

    const rows = await prisma.cpaReviewRecord.findMany({ where: { month } });
    // "App luôn thắng" — record vừa được app cập nhật gần đây (vd Test Sheet vừa tạo, hoặc
    // vừa sửa xong) không xoá dù chưa khớp được dòng nào, coi tín hiệu Sheet là stale/đụng độ
    // thời điểm (chưa kịp đẩy App->Sheet xong thì Sheet đã báo xoá).
    const missing = rows.filter((r) => !matchedIds.has(r.id) && !isRecentlyUpdatedByApp(r.updatedAt));
    if (missing.length > 0) {
      await prisma.cpaReviewRecord.deleteMany({ where: { id: { in: missing.map((r) => r.id) } } });
    }
    await saveCpaReviewSheetConfigMap({ ...configMap, [month]: { ...sheetConfig, rowIndex: nextRowIndex } });

    // "Chữa lành" sortOrder khớp lại đúng dòng Sheet mới sau khi rebuild — bug thật gặp
    // production (2026-09-02): rowIndex (map ID<->dòng thật) được cập nhật ở đây, nhưng
    // sortOrder (quyết định THỨ TỰ HIỂN THỊ trên app, dùng ở GET /api/cpa-review) trước đây
    // KHÔNG được đồng bộ theo — nếu 1 dòng bị xoá làm các dòng sau dịch chuyển vị trí, record
    // tương ứng có thể bị hiển thị SAI THỨ TỰ (sortOrder cũ không còn khớp rowIndex mới) dù
    // rowIndex đã đúng, dữ liệu App->Sheet vẫn đúng dòng — chỉ riêng thứ tự HIỂN THỊ bị lệch.
    for (const r of rows) {
      if (missing.some((m) => m.id === r.id)) continue;
      const row = nextRowIndex[r.id];
      if (typeof row === "number" && r.sortOrder !== row) {
        await prisma.cpaReviewRecord.update({ where: { id: r.id }, data: { sortOrder: row } });
      }
    }

    for (const r of missing) {
      await broadcastCpaReviewChanged(r.id, null);
    }
    return NextResponse.json({ ok: true, deleted: missing.length });
  }

  // Dòng VẪN CÒN trên Sheet (không bị xoá hẳn — khác `rowsRemoved` ở trên) nhưng nội dung đã
  // bị xoá TRẮNG HOÀN TOÀN (mọi ô A..AH rỗng) — Apps Script `onCpaReviewEdit` báo qua tín hiệu
  // này (thêm 2026-08-31, theo yêu cầu "row đó không còn bất cứ thông tin gì thì phần mềm tự
  // động delete 1 dòng đó"). Chỉ khớp qua SỐ DÒNG (rowIndex cache) — không có SSN nào để dò
  // (mọi ô đã rỗng), record chưa từng khớp dòng nào (chưa cache) thì không có gì để xoá.
  if (body?.rowCleared === true) {
    const clearedRow = typeof body.row === "number" ? body.row : Number(body.row);
    if (!Number.isFinite(clearedRow)) {
      return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });
    }
    const cachedKey = findRowIndexKeyByRow(sheetConfig.rowIndex, clearedRow);
    if (!cachedKey) return NextResponse.json({ ok: true, skipped: "row_not_tracked" });
    const existing = await prisma.cpaReviewRecord.findUnique({ where: { id: cachedKey } });
    if (!existing) return NextResponse.json({ ok: true, skipped: "record_not_found" });
    // "App luôn thắng" — chỉ chặn nếu lần ghi gần nhất THẬT SỰ tới từ app (cùng cơ chế
    // isSourcedFromApp ở nhánh fullRowSync bên dưới).
    if (isSourcedFromApp(existing.custom) && isRecentlyUpdatedByApp(existing.updatedAt)) {
      return NextResponse.json({ ok: true, skipped: "app_wins_recent_update" });
    }
    await prisma.cpaReviewRecord.delete({ where: { id: cachedKey } });
    const nextRowIndex = { ...sheetConfig.rowIndex };
    delete nextRowIndex[cachedKey];
    await saveCpaReviewSheetConfigMap({ ...configMap, [month]: { ...sheetConfig, rowIndex: nextRowIndex } });
    await broadcastCpaReviewChanged(cachedKey, null);
    return NextResponse.json({ ok: true, deleted: cachedKey });
  }

  // Bù đầy đủ dữ liệu 1 dòng mỗi lần Apps Script `onCpaReviewEdit` chạy — GỬI TOÀN BỘ dòng
  // (không chỉ đúng 1 ô vừa sửa), KHÔNG bắt buộc phải có SSN (bỏ yêu cầu này 2026-08-31, theo
  // yêu cầu "không cần phải có SSN ở GGS mới đồng bộ lên phần mềm, mà cột nào có thông tin
  // cũng phải đồng bộ") — trước đây chỉ gửi đúng ô vừa sửa VÀ bắt buộc dòng phải có SSN,
  // khiến gõ Name/Phone/... trước khi có SSN bị bỏ qua âm thầm, mất dữ liệu (lỗi thật báo
  // trên production). Định danh dòng ưu tiên qua SỐ DÒNG THẬT (row, luôn có mặt vì Apps
  // Script luôn gửi kèm) — chỉ fallback qua SSN nếu có VÀ chưa từng cache theo dòng (record cũ
  // từ trước khi có cơ chế cache dòng, hoặc dòng bị chèn/xoá làm lệch số).
  if (body?.fullRowSync === true && Array.isArray(body?.cells)) {
    const fullRowSsn = typeof body.ssn === "string" ? body.ssn.trim() : "";
    const fullRowSheetRow = typeof body.row === "number" ? body.row : Number(body.row);
    const hasFullRowSheetRow = Number.isFinite(fullRowSheetRow);
    if (!fullRowSsn && !hasFullRowSheetRow) {
      // Không có gì để định danh dòng (cả SSN lẫn số dòng đều thiếu) — payload hỏng/quá cũ.
      return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });
    }
    const crmSourceOptions = await getCrmSourceOptions();
    const merged: Record<string, unknown> = {};
    for (const raw of body.cells as unknown[]) {
      const cell = raw as { columnIndex?: unknown; rawValue?: unknown };
      const cellColumnIndex = typeof cell.columnIndex === "number" ? cell.columnIndex : Number(cell.columnIndex);
      const cellRawValue = typeof cell.rawValue === "string" ? cell.rawValue : "";
      if (!Number.isFinite(cellColumnIndex)) continue;
      const patch = sheetChangeToPatch({ columnIndex: cellColumnIndex, rawValue: cellRawValue }, sheetConfig.nameToUserId, crmSourceOptions);
      if (patch) merged[patch.key] = patch.value;
    }
    // Link đính kèm ô Name (cột B) — bug thật gặp production (thêm 2026-08-31, sửa cùng lúc
    // với việc bỏ SSN bắt buộc): nhánh fullRowSync mới THIẾU HẲN xử lý field này (chỉ nhánh
    // single-cell CŨ, không còn Apps Script nào gửi nữa, mới có) — insert link trên Sheet
    // không bao giờ lên app. `nameLink` chỉ có mặt trong payload khi có link (Apps Script chỉ
    // gửi field này nếu link không rỗng — xem buildAppsScript), không có nghĩa là "gỡ link"
    // (khác nhánh cũ) vì giờ MỌI lần sửa đều gửi lại toàn dòng chứ không riêng cột B — không
    // gửi field = không đổi gì về link, không phải tín hiệu xoá.
    const fullRowNameLink = typeof body?.nameLink === "string" ? body.nameLink : undefined;
    if (fullRowNameLink) merged.nameLink = fullRowNameLink;
    merged.__syncedFrom = "sheet";

    const rows = await prisma.cpaReviewRecord.findMany({ where: { month } });
    const cachedKey = hasFullRowSheetRow ? findRowIndexKeyByRow(sheetConfig.rowIndex, fullRowSheetRow) : undefined;
    const existing =
      (cachedKey ? rows.find((r) => r.id === cachedKey) : undefined) ??
      (fullRowSsn
        ? rows.find((r) => {
            const custom = r.custom as Record<string, unknown>;
            return typeof custom.ssn === "string" && custom.ssn.trim() === fullRowSsn;
          })
        : undefined);

    if (!existing) {
      const created = await prisma.cpaReviewRecord.create({
        // sortOrder = ĐÚNG số dòng Sheet (thêm 2026-08-31, theo yêu cầu "đảm bảo dữ liệu từ
        // row 4 trở đi của sheet đều đồng bộ dữ liệu từ row 4 trở đi của Phần mềm") — trước
        // đây dùng -Date.now() (quy ước "mới nhất lên đầu" của bảng Hồ sơ chính), khiến dòng
        // vừa gõ trên Sheet luôn nhảy lên ĐẦU bảng app bất kể vị trí thật trên Sheet, không
        // khớp thứ tự hiển thị. `GET /api/cpa-review` sort tăng dần theo sortOrder — dùng
        // thẳng số dòng (4, 5, 6...) làm sortOrder khiến thứ tự app tự khớp đúng thứ tự Sheet.
        // Record tạo qua đường khác (nút "Thêm"/"Test Sheet", chưa từng gắn dòng Sheet) vẫn
        // giữ -Date.now() (số RẤT ÂM) nên luôn đứng TRƯỚC mọi dòng đã có số Sheet — chấp nhận
        // được, không phải phạm vi yêu cầu này.
        data: { custom: merged as Prisma.InputJsonValue, sortOrder: hasFullRowSheetRow ? fullRowSheetRow : -Date.now(), month },
      });
      if (hasFullRowSheetRow) {
        await saveCpaReviewSheetConfigMap({
          ...configMap,
          [month]: { ...sheetConfig, rowIndex: { ...sheetConfig.rowIndex, [created.id]: fullRowSheetRow } },
        });
      }
      const changedYearStatuses = extractChangedYearStatuses(merged);
      if (changedYearStatuses.length > 0 && fullRowSsn) after(() => syncCpaReviewStatusToCase(fullRowSsn, changedYearStatuses));
      const rejectedYears = extractRejectedYearStatuses(merged);
      if (rejectedYears.length > 0) {
        after(() => notifyProcessorOnRejectedCpaReviewStatus({ id: created.id, custom: merged }, rejectedYears, NOTIFY_FROM_SHEET_SYNC));
      }
      await broadcastCpaReviewChanged(created.id, null);
      return NextResponse.json({ ok: true, created: created.id });
    }

    // Chỉ chặn nếu lần ghi GẦN NHẤT thật sự tới từ APP (không phải chính webhook này ghi lúc
    // trước — xem isSourcedFromApp) — tránh tự chặn nhầm khi người dùng gõ liên tiếp nhiều ô
    // trong Sheet (mỗi lần đều gửi lại toàn dòng, có thể cách nhau chưa tới 5 giây).
    if (isSourcedFromApp(existing.custom) && isRecentlyUpdatedByApp(existing.updatedAt)) {
      return NextResponse.json({ ok: true, skipped: "app_wins_recent_update" });
    }
    const updated = await prisma.cpaReviewRecord.update({
      where: { id: existing.id },
      data: {
        custom: { ...((existing.custom as Record<string, unknown>) ?? {}), ...merged } as Prisma.InputJsonValue,
        // Tự "chữa lành" sortOrder về đúng số dòng Sheet nếu record này được tạo từ đường khác
        // (nút "Thêm"/"Test Sheet") rồi mới được gán dòng Sheet qua lần sửa này — cùng lý do
        // sortOrder ở nhánh tạo mới bên trên.
        ...(hasFullRowSheetRow && existing.sortOrder !== fullRowSheetRow ? { sortOrder: fullRowSheetRow } : {}),
      },
    });
    if (hasFullRowSheetRow && sheetConfig.rowIndex[existing.id] !== fullRowSheetRow) {
      await saveCpaReviewSheetConfigMap({
        ...configMap,
        [month]: { ...sheetConfig, rowIndex: { ...sheetConfig.rowIndex, [existing.id]: fullRowSheetRow } },
      });
    }
    const changedYearStatuses = extractChangedYearStatuses(merged);
    // Dùng SSN đã lưu SAU KHI merge (có thể đã có sẵn từ trước dù payload lần này rỗng SSN)
    // thay vì chỉ tin `fullRowSsn` của riêng payload này — record có thể đã có SSN từ 1 lần
    // sửa trước đó.
    const updatedCustom = updated.custom as Record<string, unknown>;
    const ssnForCaseSync = typeof updatedCustom.ssn === "string" ? updatedCustom.ssn.trim() : fullRowSsn;
    if (changedYearStatuses.length > 0 && ssnForCaseSync) after(() => syncCpaReviewStatusToCase(ssnForCaseSync, changedYearStatuses));
    const rejectedYears = extractRejectedYearStatuses(merged);
    if (rejectedYears.length > 0) {
      after(() => notifyProcessorOnRejectedCpaReviewStatus({ id: updated.id, custom: updatedCustom }, rejectedYears, NOTIFY_FROM_SHEET_SYNC));
    }
    await broadcastCpaReviewChanged(updated.id, null);
    return NextResponse.json({ ok: true, updatedAt: updated.updatedAt.toISOString() });
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
    const rejectedYearsLegacy = extractRejectedYearStatuses({ [patch.key]: patch.value });
    if (rejectedYearsLegacy.length > 0) {
      after(() => notifyProcessorOnRejectedCpaReviewStatus({ id: created.id, custom: initialCustom }, rejectedYearsLegacy, NOTIFY_FROM_SHEET_SYNC));
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
  const rejectedYearsLegacyUpdate = extractRejectedYearStatuses({ [patch.key]: patch.value });
  if (rejectedYearsLegacyUpdate.length > 0) {
    after(() =>
      notifyProcessorOnRejectedCpaReviewStatus(
        { id: updated.id, custom: updated.custom as Record<string, unknown> },
        rejectedYearsLegacyUpdate,
        NOTIFY_FROM_SHEET_SYNC
      )
    );
  }
  await broadcastCpaReviewChanged(updated.id, null);

  return NextResponse.json({ ok: true, updatedAt: updated.updatedAt.toISOString() });
}
