-- AlterTable
ALTER TABLE "app_config" ADD COLUMN     "cpaReviewSheetConfig" JSONB;

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "refundYearEfileDate" JSONB NOT NULL DEFAULT '{}';
