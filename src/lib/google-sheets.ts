import { google } from "googleapis";

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

function mapSheetsError(err: unknown): string {
  const e = err as
    | { code?: number; response?: { data?: { error?: { status?: string; message?: string } } }; message?: string }
    | undefined;
  const status = e?.response?.data?.error?.status;
  const httpCode = e?.code;
  if (status === "PERMISSION_DENIED" || httpCode === 403) {
    return "Tài khoản Google của bạn chưa được cấp quyền Editor trên Sheet này — liên hệ Admin để chia sẻ quyền.";
  }
  if (status === "NOT_FOUND" || httpCode === 404) {
    return "Không tìm thấy Sheet hoặc tab tương ứng — kiểm tra lại Sheet ID và tên tab tháng trên Google Sheet.";
  }
  return "Gửi dữ liệu lên Google Sheet thất bại, thử lại sau.";
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

function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

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

/** Đảm bảo Sheet có đủ số dòng để ghi vào `targetRow` — values.update/batchUpdate KHÔNG
 * tự mở rộng grid như values.append+INSERT_ROWS, nên phải tự kiểm tra + mở rộng tay bằng
 * appendDimension nếu `targetRow` vượt quá rowCount hiện tại (trường hợp hiếm, sheet đã
 * dùng hết số dòng có sẵn). Trả về sheetId dạng số (gid) — batchUpdate cần gid, không nhận
 * tên tab. */
async function ensureRowExists(
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
async function writeCells(
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
