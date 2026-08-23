-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "crmLatestTtsUploadedAt" TEXT,
ADD COLUMN     "crmLatestWitUploadedAt" TEXT,
ADD COLUMN     "crmTtsCheckedAt" TIMESTAMP(3);
