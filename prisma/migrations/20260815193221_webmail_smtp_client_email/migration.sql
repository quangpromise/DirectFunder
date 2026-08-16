/*
  Warnings:

  - You are about to drop the column `microsoftRefreshToken` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "microsoftRefreshToken",
ADD COLUMN     "webmailPasswordEncrypted" TEXT,
ADD COLUMN     "webmailUsername" TEXT;
