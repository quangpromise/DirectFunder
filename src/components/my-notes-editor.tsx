"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Strikethrough, Type, Highlighter, Ban } from "lucide-react";

const TEXT_COLORS = ["#e5e7eb", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#000000"];
const BG_COLORS = ["#fde047", "#fca5a5", "#86efac", "#93c5fd", "#d8b4fe", "#ffffff"];

/**
 * Rich text tối giản cho "My Notes" (thêm 2026-08-23) — đậm/nghiêng/gạch ngang/màu chữ/màu
 * nền qua contentEditable + document.execCommand, cùng triết lý ít dependency với
 * RichTextEditor/MailBodyEditor đã có. KHÁC MailBodyEditor (chỉ đổ `value` vào DOM 1 lần lúc
 * mount): editor này đồng bộ lại từ `value` MỖI KHI khác với DOM hiện tại (giống
 * RichTextEditor) — cần thiết vì nội dung nạp bất đồng bộ (fetch xong sau khi component đã
 * mount, xem MyNotesDialog) VÀ vì giờ có nhiều tab, đổi tab active phải nạp lại đúng nội dung
 * tab đó ngay (thêm 2026-08-24).
 *
 * Mỗi picker màu (thêm 2026-08-24) giờ có thêm: 1 nút "Mặc định" (bỏ hẳn màu đã áp — text dùng
 * `foreColor` giá trị "inherit", nền dùng `hiliteColor`/`backColor` giá trị "transparent", cả
 * 2 đều là cách chuẩn trình duyệt hỗ trợ để "gỡ" màu đã set qua execCommand) VÀ 1 ô
 * `<input type="color">` để chọn màu TUỲ Ý ngoài palette có sẵn (native color picker của hệ
 * điều hành/trình duyệt, không cần tự vẽ UI chọn màu).
 */
export function MyNotesEditor({
  value,
  onChange,
  placeholder,
  language,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder: string;
  language: "vi" | "en";
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [openPicker, setOpenPicker] = useState<"text" | "bg" | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
      setIsEmpty((editorRef.current.textContent ?? "").trim() === "");
    }
  }, [value]);

  function emit() {
    const html = editorRef.current?.innerHTML ?? "";
    setIsEmpty((editorRef.current?.textContent ?? "").trim() === "");
    onChange(html);
  }

  function exec(command: string) {
    editorRef.current?.focus();
    document.execCommand(command);
    emit();
  }

  function applyColor(kind: "text" | "bg", color: string) {
    editorRef.current?.focus();
    if (kind === "text") {
      document.execCommand("foreColor", false, color);
    } else if (!document.execCommand("hiliteColor", false, color)) {
      document.execCommand("backColor", false, color);
    }
    emit();
    setOpenPicker(null);
  }

  /** Gỡ màu đã áp, về lại mặc định — "inherit"/"transparent" là giá trị chuẩn trình duyệt
   * hiểu để bỏ màu chữ/màu nền đã set qua execCommand (thêm 2026-08-24). */
  function resetColor(kind: "text" | "bg") {
    applyColor(kind, kind === "text" ? "inherit" : "transparent");
  }

  return (
    <div className="relative flex h-full flex-col rounded-lg border border-border bg-bg-elevated">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          title={language === "vi" ? "In đậm" : "Bold"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("bold")}
          className="rounded-md p-1.5 text-text-dim transition hover:bg-surface-hover hover:text-text"
        >
          <Bold size={14} />
        </button>
        <button
          type="button"
          title={language === "vi" ? "In nghiêng" : "Italic"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("italic")}
          className="rounded-md p-1.5 text-text-dim transition hover:bg-surface-hover hover:text-text"
        >
          <Italic size={14} />
        </button>
        <button
          type="button"
          title={language === "vi" ? "Gạch ngang" : "Strikethrough"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("strikeThrough")}
          className="rounded-md p-1.5 text-text-dim transition hover:bg-surface-hover hover:text-text"
        >
          <Strikethrough size={14} />
        </button>

        <div className="mx-1 h-4 w-px bg-border" />

        <div className="relative">
          <button
            type="button"
            title={language === "vi" ? "Màu chữ" : "Text color"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpenPicker((p) => (p === "text" ? null : "text"))}
            className="rounded-md p-1.5 text-text-dim transition hover:bg-surface-hover hover:text-text"
          >
            <Type size={14} />
          </button>
          {openPicker === "text" && (
            <div className="absolute left-0 top-full z-10 mt-1 flex items-center gap-1 rounded-lg border border-border bg-bg-elevated p-1.5 shadow-lg">
              <button
                type="button"
                title={language === "vi" ? "Mặc định" : "Default"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => resetColor("text")}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border-strong text-text-faint transition hover:text-text"
              >
                <Ban size={12} />
              </button>
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyColor("text", color)}
                  style={{ backgroundColor: color }}
                  className="h-5 w-5 shrink-0 rounded border border-border-strong"
                />
              ))}
              <label
                title={language === "vi" ? "Tuỳ chọn màu khác" : "Custom color"}
                className="relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border border-dashed border-border-strong text-[9px] font-semibold text-text-faint hover:text-text"
              >
                +
                <input
                  type="color"
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => applyColor("text", e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            title={language === "vi" ? "Màu nền" : "Highlight color"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpenPicker((p) => (p === "bg" ? null : "bg"))}
            className="rounded-md p-1.5 text-text-dim transition hover:bg-surface-hover hover:text-text"
          >
            <Highlighter size={14} />
          </button>
          {openPicker === "bg" && (
            <div className="absolute left-0 top-full z-10 mt-1 flex items-center gap-1 rounded-lg border border-border bg-bg-elevated p-1.5 shadow-lg">
              <button
                type="button"
                title={language === "vi" ? "Mặc định" : "Default"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => resetColor("bg")}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border-strong text-text-faint transition hover:text-text"
              >
                <Ban size={12} />
              </button>
              {BG_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyColor("bg", color)}
                  style={{ backgroundColor: color }}
                  className="h-5 w-5 shrink-0 rounded border border-border-strong"
                />
              ))}
              <label
                title={language === "vi" ? "Tuỳ chọn màu khác" : "Custom color"}
                className="relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border border-dashed border-border-strong text-[9px] font-semibold text-text-faint hover:text-text"
              >
                +
                <input
                  type="color"
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => applyColor("bg", e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
            </div>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {isEmpty && (
          <span className="pointer-events-none absolute left-3 top-2 text-sm text-text-faint">{placeholder}</span>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onMouseDown={() => setOpenPicker(null)}
          className="h-full min-h-40 overflow-y-auto px-3 py-2 text-sm outline-none"
        />
      </div>
    </div>
  );
}
