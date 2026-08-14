/** Tiện ích chỉnh màu cho badge trạng thái (Status/Order Status) — các màu pastel
 * (#93c5fd, #fcd34d...) vốn chọn để dễ đọc trên nền tối; ở Light Mode cùng màu đó trên
 * nền sáng lại rất khó đọc, nên cần đậm hơn + nền badge rõ hơn. Dùng ở OptionBadge. */

/** Trộn màu hex với đen theo tỉ lệ amount (0-1) để có bản đậm hơn, dễ đọc trên nền sáng. */
export function darkenHex(hex: string, amount: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const mix = (c: number) => Math.round(c * (1 - amount));
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Đổi alpha của chuỗi "rgba(r, g, b, a)" — giữ nguyên r/g/b, chỉ thay độ đậm nền badge. */
export function withAlpha(rgba: string, alpha: number): string {
  const m = /^rgba?\(([^)]+)\)$/.exec(rgba);
  if (!m) return rgba;
  const [r, g, b] = m[1].split(",").map((p) => p.trim());
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** hex "#rrggbb" -> "rgba(r,g,b,0.15)" — độ mờ chuẩn dùng cho nền badge SelectOption.bg
 * (xem OptionBadge). Trước đây lặp lại y hệt ở 4 nơi quản lý options khác nhau
 * (ColumnSettingsDialog/AddColumnDialog/RefundStatusOptionsManager/CpaReviewStatusOptions),
 * gộp về đây dùng chung. */
export function hexToRgba15(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.15)`;
}

/** Chiều ngược lại — đọc r/g/b từ "rgba(...)" ra "#rrggbb" cho input màu HTML. */
export function rgbaToHex(rgba: string): string {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "#3b82f6";
  const [, r, g, b] = m;
  return `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}

/** true nếu màu hex đủ SÁNG để chữ/tick đè lên cần dùng mực đen thay vì trắng (kiểm tra
 * checkmark ô đang chọn trong ColorSwatchPicker luôn đọc được trên mọi ô màu). */
export function isLightHex(hex: string): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return true;
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}
