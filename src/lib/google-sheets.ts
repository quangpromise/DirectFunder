import { google } from "googleapis";
import { columnIndexToLetter } from "./spreadsheet-letters";

/**
 * Google Sheets API qua OAuth2 THEO TỪNG USER (không phải 1 Service Account chung) —
 * mỗi Processor/Manager tự đăng nhập Google 1 lần, refresh_token lưu riêng ở
 * User.googleRefreshToken. Chỉ lưu refresh_token; access_token luôn xin mới qua
 * refresh_token ngay trước mỗi lần gọi API (đơn giản hoá, khỏi lưu/đồng bộ access_token +
 * hạn dùng riêng — refresh_token là thứ duy nhất cần bền vững).
 *
 * Cần bật Google Sheets API + tạo OAuth Client (Web application) trên Google Cloud
 * Console, đăng ký đủ redirect URI dev + production — xem .env.example.
 */

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/** Thu hồi/hết hạn refresh_token — API route bắt riêng lỗi này để trả mã cho client biết
 * cần mở lại popup kết nối Google, khác với lỗi gửi thất bại thông thường. */
export class GoogleAuthExpiredError extends Error {}

function getOAuthClient(redirectUri: string) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Thiếu GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET trong biến môi trường");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildGoogleAuthUrl(state: string, redirectUri: string): string {
  const client = getOAuthClient(redirectUri);
  return client.generateAuthUrl({
    // access_type "offline" + prompt "consent" BẮT BUỘC để Google luôn trả refresh_token
    // (mặc định Google chỉ trả refresh_token ở lần cấp quyền ĐẦU TIÊN cho 1 app).
    // "select_account" thêm vào để LUÔN hiện màn hình chọn tài khoản Google, kể cả khi
    // trình duyệt đã đăng nhập sẵn 1 tài khoản — cho phép đổi sang tài khoản Google khác
    // mỗi lần kết nối lại, thay vì tự động dùng tài khoản đang đăng nhập trong trình duyệt.
    access_type: "offline",
    prompt: "select_account consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForRefreshToken(code: string, redirectUri: string): Promise<string> {
  const client = getOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google không trả về refresh_token — thử kết nối lại và đảm bảo đồng ý đầy đủ quyền truy cập được yêu cầu."
    );
  }
  return tokens.refresh_token;
}

export interface CellWrite {
  /** Chữ cái cột Sheet đích, vd "B", "AA" (đã chuẩn hoá viết hoa) — xem
   * GoogleSheetColumnMapping.sheetColumn trong types.ts. */
  column: string;
  value: string | number;
  /** true nếu `value` là 1 công thức Sheets (vd "=HYPERLINK(...)") cần Sheets DIỄN GIẢI —
   * bắt buộc ghi bằng valueInputOption "USER_ENTERED" (RAW sẽ lưu y nguyên chuỗi
   * "=HYPERLINK(...)" dạng text, không chạy công thức). Mặc định false/undefined = ghi
   * RAW như mọi cell khác (xem writeCells — 2 loại được tách ra ghi bằng 2 lệnh riêng vì
   * valueInputOption áp dụng cho CẢ 1 lệnh batchUpdate, không chọn được theo từng ô). */
  isFormula?: boolean;
}

export interface AppendRowInput {
  refreshToken: string;
  sheetId: string;
  /** Tên tab (vd "Aug26") — xem src/lib/month-year.ts. */
  tabName: string;
  /** Danh sách (cột Sheet, giá trị) CẦN GHI — cột nào KHÔNG có trong danh sách này (kể cả
   * nằm xen giữa 2 cột có mapping) sẽ KHÔNG BAO GIỜ bị ghi/động tới, dù dòng đích là dòng
   * mới hay dòng đã có sẵn trên Sheet — an toàn tuyệt đối cho dropdown/công thức/định dạng
   * Admin đã cấu hình sẵn ở các cột khác. Giá trị number (cột tiền) Sheets tự nhận diện là
   * số, tự CĂN PHẢI + hiển thị theo đúng định dạng số/tiền tệ Ô ĐÓ ĐANG CÓ SẴN. */
  cells: CellWrite[];
}

function isInvalidGrantError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("invalid_grant");
}

