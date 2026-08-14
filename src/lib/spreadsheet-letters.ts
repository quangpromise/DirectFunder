/**
 * Thuần thuật toán, KHÔNG import gì khác — cố ý tách riêng khỏi google-sheets.ts để module
 * này an toàn dùng được cả ở Client Component (vd. cpa-review/page.tsx vẽ hàng chữ cái kiểu
 * Google Sheet). google-sheets.ts kéo theo `googleapis`/`google-auth-library` (dùng
 * child_process/fs) — nếu 1 Client Component import trực tiếp hoặc gián tiếp từ đó, Next.js
 * sẽ cố bundle các module Node-only này cho browser và vỡ build ("Module not found: Can't
 * resolve 'child_process'").
 */
export function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
