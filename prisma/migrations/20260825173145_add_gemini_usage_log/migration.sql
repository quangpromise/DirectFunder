-- CreateTable
CREATE TABLE "gemini_usage_logs" (
    "id" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalTokens" INTEGER NOT NULL,

    CONSTRAINT "gemini_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gemini_usage_logs_requestedAt_idx" ON "gemini_usage_logs"("requestedAt");
