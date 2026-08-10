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

/** Số cột đầu (A-F) dùng để Sheets xác định "dòng cuối cùng đang có dữ liệu" — CHỈ xét 6
 * cột này, bỏ qua dữ liệu ở cột G trở đi khi tìm điểm dừng (vd nếu 1 dòng có ghi chú/màu
 * nền ở cột xa hơn nhưng A-F còn trống, Sheets vẫn coi dòng đó là "trống" và ghi đè vào,
 * KHÔNG nhảy qua thêm 1 dòng mới). */
const APPEND_TABLE_COLS = 6;
/** Số dòng đầu tiên LUÔN bỏ qua, không xét tới khi tìm "dòng trống"/"cuối bảng" (vd 1-2
 * dòng tiêu đề + 1 dòng ghi chú của CPA) — mặc định 3, xem cách dùng ở appendRowToSheet. */
const SKIP_LEADING_ROWS = 3;

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

/** Ghi 1 dòng vào cuối tab — dùng spreadsheets.values.append với insertDataOption
 * "INSERT_ROWS": Google Sheets API tự tìm "dòng cuối cùng của bảng" rồi thêm dòng mới
 * ngay sau đó. Phạm vi truyền vào CHỈ giới hạn cột A-F (`APPEND_TABLE_COLS`) — Sheets chỉ
 * xét dữ liệu trong 6 cột này để xác định "cuối bảng", nên nếu dòng cuối cùng có dữ liệu
 * A-F đã tồn tại nhưng dòng NGAY SAU nó (dòng "gần nhất") chưa có gì ở A-F, Sheets sẽ điền
 * thẳng vào đúng dòng trống đó thay vì luôn nhảy xuống dòng mới — không cần tự dò/ghi đè
 * tay (an toàn hơn: đây là hành vi gốc của Sheets API, không có rủi ro ghi đè nhầm dòng
 * tiêu đề hay dòng giữa bảng như cách tự quét trước đó). Phạm vi bắt đầu ở dòng
 * `SKIP_LEADING_ROWS + 1` (mặc định dòng 4) — 3 dòng đầu (tiêu đề/ghi chú) LUÔN bị bỏ qua,
 * không bao giờ được coi là "dòng trống" để ghi đè, kể cả khi A-F ở đó thực sự trống.
 * valueInputOption "RAW": giá trị string (vd ngày "08/10/26") được lưu ĐÚNG NGUYÊN VĂN,
 * không bị Sheets tự "USER_ENTERED" diễn giải lại (vd tự đổi "08/10/26" thành
 * "2026-08-10") — còn giá trị number (cột tiền) vẫn được Sheets lưu đúng kiểu số (RAW chỉ
 * tắt việc PARSE chuỗi thành kiểu khác, không ảnh hưởng input đã là number sẵn), tự động
 * căn phải + hiển thị theo định dạng số/tiền tệ Ô ĐÓ ĐANG CÓ SẴN trên Sheet thật. */
export async function appendRowToSheet(input: AppendRowInput): Promise<void> {
  const client = getOAuthClient("");
  client.setCredentials({ refresh_token: input.refreshToken });
  const sheets = google.sheets({ version: "v4", auth: client });
  try {
    const lastTableCol = columnIndexToLetter(APPEND_TABLE_COLS - 1);
    const startRow = SKIP_LEADING_ROWS + 1;
    await sheets.spreadsheets.values.append({
      spreadsheetId: input.sheetId,
      range: `'${input.tabName}'!A${startRow}:${lastTableCol}${startRow}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [input.values] },
    });
  } catch (err) {
    if (isInvalidGrantError(err)) {
      throw new GoogleAuthExpiredError("Kết nối Google đã hết hạn hoặc bị thu hồi — cần kết nối lại.");
    }
    throw new Error(mapSheetsError(err));
  }
}
