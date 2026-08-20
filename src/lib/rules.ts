import { RuleRecord } from "./types";
import { toPhoenixDateStr } from "./report-period";

/** "Mới" = TẠO hoặc SỬA trong đúng ngày hôm nay theo giờ Phoenix (múi giờ nghiệp vụ, thống
 * nhất với mọi nơi khác dùng toPhoenixDateStr) — badge "New" (rule-card.tsx) và bộ đếm "X New
 * Rules" (top-nav.tsx) đều tự hết hiệu lực khi qua ngày mới mà không cần cron/cleanup gì
 * thêm, vì đây chỉ là phép so sánh ngày tính lại mỗi lần render. Tính cả `updatedAt` (không
 * chỉ `createdAt`) để rule vừa được Quản lý sửa hôm nay cũng nhấp nháy "New" lại, nhắc user
 * khác chú ý có cập nhật (yêu cầu 2026-08-20) — không chỉ giới hạn ở rule tạo mới hoàn toàn. */
export function ruleIsNewToday(rule: RuleRecord, now: Date = new Date()): boolean {
  const today = toPhoenixDateStr(now);
  return toPhoenixDateStr(new Date(rule.createdAt)) === today || toPhoenixDateStr(new Date(rule.updatedAt)) === today;
}

/** Số rule ACTIVE (chưa xoá) được thêm mới trong hôm nay — dùng cho badge số trên nút Rules
 * (RulesPanel). Loại rule đã xoá (deletedAt != null) ra khỏi phép đếm — khớp đúng hành vi
 * badge "New" trên từng rule card (isNew = !deleted && ruleIsNewToday), để nếu xoá hết rule
 * active hôm nay thì badge tắt hẳn thay vì vẫn đếm rule đã xoá. */
export function newRuleCountToday(rules: RuleRecord[], now: Date = new Date()): number {
  return rules.filter((r) => !r.deletedAt && ruleIsNewToday(r, now)).length;
}

/** Sắp xếp hiển thị: rule còn hiệu lực (chưa xoá) theo mới nhất lên đầu, rule đã xoá dồn
 * xuống cuối (theo thời điểm xoá gần nhất lên trước trong nhóm đó) — khớp yêu cầu "xóa thì
 * đẩy xuống dưới cùng" thay vì ẩn hẳn. */
export function sortRulesForDisplay(rules: RuleRecord[]): RuleRecord[] {
  const active = rules.filter((r) => !r.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const deleted = rules
    .filter((r) => r.deletedAt)
    .sort((a, b) => (b.deletedAt as string).localeCompare(a.deletedAt as string));
  return [...active, ...deleted];
}
