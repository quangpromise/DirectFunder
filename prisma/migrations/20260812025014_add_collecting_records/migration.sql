-- AlterTable
ALTER TABLE "app_config" ADD COLUMN     "collectingColumns" JSONB;

-- CreateTable
CREATE TABLE "collecting_records" (
    "id" TEXT NOT NULL,
    "custom" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collecting_records_pkey" PRIMARY KEY ("id")
);
