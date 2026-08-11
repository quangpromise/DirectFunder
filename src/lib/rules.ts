import { RuleRecord } from "./types";
import { toPhoenixDateStr } from "./report-period";

/** "Mới" = tạo trong đúng ngày hôm nay theo giờ Phoenix (múi giờ nghiệp vụ, thống nhất với
 * mọi nơi khác dùng toPhoenixDateStr) — badge "New" (rule-card.tsx) và bộ đếm "X New Rules"
 * (top-nav.tsx) đều tự hết hiệu lực khi qua ngày mới mà không cần cron/cleanup gì thêm, vì
 * đây chỉ là phép so sánh ngày tính lại mỗi lần render. */
export function ruleIsNewToday(rule: RuleRecord, now: Date = new Date()): boolean {
  return toPhoenixDateStr(new Date(rule.createdAt)) === toPhoenixDateStr(now);
}

/** Số rule được thêm mới trong hôm nay — dùng cho badge "X New Rules" cạnh nút điều hướng
 * Rules ở các màn hình khác. Tính trên MỌI rule tạo hôm nay kể cả rule đã bị xoá sau đó
 * (vẫn tính là "vừa thêm hôm nay", đúng nghĩa "mới thêm vào" của yêu cầu). */
export function newRuleCountToday(rules: RuleRecord[], now: Date = new Date()): number {
  return rules.filter((r) => ruleIsNewToday(r, now)).length;
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
