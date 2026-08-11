"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Italic } from "lucide-react";
import { stripHtmlTags } from "@/lib/rich-text";
import { useT } from "@/lib/i18n";

/** Danh sách font chọn được — cùng tinh thần dropdown font của Gmail compose (không đầy đủ
 * như Gmail nhưng đủ dùng cho nội bộ), chỉ gồm font phổ biến sẵn có trên Windows/Mac nên
 * không cần load web font. Nhãn font riêng (không phải i18n key) vì đây là TÊN font — giữ
 * nguyên như label hiển thị trong dropdown chọn font của mọi trình soạn thảo khác, không
 * dịch. Option đầu tiên (value rỗng) là "Mặc định"/"Default", lấy nhãn qua i18n riêng. */
const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Comic Sans MS", value: "'Comic Sans MS', cursive" },
];

/** Ô soạn thảo rich text tối giản (Bold/Italic/Font family) dùng chung cho khung đăng rule
 * mới lẫn khung sửa rule — dựa trên contentEditable + document.execCommand (đủ dùng cho 3
 * thao tác cơ bản này, không cần kéo theo thư viện WYSIWYG nặng). Giá trị lưu/trả ra ngoài
 * LUÔN là HTML string (đã innerHTML của vùng soạn), phía gọi chịu trách nhiệm sanitize trước
 * khi lưu xuống DB (xem sanitizeRuleHtml, gọi lại lần nữa ở server làm nguồn xử lý chính).
 *
 * Đồng bộ value từ ngoài vào contentEditable CHỈ khi khác với DOM hiện tại (so trong effect,
 * không so trong lúc gõ) — tránh việc mỗi keystroke đều ghi lại toàn bộ innerHTML sẽ làm mất
 * vị trí con trỏ (caret) giữa dòng, một cạm bẫy kinh điển khi bọc contentEditable dạng
 * controlled component. */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 22,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder: string;
  minHeight?: number;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(stripHtmlTags(value) === "");
  const [font, setFont] = useState("");

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
      setIsEmpty(stripHtmlTags(value) === "");
    }
  }, [value]);

  function emit() {
    const html = ref.current?.innerHTML ?? "";
    setIsEmpty(stripHtmlTags(html) === "");
    onChange(html);
  }

  // Enter xuống dòng bằng <br> thay vì browser mặc định bọc <div>/<p> lồng nhau — nội dung
  // phẳng hơn, dễ whitelist đúng ở sanitizeRuleHtml, và hiển thị nhất quán giữa các trình
  // duyệt. execCommand đã deprecated nhưng vẫn được mọi trình duyệt Chromium/Firefox hỗ trợ
  // đầy đủ cho các thao tác cơ bản này — cùng cơ chế nhiều editor nội bộ nhẹ ký khác vẫn dùng
  // khi không muốn kéo theo thư viện WYSIWYG nặng.
  function focusEditor() {
    ref.current?.focus();
    try {
      document.execCommand("defaultParagraphSeparator", false, "br");
    } catch {
      // Trình duyệt không hỗ trợ lệnh này -> bỏ qua, dùng hành vi mặc định của trình duyệt.
    }
  }

  function exec(cmd: string, arg?: string) {
    focusEditor();
    document.execCommand(cmd, false, arg);
    emit();
  }

  return (
    <div className="rounded-lg border border-border bg-surface focus-within:border-accent">
      <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("bold")}
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-surface-hover hover:text-text"
          title={t("richText.bold")}
        >
          <Bold size={12} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("italic")}
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-surface-hover hover:text-text"
          title={t("richText.italic")}
        >
          <Italic size={12} />
        </button>
        <select
          value={font}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const next = e.target.value;
            setFont(next);
            exec("fontName", next || "inherit");
          }}
          className="ml-1 h-6 rounded-md border border-border bg-bg-elevated px-1 text-[11px] text-text outline-none"
          title={t("richText.font")}
        >
          <option value="">{t("richText.defaultFont")}</option>
          {FONT_OPTIONS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="relative">
        {isEmpty && (
          <span className="pointer-events-none absolute left-2.5 top-1.5 text-xs text-text-faint">{placeholder}</span>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onFocus={focusEditor}
          onInput={emit}
          className="w-full overflow-y-auto px-2.5 py-1.5 text-xs text-text outline-none"
          style={{ minHeight }}
        />
      </div>
    </div>
  );
}
