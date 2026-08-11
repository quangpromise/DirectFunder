-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: giữ nguyên thứ tự hiển thị hiện có (trước đây là "createdAt desc", tức mới
-- nhất lên đầu) bằng cách gán sortOrder = -epoch(createdAt) tính bằng mili-giây — sort
-- tăng dần theo sortOrder sẽ cho ra đúng thứ tự mới nhất lên đầu như cũ.
UPDATE "cases" SET "sortOrder" = -1 * EXTRACT(EPOCH FROM "createdAt") * 1000;
