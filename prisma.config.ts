import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Next.js dùng .env.local cho secret cục bộ (đã có trong .gitignore qua ".env*"); Prisma
// CLI chạy độc lập với Next nên phải tự nạp file này (dotenv/config mặc định chỉ đọc .env).
config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
