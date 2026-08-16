-- AlterTable
ALTER TABLE "app_config" ADD COLUMN     "processorReportSheetConfig" JSONB,
ADD COLUMN     "processorReportTasks" JSONB;

-- CreateTable
CREATE TABLE "processor_report_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processor_report_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processor_report_monthly_summaries" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processor_report_monthly_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "processor_report_entries_userId_date_idx" ON "processor_report_entries"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "processor_report_entries_userId_taskId_date_key" ON "processor_report_entries"("userId", "taskId", "date");

-- CreateIndex
CREATE INDEX "processor_report_monthly_summaries_month_idx" ON "processor_report_monthly_summaries"("month");

-- CreateIndex
CREATE UNIQUE INDEX "processor_report_monthly_summaries_month_taskId_userId_key" ON "processor_report_monthly_summaries"("month", "taskId", "userId");
