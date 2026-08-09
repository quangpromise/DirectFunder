"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Type, Highlighter } from "lucide-react";

const TOOLBAR_BUTTONS = [
  { command: "bold", icon: Bold, labelVi: "Đậm", labelEn: "Bold" },
  { command: "italic", icon: Italic, labelVi: "Nghiêng", labelEn: "Italic" },
  { command: "underline", icon: Underline, labelVi: "Gạch dưới", labelEn: "Underline" },
  { command: "insertUnorderedList", icon: List, labelVi: "Danh sách", labelEn: "Bullet list" },
  { command: "insertOrderedList", icon: ListOrdered, labelVi: "Danh sách số", labelEn: "Numbered list" },
] as const;

const TEXT_COLORS = ["#e5e7eb", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#000000"];
const BG_COLORS = ["#fde047", "#fca5a5", "#86efac", "#93c5fd", "#d8b4fe", "#ffffff"];

/**
 * Rich text tối giản KHÔNG dùng thư viện ngoài (giữ đúng triết lý ít dependency của
 * repo) — contentEditable + document.execCommand cho đủ bộ định dạng cơ bản (đậm/
 * nghiêng/gạch dưới/danh sách/màu chữ/màu nền) theo yêu cầu, sinh ra HTML thật để gửi
 * qua nodemailer `html:`. `value` chỉ đổ vào DOM 1 LẦN lúc mount/khi editor được cấp
 * lại key mới (xem cách dùng ở send-cpa-email-dialog.tsx: đổi `key` mỗi lần dialog mở
 * lại để reset nội dung mặc định) — không re-render theo mỗi keystroke để tránh bug
 * kinh điển "nhảy con trỏ" của contentEditable kết hợp React controlled value.
 */
export function MailBodyEditor({
  value,
  onChange,
  disabled,
  language,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  language: "vi" | "en";
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [openPicker, setOpenPicker] = useState<"text" | "bg" | null>(null);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exec(command: string) {
    editorRef.current?.focus();
    document.execCommand(command);
    onChange(editorRef.current?.innerHTML ?? "");
  }

  function applyColor(kind: "text" | "bg", color: string) {
    editorRef.current?.focus();
    if (kind === "text") {
      document.execCommand("foreColor", false, color);
    } else {
      // hiliteColor hoạt động trên Chromium (Playwright/Chrome) — fallback backColor cho
      // trình duyệt không hỗ trợ (Safari cũ).
      if (!document.execCommand("hiliteColor", false, color)) {
        document.execCommand("backColor", false, color);
      }
    }
    onChange(editorRef.current?.innerHTML ?? "");
    setOpenPicker(null);
  }

  return (
    <div className="relative rounded-lg border border-border bg-bg-elevated">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {TOOLBAR_BUTTONS.map(({ command, icon: Icon, labelVi, labelEn }) => (
          <button
            key={command}
            type="button"
            title={language === "vi" ? labelVi : labelEn}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(command)}
            className="rounded-md p-1.5 text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon size={14} />
          </button>
        ))}

        <div className="mx-1 h-4 w-px bg-border" />

        <div className="relative">
          <button
            type="button"
            title={language === "vi" ? "Màu chữ" : "Text color"}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpenPicker((p) => (p === "text" ? null : "text"))}
            className="rounded-md p-1.5 text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Type size={14} />
          </button>
          {openPicker === "text" && (
            <div className="absolute left-0 top-full z-10 mt-1 flex gap-1 rounded-lg border border-border bg-bg-elevated p-1.5 shadow-lg">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyColor("text", color)}
                  style={{ backgroundColor: color }}
                  className="h-5 w-5 rounded border border-border-strong"
                />
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            title={language === "vi" ? "Màu nền" : "Highlight color"}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpenPicker((p) => (p === "bg" ? null : "bg"))}
            className="rounded-md p-1.5 text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Highlighter size={14} />
          </button>
          {openPicker === "bg" && (
            <div className="absolute left-0 top-full z-10 mt-1 flex gap-1 rounded-lg border border-border bg-bg-elevated p-1.5 shadow-lg">
              {BG_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyColor("bg", color)}
                  style={{ backgroundColor: color }}
                  className="h-5 w-5 rounded border border-border-strong"
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        onInput={() => onChange(editorRef.current?.innerHTML ?? "")}
        onMouseDown={() => setOpenPicker(null)}
        suppressContentEditableWarning
        className="max-h-56 min-h-32 overflow-y-auto px-3 py-2 text-sm outline-none [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  );
}
