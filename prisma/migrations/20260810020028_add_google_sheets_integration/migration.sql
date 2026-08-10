-- AlterTable
ALTER TABLE "app_config" ADD COLUMN     "googleSheetConfig" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "googleRefreshToken" TEXT;
