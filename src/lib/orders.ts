import { OrderRecord, OrderType } from "./types";

/** true nếu hồ sơ đang có ít nhất 1 order thuộc `type` chưa Done — dùng để khóa nút
 * Order tương ứng ở bảng Hồ sơ (tránh tạo 2 order cùng lúc cho cùng 1 loại). */
export function hasActiveOrder(orders: OrderRecord[], type: OrderType): boolean {
  return orders.some((o) => o.type === type && o.status !== "done");
}
