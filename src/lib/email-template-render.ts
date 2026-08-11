/** Renderer template email dùng chung cho mọi mẫu mail trong app (CPA email, email khách
 * hàng...) — thay {key} bằng dữ liệu thật; token không nhận diện được (không có trong
 * `vars`) giữ nguyên. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}
