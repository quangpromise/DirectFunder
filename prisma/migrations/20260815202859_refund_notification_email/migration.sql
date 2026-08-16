-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "accountNumber" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "routingNumber" TEXT,
ADD COLUMN     "taxIntByYear" JSONB NOT NULL DEFAULT '{}';