export function mapSheetsError(err: unknown): string {
  const e = err as
    | {
        code?: number | string;
        response?: { status?: number; data?: { error?: { status?: string; message?: string; errors?: { reason?: string }[] } } };
        errors?: { reason?: string; message?: string }[];
        message?: string;
      }
    | undefined;
  // Gaxios/Google API error có nhiều "hình dạng" tuỳ lỗi tới từ đâu (Sheets API v4 style
  // mới dùng `response.data.error.status`, style cũ dùng `errors[].reason`, lỗi mạng/HTTP
  // thuần dùng `response.status`/`code` số) — kiểm tra đủ các dạng thay vì chỉ 1 kiểu, nếu
  // không rất dễ rơi vào nhánh "thất bại, thử lại sau" chung chung dù lỗi thật đã rõ ràng
  // (permission/not-found) chỉ vì không khớp đúng hình dạng object.
  const status = e?.response?.data?.error?.status;
  const legacyReason = e?.response?.data?.error?.errors?.[0]?.reason ?? e?.errors?.[0]?.reason;
  const httpCode = typeof e?.code === "number" ? e.code : e?.response?.status;
  const message = e?.message ?? "";

  if (status === "PERMISSION_DENIED" || legacyReason === "forbidden" || httpCode === 403) {
    return "Tài khoản Service Account chưa được cấp quyền Editor trên Sheet này — vào Google Sheet, bấm Share, dán email Service Account (xem nút Hướng dẫn) rồi chọn Editor.";
  }
  if (status === "NOT_FOUND" || legacyReason === "notFound" || httpCode === 404) {
    return "Không tìm thấy Sheet hoặc tab tương ứng — kiểm tra lại link Sheet và đảm bảo đang mở đúng tab tháng trước khi copy link.";
  }
  // Private key sai định dạng (dán thiếu/dán đè `\n` thành newline thật lẫn lộn khi lưu
  // biến môi trường trên Vercel) khiến JWT không ký được — lỗi ném ra từ thư viện crypto,
  // không đi qua HTTP nên không có status/code như các nhánh trên.
  if (/DECODER routines|invalid_grant|PEM routines|ERR_OSSL|key value mismatch/i.test(message)) {
    return "Không xác thực được Service Account — kiểm tra lại GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY trên server (thường do dán thiếu/sai định dạng khi lưu biến môi trường).";
  }
  return `Gửi dữ liệu lên Google Sheet thất bại, thử lại sau${message ? ` (${message})` : ""}.`;
}

/** Số cột đầu (A-F) dùng để Sheets xác định "dòng cuối cùng đang có dữ liệu" — CHỈ xét 6
 * cột này khi tìm điểm dừng, HOÀN TOÀN ĐỘC LẬP với việc Admin thực tế gán cột nào để ghi
 * dữ liệu (xem AppendRowInput.cells) — 2 khái niệm tách biệt: A-F chỉ dùng để dò VỊ TRÍ
 * DÒNG, không liên quan tới cột nào bị ghi. */
const APPEND_TABLE_COLS = 6;
/** Số dòng đầu tiên LUÔN bỏ qua, không xét tới khi tìm "dòng trống"/"cuối bảng" (vd 1-2
 * dòng tiêu đề + 1 dòng ghi chú của CPA) — mặc định 3. */
const SKIP_LEADING_ROWS = 3;
/** Giới hạn số dòng quét tìm dòng trống — đủ lớn cho 1 tab theo tháng, tránh quét vô hạn. */
const BLANK_ROW_SCAN_LIMIT = 2000;

export { columnIndexToLetter } from "./spreadsheet-letters";


/** Quét cột A-F (bounded, bắt đầu từ `SKIP_LEADING_ROWS + 1` — luôn bỏ qua các dòng đầu)
 * — trả về dòng ĐẦU TIÊN có cả 6 cột A-F trống (đã tồn tại sẵn trên Sheet), hoặc nếu
 * không có dòng nào như vậy, dòng NGAY SAU dòng cuối cùng có dữ liệu trong phạm vi đã
 * quét (dòng hoàn toàn mới). */
