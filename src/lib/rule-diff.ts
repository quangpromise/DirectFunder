import { stripHtmlTags } from "./rich-text";

/** Marker "đã xoá" tự sinh (xem appendRemovedDiff) — regex khớp CHÍNH XÁC format đã sinh ra
 * (sau khi qua sanitizeRuleHtml, style luôn chuẩn hoá về đúng 1 chuỗi này) để có thể bóc lại
 * ở lần edit kế tiếp, tránh nội dung đã đánh dấu "xoá" bị tính là "xoá thêm lần nữa" nếu vẫn
 * còn nguyên trong ô soạn thảo lúc Lưu. */
const REMOVED_MARKER_RE = /<br><span style="text-decoration: line-through">[\s\S]*?<\/span>/g;

/** Bóc mọi marker "đã xoá" (do chính appendRemovedDiff sinh ra ở lần edit trước) ra khỏi nội
 * dung — dùng làm "bản gốc" khi diff lần edit MỚI, để không lặp lại việc đánh dấu xoá cho
 * chính phần chữ gạch ngang còn sót lại từ lần trước. */
export function stripRemovedDiffMarkers(html: string): string {
  return html.replace(REMOVED_MARKER_RE, "");
}

/** Tách từ + dấu câu thành token RIÊNG (vd "phòng." -> ["phòng", "."]) — nếu chỉ split theo
 * khoảng trắng, 1 từ giống hệt nhưng đứng cuối câu (dính dấu ".") sẽ bị coi là khác từ đứng
 * giữa câu, khiến diff báo "xoá" nhầm dù nội dung thực chất không đổi (chỉ khác vị trí dấu
 * câu do câu bị rút ngắn/nối dài). \p{L}/\p{N} bắt được cả ký tự có dấu tiếng Việt. */
function tokenize(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+|[^\s]/gu) ?? [];
}

/** Ghép token đã tokenize lại thành text — token chữ/số cách nhau bằng space, token dấu câu
 * dính liền ngay vào token trước đó (không thêm space), để "về" + "." ra "về." thay vì "về .". */
function joinTokens(tokens: string[]): string {
  let out = "";
  for (const tok of tokens) {
    const isWord = /^[\p{L}\p{N}]/u.test(tok);
    if (out !== "" && isWord) out += " ";
    out += tok;
  }
  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type DiffOp = { type: "equal" | "remove" | "add"; words: string[] };

/** Diff mức TỪ bằng LCS chuẩn (DP O(n*m)) — đủ dùng cho nội dung rule (thường vài chục-vài
 * trăm từ), KHÔNG cần thư viện diff ngoài. */
function diffWords(oldWords: string[], newWords: string[]): DiffOp[] {
  const n = oldWords.length;
  const m = newWords.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldWords[i] === newWords[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  function push(type: DiffOp["type"], word: string) {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.words.push(word);
    else ops.push({ type, words: [word] });
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldWords[i] === newWords[j]) {
      push("equal", oldWords[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("remove", oldWords[i]);
      i++;
    } else {
      push("add", newWords[j]);
      j++;
    }
  }
  while (i < n) {
    push("remove", oldWords[i]);
    i++;
  }
  while (j < m) {
    push("add", newWords[j]);
    j++;
  }
  return ops;
}

/** Chặn chi phí DP O(n*m) cho trường hợp bất thường (paste nội dung cực lớn) — ngưỡng rộng
 * rãi hơn nhiều so với nội dung rule thực tế. */
const MAX_DIFF_CELLS = 400_000;

/** So khớp nội dung CŨ (đã bỏ marker "đã xoá" từ lần trước, xem stripRemovedDiffMarkers) với
 * nội dung MỚI vừa lưu, ở mức TỪ (dựa trên text thuần qua stripHtmlTags — không diff theo
 * từng tag HTML). Nếu có từ bị mất so với bản cũ, nối chúng lại thành 1 khối gạch ngang
 * (`text-decoration: line-through`, style đã nằm trong whitelist sẵn có của sanitizeRuleHtml,
 * không cần whitelist thêm gì) gắn ngay sau nội dung mới — để mọi người vẫn thấy phần vừa bị
 * xoá thay vì biến mất hẳn (yêu cầu 2026-08-20). Nội dung mới GIỮ NGUYÊN HTML gốc (không rebuild
 * từ token) nên KHÔNG mất định dạng bold/italic/font của phần giữ lại/thêm mới — chỉ phần chữ
 * bị xoá mới hiển thị dạng plain text gạch ngang (không giữ định dạng gốc của đoạn đó). */
export function appendRemovedDiff(oldHtml: string, newHtml: string): string {
  const oldWords = tokenize(stripHtmlTags(oldHtml));
  const newWords = tokenize(stripHtmlTags(newHtml));
  if (oldWords.length === 0) return newHtml;
  if (oldWords.length * newWords.length > MAX_DIFF_CELLS) return newHtml;

  const removed = diffWords(oldWords, newWords)
    .filter((op) => op.type === "remove")
    .flatMap((op) => op.words);
  if (removed.length === 0) return newHtml;

  return `${newHtml}<br><span style="text-decoration: line-through">${escapeHtml(joinTokens(removed))}</span>`;
}
