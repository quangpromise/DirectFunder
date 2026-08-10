-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "dateOfBirth" JSONB,
ADD COLUMN     "email" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "phone2" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "refunds" JSONB NOT NULL DEFAULT '{}';