async function findTargetRow(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string
): Promise<number> {
  const lastCol = columnIndexToLetter(APPEND_TABLE_COLS - 1);
  const startRow = SKIP_LEADING_ROWS + 1;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A${startRow}:${lastCol}${startRow + BLANK_ROW_SCAN_LIMIT - 1}`,
  });
  const rows = res.data.values ?? [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const isBlank = row.every((cell) => cell === undefined || cell === null || String(cell).trim() === "");
    if (isBlank) return startRow + i;
  }
  return startRow + rows.length;
}

/** Tra gid (số) của 1 tab theo tên — batchUpdate (vd updateCells ghi Note) cần gid, không
 * nhận tên tab như values.update/get. Dùng chung cho ensureRowExists lẫn writeCellNotes. */
export async function resolveSheetGid(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string
): Promise<number> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title,gridProperties)",
  });
  const sheetMeta = meta.data.sheets?.find((s) => s.properties?.title === tabName);
  const gid = sheetMeta?.properties?.sheetId;
  if (gid === undefined || gid === null) {
    throw new Error(`Không tìm thấy tab "${tabName}" trên Google Sheet.`);
  }
  return gid;
}

/** Đảm bảo Sheet có đủ số dòng để ghi vào `targetRow` — values.update/batchUpdate KHÔNG
 * tự mở rộng grid như values.append+INSERT_ROWS, nên phải tự kiểm tra + mở rộng tay bằng
 * appendDimension nếu `targetRow` vượt quá rowCount hiện tại (trường hợp hiếm, sheet đã
 * dùng hết số dòng có sẵn). */
export async function ensureRowExists(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string,
  targetRow: number
): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title,gridProperties)",
  });
  const sheetMeta = meta.data.sheets?.find((s) => s.properties?.title === tabName);
  const gid = sheetMeta?.properties?.sheetId;
  if (gid === undefined || gid === null) {
    throw new Error(`Không tìm thấy tab "${tabName}" trên Google Sheet.`);
  }
  const rowCount = sheetMeta?.properties?.gridProperties?.rowCount ?? 0;
  if (targetRow <= rowCount) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ appendDimension: { sheetId: gid, dimension: "ROWS", length: targetRow - rowCount } }],
    },
  });
}

/** 1 ô cần ghi/xoá NOTE thật của Google Sheets (chuột phải ô → Insert note) — KHÁC hẳn giá
 * trị ô (`CellWrite`), dùng `spreadsheets.values.update` không ghi được Note, bắt buộc phải
 * qua `batchUpdate` với request `updateCells` + `fields: "note"`. Thêm 2026-08-14 cho tính
 * năng đồng bộ 2 chiều ghi chú ("insert note") cạnh ô "Ngày" mỗi năm ở tab CPA Review. */
export interface NoteWrite {
  /** Chỉ số cột 0-based (A=0), khớp cách CPA_REVIEW_SHEET_COLUMN_MAP đang dùng. */
  columnIndex: number;
  /** "" để XOÁ note hiện có (Sheets API coi note rỗng = không có note). */
  note: string;
}

/** Ghi/xoá NOTE (không phải giá trị) cho các ô đã chỉ định ở `targetRow` — mỗi ô 1 request
 * `updateCells` riêng trong CÙNG 1 batchUpdate, chỉ đụng đúng field "note", không ảnh hưởng
 * giá trị/định dạng ô. */
export async function writeCellNotes(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string,
  targetRow: number,
  notes: NoteWrite[]
): Promise<void> {
  if (notes.length === 0) return;
  const gid = await resolveSheetGid(sheets, spreadsheetId, tabName);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: notes.map((n) => ({
        updateCells: {
          range: {
            sheetId: gid,
            startRowIndex: targetRow - 1,
            endRowIndex: targetRow,
            startColumnIndex: n.columnIndex,
            endColumnIndex: n.columnIndex + 1,
          },
          rows: [{ values: [{ note: n.note || null }] }],
          fields: "note",
        },
      })),
    },
  });
}

/** Căn giữa (ngang + dọc) TOÀN BỘ 1 dòng vừa được app THÊM MỚI trên Sheet — trước đây dòng
 * mới app tự thêm giữ định dạng mặc định của Google Sheets (căn trái/dưới), lệch hẳn với các
 * dòng có sẵn do Admin gõ tay (thường đã căn giữa), báo cáo thật 2026-08-16 ("row nên là Row
 * center"). CHỈ áp dụng cho dòng MỚI (gọi từ nơi biết chắc đây là append, không phải update
 * dòng có sẵn) — không đụng định dạng dòng cũ Admin có thể đã tuỳ chỉnh riêng. */
export async function centerAlignRow(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  gid: number,
  row: number,
  lastColumnIndex: number
): Promise<void> {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: gid,
              startRowIndex: row - 1,
              endRowIndex: row,
              startColumnIndex: 0,
              endColumnIndex: lastColumnIndex + 1,
            },
            cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
            fields: "userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment",
          },
        },
      ],
    },
  });
}

/** Căn TRÁI (ngang, giữ nguyên căn dọc MIDDLE) đúng 1 CỘT tại 1 dòng — dùng để ghi đè lại
 * cột Name sau khi `centerAlignRow` đã căn giữa cả dòng (yêu cầu 2026-08-31: cột Name luôn
 * căn trái, khác mọi cột số/ngày khác vẫn căn giữa như cũ). Áp dụng cho MỌI lần ghi (kể cả
 * dòng có sẵn) vì dòng cũ có thể đã bị `centerAlignRow` căn giữa từ trước khi có yêu cầu này. */
export async function leftAlignColumn(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  gid: number,
  row: number,
  columnIndex: number
): Promise<void> {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: gid,
              startRowIndex: row - 1,
              endRowIndex: row,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
            },
            cell: { userEnteredFormat: { horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE" } },
            fields: "userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment",
          },
        },
      ],
    },
  });
}

/** Ghi 1 nhóm ô (cùng 1 valueInputOption) vào `targetRow` — mỗi ô 1 range riêng theo đúng
 * chữ cái cột Admin đã gán, không gộp/không suy đoán vị trí liền kề. */
async function writeCellGroup(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string,
  targetRow: number,
  cells: CellWrite[],
  valueInputOption: "RAW" | "USER_ENTERED"
): Promise<void> {
  if (cells.length === 0) return;
  if (cells.length === 1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!${cells[0].column}${targetRow}`,
      valueInputOption,
      requestBody: { values: [[cells[0].value]] },
    });
    return;
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption,
      data: cells.map((c) => ({
        range: `'${tabName}'!${c.column}${targetRow}`,
        values: [[c.value]],
      })),
    },
  });
}

