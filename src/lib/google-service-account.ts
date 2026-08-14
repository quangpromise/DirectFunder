import { google } from "googleapis";

/**
 * Client Google Sheets API dùng Service Account (tài khoản "robot" dùng chung) — KHÁC
 * hẳn google-sheets.ts (OAuth2 theo từng user cá nhân). Dùng cho đồng bộ 2 chiều "CPA
 * Review" (xem deployment-database-sync.md mục 4.22): phải tự ghi được lên Sheet mỗi khi
 * BẤT KỲ user nào (Agent/Agent Leader/Processor/Processor Leader) sửa hồ sơ, không phụ
 * thuộc việc người đó đã kết nối Google cá nhân hay chưa.
 *
 * Cần tạo Service Account trên Google Cloud Console (bật Sheets API), tải JSON key, lấy
 * `client_email`/`private_key` điền vào GOOGLE_SERVICE_ACCOUNT_EMAIL/
 * GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — rồi share quyền Editor Sheet đích cho đúng email
 * đó (Share -> dán email Service Account -> Editor), giống share cho 1 người bình
 * thường. Thiếu env -> mọi hàm ở đây throw ServiceAccountNotConfiguredError, nơi gọi (API
 * route/push job) tự bắt và no-op + log cảnh báo, KHÔNG làm crash app.
 */

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export class ServiceAccountNotConfiguredError extends Error {}

let cachedClient: InstanceType<typeof google.auth.JWT> | null = null;

function getServiceAccountClient() {
  if (cachedClient) return cachedClient;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Private key thường dán qua Vercel env dạng 1 dòng với "\n" literal thay vì xuống dòng
  // thật — cần thay lại thành newline thật thì JWT mới parse được (cùng cách xử lý phổ
  // biến với mọi biến private key PEM dán qua env var).
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new ServiceAccountNotConfiguredError(
      "Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY trong biến môi trường"
    );
  }
  const privateKey = rawKey.replace(/\\n/g, "\n");
  cachedClient = new google.auth.JWT({ email, key: privateKey, scopes: SCOPES });
  return cachedClient;
}

/** true nếu đã cấu hình đủ env — dùng để UI/API tự tắt tính năng thay vì throw giữa chừng. */
export function isServiceAccountConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

export function getServiceAccountSheetsClient(): ReturnType<typeof google.sheets> {
  const auth = getServiceAccountClient();
  return google.sheets({ version: "v4", auth });
}
