/**
 * Đặt lại mật khẩu 1 tài khoản trên database production (Neon) — dùng khi bị khoá hoàn
 * toàn, không còn tài khoản nào đăng nhập được để tự vào trang Quản lý tài khoản.
 *
 * KHÔNG đụng gì khác ngoài đúng field passwordHash của đúng 1 email được chỉ định.
 *
 * Cách chạy (thay email/mật khẩu mới, KHÔNG commit connection string thật vào đâu cả):
 *   PROD_DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" \
 *   RESET_EMAIL="admin@directfunder.com" \
 *   RESET_PASSWORD="mat-khau-moi" \
 *   npx tsx prisma/reset-admin-password.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";

const prodUrl = process.env.PROD_DATABASE_URL;
const email = process.env.RESET_EMAIL?.trim().toLowerCase();
const newPassword = process.env.RESET_PASSWORD;

if (!prodUrl) {
  console.error("Thiếu PROD_DATABASE_URL (connection string Neon production).");
  process.exit(1);
}
if (!email) {
  console.error("Thiếu RESET_EMAIL.");
  process.exit(1);
}
if (!newPassword || newPassword.length < 8) {
  console.error("Thiếu RESET_PASSWORD hoặc mật khẩu quá ngắn (cần >= 8 ký tự).");
  process.exit(1);
}

const prod = new PrismaClient({ adapter: new PrismaPg({ connectionString: prodUrl }) });

async function main() {
  const user = await prod.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Không tìm thấy tài khoản với email "${email}" trên production.`);
    process.exit(1);
  }
  const passwordHash = await hashPassword(newPassword);
  await prod.user.update({ where: { email }, data: { passwordHash } });
  console.log(`Đã đặt lại mật khẩu cho ${email} (role: ${user.role}) trên production.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prod.$disconnect();
  });