/** Ghi các ô đã CHỈ ĐỊNH SẴN cột (`cells`) vào đúng `targetRow` — cột nào không có trong
 * `cells` (dù nằm giữa 2 cột khác có ghi) tuyệt đối không bị đụng tới. Tách thành 2 lệnh
 * ghi riêng theo `isFormula` vì 1 lệnh batchUpdate/update chỉ nhận đúng 1 valueInputOption
 * áp dụng cho mọi ô trong lệnh đó — không trộn RAW (dữ liệu thường) và USER_ENTERED (công
 * thức, vd HYPERLINK cho Client Name) chung 1 lệnh được. */
export async function writeCells(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string,
  targetRow: number,
  cells: CellWrite[]
): Promise<void> {
  const formulaCells = cells.filter((c) => c.isFormula);
  const rawCells = cells.filter((c) => !c.isFormula);
  await writeCellGroup(sheets, spreadsheetId, tabName, targetRow, rawCells, "RAW");
  await writeCellGroup(sheets, spreadsheetId, tabName, targetRow, formulaCells, "USER_ENTERED");
}

/** Ghi 1 dòng dữ liệu — tự tìm dòng đích qua `findTargetRow` (bỏ qua `SKIP_LEADING_ROWS`
 * dòng đầu, chỉ xét cột A-F để xác định "trống"), tự mở rộng Sheet nếu cần qua
 * `ensureRowExists`, rồi ghi TỪNG Ô đúng cột Admin đã gán qua `writeCells` — không bao giờ
 * đụng tới cột nào ngoài danh sách `cells`, dù dòng đích là dòng mới hay dòng có sẵn.
 * valueInputOption "RAW": giá trị string (vd ngày "08/10/26") được lưu ĐÚNG NGUYÊN VĂN,
 * không bị Sheets tự "USER_ENTERED" diễn giải lại (vd tự đổi "08/10/26" thành
 * "2026-08-10") — còn giá trị number (cột tiền) vẫn được Sheets lưu đúng kiểu số, tự động
 * căn phải + hiển thị theo định dạng số/tiền tệ Ô ĐÓ ĐANG CÓ SẴN trên Sheet thật. */
export async function appendRowToSheet(input: AppendRowInput): Promise<void> {
  const client = getOAuthClient("");
  client.setCredentials({ refresh_token: input.refreshToken });
  const sheets = google.sheets({ version: "v4", auth: client });
  try {
    if (input.cells.length === 0) return;
    const targetRow = await findTargetRow(sheets, input.sheetId, input.tabName);
    await ensureRowExists(sheets, input.sheetId, input.tabName, targetRow);
    await writeCells(sheets, input.sheetId, input.tabName, targetRow, input.cells);
  } catch (err) {
    if (isInvalidGrantError(err)) {
      throw new GoogleAuthExpiredError("Kết nối Google đã hết hạn hoặc bị thu hồi — cần kết nối lại.");
    }
    throw new Error(mapSheetsError(err));
  }
}
