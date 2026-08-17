-- AlterTable
ALTER TABLE "app_config" ADD COLUMN     "ringcentralSubscriptionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "ringcentralSubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "counterpartNumber" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "ringcentralMessageId" TEXT,
    "sentByUserId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sms_messages_ringcentralMessageId_key" ON "sms_messages"("ringcentralMessageId");

-- CreateIndex
CREATE INDEX "sms_messages_counterpartNumber_createdAt_idx" ON "sms_messages"("counterpartNumber", "createdAt");
