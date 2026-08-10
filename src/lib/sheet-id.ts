/** Tách Sheet ID từ URL đầy đủ Google Sheet (vd
 * "https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0" -> "ABC123") — nếu chuỗi
 * đưa vào không khớp dạng URL thì coi như đã là ID thuần, trả nguyên (trim). File thuần
 * (không import gì server-only) để dùng được cả ở client (GoogleSheetConfigDialog) lẫn
 * server nếu cần sau này — KHÔNG đặt trong google-sheets.ts vì file đó import `googleapis`
 * (server-only), import từ component client sẽ kéo theo cả googleapis vào bundle client.
 */
export function extractSheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}
