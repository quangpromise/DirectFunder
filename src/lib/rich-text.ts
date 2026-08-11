/** Sanitize HTML nhập từ RichTextEditor (bold/italic/font family, xem
 * src/components/rich-text-editor.tsx) trước khi lưu — dùng chung được ở cả client (defense-
 * in-depth trước khi render lại) lẫn server (nguồn xử lý chính, xem POST/PATCH /api/rules),
 * KHÔNG phụ thuộc DOM/DOMParser (Node không có sẵn) nên chỉ xử lý bằng regex trên chuỗi. Chỉ
 * whitelist đúng những gì toolbar có thể sinh ra — mọi tag/attribute khác bị loại bỏ (giữ lại
 * text bên trong, không xoá nội dung), phòng trường hợp người dùng paste HTML từ nguồn khác. */

const ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "span", "font", "br", "div"]);
const ALLOWED_STYLE_PROPS = new Set(["font-family", "font-weight", "font-style", "text-decoration"]);

function sanitizeStyleValue(raw: string): string {
  const parts = raw.split(";");
  const kept: string[] = [];
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (!prop || !value) continue;
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if (/url\(|expression\(|javascript:/i.test(value)) continue;
    kept.push(`${prop}: ${value.replace(/["']/g, "")}`);
  }
  return kept.join("; ");
}

function extractAttr(attrsRaw: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(attrsRaw);
  if (!m) return null;
  return m[1] ?? m[2] ?? "";
}

export function sanitizeRuleHtml(html: string): string {
  if (!html) return "";
  // Bỏ hẳn nội dung bên trong script/style — không được whitelist ở dưới nên phần tag sẽ
  // bị loại, nhưng nội dung text bên trong (mã JS/CSS) cần loại bỏ luôn, không giữ lại.
  let out = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\/?>/g, (match, tagRaw: string, attrsRaw: string) => {
    const tag = tagRaw.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    const isClosing = match.startsWith("</");
    if (isClosing) return `</${tag}>`;
    if (tag === "br") return "<br>";

    let attrs = "";
    if (tag === "span" || tag === "div") {
      const style = extractAttr(attrsRaw, "style");
      if (style) {
        const cleaned = sanitizeStyleValue(style);
        if (cleaned) attrs += ` style="${cleaned}"`;
      }
    }
    if (tag === "font") {
      const face = extractAttr(attrsRaw, "face");
      if (face) {
        const cleanedFace = face.replace(/[^a-zA-Z0-9 ,'-]/g, "").slice(0, 60);
        if (cleanedFace) attrs += ` face="${cleanedFace}"`;
      }
    }
    return `<${tag}${attrs}>`;
  });

  return out;
}

/** Rule tạo TRƯỚC khi có RichTextEditor (2026-08-11) lưu content dạng plain text với "\n"
 * xuống dòng thật — sanitizeRuleHtml không tự chuyển "\n" thành <br>, nên render thẳng qua
 * dangerouslySetInnerHTML sẽ mất xuống dòng. Nhận diện "chưa từng qua editor mới" bằng cách
 * kiểm tra có tag HTML nào không; nếu không có, coi là plain text cũ và tự chuyển "\n" ->
 * "<br>" trước khi sanitize, để hiển thị đúng như textarea cũ từng làm. */
export function toRuleDisplayHtml(raw: string): string {
  const looksLikeHtml = /<[a-zA-Z][^<>]*>/.test(raw);
  const html = looksLikeHtml ? raw : raw.replace(/\n/g, "<br>");
  return sanitizeRuleHtml(html);
}

/** Bóc text thuần từ HTML đã nhập (thay <br>/<div> bằng khoảng trắng, decode vài entity phổ
 * biến) — dùng để kiểm tra rule có thực sự rỗng hay không (contentEditable rỗng vẫn có thể
 * để lại "<br>" hoặc "<div><br></div>", .trim() thường trên chuỗi HTML sẽ không phát hiện ra). */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
