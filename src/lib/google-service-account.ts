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

/** Dán 1 khối PEM nhiều dòng (hoặc chuỗi "\n" literal) qua ô nhập text của Vercel/nơi lưu
 * env var rất dễ bị lệch định dạng (thừa/thiếu khoảng trắng, quote bao ngoài dính vào giá
 * trị, trình duyệt tự đổi \n literal thành newline thật hoặc ngược lại tuỳ cách paste) —
 * đã gặp thật (2026-08-15, dán lại nhiều lần vẫn báo "Không xác thực được Service
 * Account"). Ưu tiên đọc `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64` nếu có: base64 là 1
 * dòng, chỉ gồm ký tự an toàn, KHÔNG có \n/quote nào để bị mangle qua textarea — cách chắc
 * chắn nhất. Chỉ dùng biến `_PRIVATE_KEY` (PEM thô) làm phương án dự phòng cho tương thích
 * ngược. Sinh giá trị base64 bằng: `node -e "console.log(Buffer.from(require('fs').readFileSync('key.json','utf8').match(/\"private_key\":\s*\"(.+?)\"/)[1].replace(/\\\\n/g,'\n')).toString('base64'))"`
 * hoặc đơn giản hơn: base64 encode nguyên field `private_key` (đã có \n thật) từ file JSON
 * Service Account tải về từ Google Cloud Console. */
function resolvePrivateKey(): string | null {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64;
  if (b64 && b64.trim()) {
    try {
      const decoded = Buffer.from(b64.trim(), "base64").toString("utf8");
      if (decoded.includes("BEGIN PRIVATE KEY")) return decoded;
    } catch {
      // rơi xuống nhánh rawKey bên dưới nếu base64 tự thân không decode được.
    }
  }
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!rawKey) return null;
  // Bỏ quote bao ngoài nếu người dán lỡ copy nguyên cả `"..."` từ file .env thay vì chỉ
  // phần giá trị bên trong, rồi mới thay "\n" literal thành newline thật.
  const unquoted = rawKey.trim().replace(/^"([\s\S]*)"$/, "$1");
  return unquoted.replace(/\\n/g, "\n");
}

function getServiceAccountClient() {
  if (cachedClient) return cachedClient;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = resolvePrivateKey();
  if (!email || !privateKey) {
    throw new ServiceAccountNotConfiguredError(
      "Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY(_BASE64) trong biến môi trường"
    );
  }
  cachedClient = new google.auth.JWT({ email, key: privateKey, scopes: SCOPES });
  return cachedClient;
}

/** true nếu đã cấu hình đủ env — dùng để UI/API tự tắt tính năng thay vì throw giữa chừng. */
export function isServiceAccountConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
  );
}

export function getServiceAccountSheetsClient(): ReturnType<typeof google.sheets> {
  const auth = getServiceAccountClient();
  return google.sheets({ version: "v4", auth });
}
