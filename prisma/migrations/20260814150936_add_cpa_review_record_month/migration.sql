-- Thêm cột "month" (YYYY-MM) cho CpaReviewRecord — mỗi tháng giờ là 1 bảng dữ liệu/kết nối
-- Sheet độc lập (trước đó chỉ có 1 Sheet dùng chung mọi tháng). Additive-first: thêm cột
-- nullable trước, backfill dữ liệu cũ, rồi mới khoá NOT NULL — tránh lỗi khi bảng đã có dữ
-- liệu (108 dòng test tháng 8/2026 lúc viết migration này).
ALTER TABLE "cpa_review_records" ADD COLUMN "month" TEXT;

-- Dữ liệu hiện có đều thuộc kết nối Sheet tháng 8/2026 (tháng hiện tại lúc tính năng đồng bộ
-- 2 chiều được xây) — gán để không dòng nào "biến mất" khỏi bảng tháng 8 sau migration.
UPDATE "cpa_review_records" SET "month" = '2026-08' WHERE "month" IS NULL;

ALTER TABLE "cpa_review_records" ALTER COLUMN "month" SET NOT NULL;

CREATE INDEX "cpa_review_records_month_idx" ON "cpa_review_records"("month");

-- Đổi AppConfig.cpaReviewSheetConfig từ 1 object dùng chung mọi tháng thành map theo tháng
-- (Record<"YYYY-MM", CpaReviewSheetConfig>) — reshape dữ liệu JSON hiện có (nếu đã kết nối),
-- KHÔNG đổi kiểu cột (vẫn Json?, an toàn/additive).
UPDATE "app_config"
SET "cpaReviewSheetConfig" = jsonb_build_object('2026-08', "cpaReviewSheetConfig")
WHERE "id" = 'singleton' AND "cpaReviewSheetConfig" IS NOT NULL;
