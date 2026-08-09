/**
 * Kéo toàn bộ dữ liệu từ database production (Neon) về ghi đè database local — dùng khi
 * muốn local "làm mới" theo đúng dữ liệu online hiện tại (mật khẩu, hồ sơ mới...).
 *
 * KHÔNG tự động chạy nền — chỉ chạy thủ công khi cần, và LUÔN ghi đè (xoá sạch) dữ liệu
 * local hiện có bằng bản production. Không đụng gì tới production (chỉ đọc).
 *
 * Cách chạy:
 *   PROD_DATABASE_URL="postgresql://...neon.tech/..." npm run db:pull-prod
 */
import { config } from "dotenv";
config({ path: ".env.local" }); // nạp DATABASE_URL (local) — không override PROD_DATABASE_URL nếu đã truyền sẵn

import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const localUrl = process.env.DATABASE_URL;
const prodUrl = process.env.PROD_DATABASE_URL;

if (!prodUrl) {
  console.error(
    'Thiếu PROD_DATABASE_URL. Chạy lại kèm connection string Neon production, ví dụ:\n' +
      '  PROD_DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" npm run db:pull-prod'
  );
  process.exit(1);
}
if (!localUrl) {
  console.error("Thiếu DATABASE_URL cho local (kiểm tra .env.local).");
  process.exit(1);
}
if (prodUrl === localUrl) {
  console.error("PROD_DATABASE_URL và DATABASE_URL (local) đang trỏ vào CÙNG một database — dừng lại để tránh tự xoá nhầm.");
  process.exit(1);
}

const local = new PrismaClient({ adapter: new PrismaPg({ connectionString: localUrl }) });
const prod = new PrismaClient({ adapter: new PrismaPg({ connectionString: prodUrl }) });

async function main() {
  const [users, cases, appConfigs] = await Promise.all([
    prod.user.findMany(),
    prod.case.findMany(),
    prod.appConfig.findMany(),
  ]);
  console.log(`Đọc từ production: ${users.length} user, ${cases.length} case, ${appConfigs.length} dòng config.`);

  await local.$transaction(async (tx) => {
    await tx.case.deleteMany();
    await tx.user.deleteMany();
    await tx.appConfig.deleteMany();

    if (users.length) await tx.user.createMany({ data: users });
    if (cases.length) await tx.case.createMany({ data: cases as unknown as Prisma.CaseCreateManyInput[] });
    if (appConfigs.length) await tx.appConfig.createMany({ data: appConfigs as unknown as Prisma.AppConfigCreateManyInput[] });
  });

  console.log("Đã ghi đè xong: database local giờ khớp 100% với production.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await local.$disconnect();
    await prod.$disconnect();
  });
