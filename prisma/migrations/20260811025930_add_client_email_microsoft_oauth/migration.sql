-- AlterTable
ALTER TABLE "app_config" ADD COLUMN     "clientEmailTemplate" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "microsoftRefreshToken" TEXT;
