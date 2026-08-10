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

export interface AppendRowInput {
  refreshToken: string;
  sheetId: string;
  /** Tên tab (vd "Aug26") — xem src/lib/month-year.ts. */
  tabName: string;
  /** Cột tiền truyền vào dạng number (không phải string "$1,234") — Sheets tự nhận diện
   * là số, tự CĂN PHẢI + hiển thị theo đúng định dạng số/tiền tệ Ô ĐÓ ĐANG CÓ SẴN trên
   * Sheet thật (vd nếu cột đã format tiền tệ $ có dấu phẩy từ trước, số ghi vào tự động
   * hiện đúng vậy — không còn ép định dạng riêng từ phía app nữa). */
  values: (string | number)[];
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

/** Số cột đầu tiên (A-E) dùng để xét "dòng còn trống" — CHỈ xét đúng 5 cột này, không
 * quan tâm các cột khác trên cùng dòng có dữ liệu hay không (theo đúng yêu cầu: Sheet có
 * thể đã có sẵn dòng mẫu/placeholder do CPA tự gõ tay trước 1 phần ở cột khác, chỉ cần
 * A-E còn trống là ghi đè được). */
const LEADING_BLANK_CHECK_COLS = 5;
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

/** Quét cột A-E (bounded tới BLANK_ROW_SCAN_LIMIT dòng để dòng trống NẰM GIỮA bảng vẫn
 * được trả về đầy đủ, không bị Sheets API cắt bớt như khi dùng range không giới hạn) —
 * trả về số dòng (1-based) ĐẦU TIÊN có cả 5 cột A-E trống, hoặc null nếu không tìm thấy
 * (khi đó gọi nơi dùng sẽ tự append dòng mới ở cuối như hành vi cũ). */
async function findFirstBlankLeadingRow(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string
): Promise<number | null> {
  const lastCol = columnIndexToLetter(LEADING_BLANK_CHECK_COLS - 1);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A1:${lastCol}${BLANK_ROW_SCAN_LIMIT}`,
  });
  const rows = res.data.values ?? [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const isBlank = row
      .slice(0, LEADING_BLANK_CHECK_COLS)
      .every((cell) => cell === undefined || cell === null || String(cell).trim() === "");
    if (isBlank) return i + 1;
  }
  return null;
}

/** Ghi 1 dòng dữ liệu — ƯU TIÊN tìm dòng đã có sẵn trên Sheet nhưng còn TRỐNG Ở CỘT A-E
 * (vd dòng mẫu/placeholder CPA tự chuẩn bị trước, chỉ điền phần khác) và ghi đè thẳng vào
 * đó (values.update); CHỈ khi không tìm thấy dòng nào như vậy mới thêm dòng mới ở cuối
 * (values.append với insertDataOption "INSERT_ROWS", hành vi cũ). valueInputOption "RAW"
 * cho cả 2 trường hợp: giá trị string (vd ngày "08/10/26") được lưu ĐÚNG NGUYÊN VĂN, không
 * bị Sheets tự "USER_ENTERED" diễn giải lại (vd tự đổi "08/10/26" thành "2026-08-10") —
 * còn giá trị number (cột tiền) vẫn được Sheets lưu đúng kiểu số (RAW chỉ tắt việc PARSE
 * chuỗi thành kiểu khác, không ảnh hưởng input đã là number sẵn), tự động căn phải + hiển
 * thị theo định dạng số/tiền tệ Ô ĐÓ ĐANG CÓ SẴN trên Sheet thật. */
export async function appendRowToSheet(input: AppendRowInput): Promise<void> {
  const client = getOAuthClient("");
  client.setCredentials({ refresh_token: input.refreshToken });
  const sheets = google.sheets({ version: "v4", auth: client });
  try {
    const blankRow = await findFirstBlankLeadingRow(sheets, input.sheetId, input.tabName);
    if (blankRow) {
      const lastCol = columnIndexToLetter(input.values.length - 1);
      await sheets.spreadsheets.values.update({
        spreadsheetId: input.sheetId,
        range: `'${input.tabName}'!A${blankRow}:${lastCol}${blankRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [input.values] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: input.sheetId,
        range: `'${input.tabName}'!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [input.values] },
      });
    }
  } catch (err) {
    if (isInvalidGrantError(err)) {
      throw new GoogleAuthExpiredError("Kết nối Google đã hết hạn hoặc bị thu hồi — cần kết nối lại.");
    }
    throw new Error(mapSheetsError(err));
  }
}
