"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ColumnType, SelectOption } from "@/lib/types";
import { OptionBadge } from "@/components/option-badge";
import { CELL_NAV_ATTR, handleCellTab } from "@/lib/cell-nav";

type Value = string | number | boolean | null;

const MENU_MARGIN = 8;

/** "YYYY-MM-DD" (input date chuẩn HTML) hoặc "M/D/YYYY"/"M/D/YY" -> "MM/DD/YY". Giá trị
 * không khớp format nào trả nguyên văn (vd text tự do lỡ không phải ngày). */
function formatMmDdYy(raw: string): string {
  const trimmed = raw.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    return `${m.padStart(2, "0")}/${d.padStart(2, "0")}/${y.slice(2)}`;
  }
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${m.padStart(2, "0")}/${d.padStart(2, "0")}/${y.length === 4 ? y.slice(2) : y}`;
  }
  return trimmed;
}

export function EditableCell({
  value,
  type,
  editable,
  options,
  onCommit,
  dense,
  wrap,
  breakOnSpace,
  dateFormat,
  align,
  accent,
  multilineEdit,
  searchable,
}: {
  value: Value;
  type: ColumnType;
  editable: boolean;
  options?: SelectOption[];
  onCommit: (value: Value) => void;
  /** Chữ đậm + màu tương phản cao (trắng sáng ở Dark Mode/đen đậm ở Light Mode, xem
   * --text trong globals.css) thay vì text-text-dim mờ mặc định, đồng thời giảm padding
   * ngang — dùng cho các cột nội dung ngắn (Zip/Case/Money) đang bị dư khoảng trắng, ĐỒNG
   * BỘ với cách SSN/Phone/Client Name đã đổi (xem ssn-cell.tsx/client-name-cell.tsx). Mặc
   * định false để không ảnh hưởng các cột khác (Description, cột tuỳ chỉnh...). */
  dense?: boolean;
  /** Cho phép xuống dòng tự nhiên khi chữ dài quá bề rộng cột (thay vì cắt bớt + "…") — vd
   * cột Note của tab "CPA Review" (thêm 2026-08-14). Mặc định false (giữ nguyên hành vi
   * `truncate` một dòng cho mọi cột khác trong app). */
  wrap?: boolean;
  /** Tách giá trị thành nhiều dòng tại mỗi khoảng trắng — dùng cho các cột có thể chứa 2+
   * giá trị cách nhau bằng dấu cách (vd Phone/SSN/DOB của tab "CPA Review" có hồ sơ nhập 2
   * số điện thoại/SSN/ngày sinh chung 1 ô, thêm 2026-08-14). Mặc định false. */
  breakOnSpace?: boolean;
  /** Định dạng hiển thị ngày thành MM/DD/YY (không đổi giá trị lưu/giá trị đang sửa, chỉ
   * đổi CÁCH HIỂN THỊ ở view mode) — dùng cho tab "CPA Review" (thêm 2026-08-14, yêu cầu
   * "Tất cả cột ngày tháng theo format mm/dd/yy"). Kết hợp với breakOnSpace thì định dạng
   * TỪNG đoạn tách được. Mặc định không định dạng (giữ nguyên hành vi cũ mọi nơi khác). */
  dateFormat?: "mmddyy";
  /** Căn chữ trong ô — mặc định "center" (giữ nguyên hành vi cũ mọi nơi khác). "left" dùng
   * cho cột Name của tab "CPA Review" (thêm 2026-08-14, yêu cầu "Text sang trái"). */
  align?: "left" | "center";
  /** Chữ đậm màu accent xanh dương (thay cho màu mặc định) — dùng đánh dấu ô Name có gắn
   * link tới hồ sơ gốc trên Sheet (thêm 2026-08-14). Mặc định false. */
  accent?: boolean;
  /** Chỉ áp dụng với type "text" — sửa bằng <textarea> thay vì <input>, Enter vẫn lưu như
   * cũ nhưng Ctrl+Enter (hoặc Cmd+Enter trên Mac) chèn xuống dòng thay vì lưu — dùng cho các
   * ô text box của tab "CPA Review" (thêm 2026-08-14, yêu cầu "ctrl + Enter để xuống
   * dòng"). Mặc định false (giữ nguyên <input> 1 dòng ở mọi nơi khác). */
  multilineEdit?: boolean;
  /** Chỉ áp dụng với type "select" — thêm ô tìm kiếm ở đầu popup lọc theo label, dùng cho
   * dropdown có nhiều lựa chọn (Status/CRM Source của tab CPA Review, thêm 2026-08-14).
   * Mặc định false (giữ nguyên popup không có ô tìm kiếm ở mọi dropdown khác trong app). */
  searchable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Value>(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) (inputRef.current ?? textareaRef.current)?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  }

  if (type === "boolean") {
    return (
      <div className="flex h-full items-center justify-center px-2 py-1.5">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={!editable}
          onChange={(e) => onCommit(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)] disabled:opacity-40"
        />
      </div>
    );
  }

  if (type === "select") {
    return (
      <SelectCell
        value={value as string}
        options={options ?? []}
        editable={editable}
        onCommit={onCommit}
        searchable={searchable}
      />
    );
  }

  let displayText =
    type === "currency" && typeof value === "number"
      ? `$${value.toLocaleString("en-US")}`
      : value !== null && value !== "" ? String(value) : "";

  if (displayText && breakOnSpace) {
    const segments = displayText.split(/\s+/).filter(Boolean);
    displayText = (dateFormat === "mmddyy" ? segments.map(formatMmDdYy) : segments).join("\n");
  } else if (displayText && dateFormat === "mmddyy") {
    displayText = formatMmDdYy(displayText);
  }

  // pre-wrap (không phải normal) — giữ lại xuống dòng thủ công người dùng chèn bằng
  // Ctrl+Enter (multilineEdit), đồng thời vẫn tự wrap khi chữ dài quá bề rộng cột.
  const viewTextClass = wrap ? "whitespace-pre-wrap break-words" : breakOnSpace ? "whitespace-pre-line break-words" : "truncate";
  const alignClass = align === "left" ? "text-left" : "text-center";
  const colorClass = accent ? "text-accent" : undefined;

  if (!editable) {
    return (
      <div
        className={`w-full ${alignClass} ${viewTextClass} ${
          dense ? "px-1.5 py-1.5 text-[11px] font-semibold" : "px-2.5 py-1.5 text-xs"
        } ${colorClass ?? (dense ? "text-text" : "text-text-dim")}`}
        title={displayText || undefined}
      >
        {displayText || <span className="text-text-faint">—</span>}
      </div>
    );
  }

  if (editing && multilineEdit && type === "text") {
    return (
      <textarea
        ref={textareaRef}
        value={(draft as string) ?? ""}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (e.ctrlKey || e.metaKey) {
              // Chèn xuống dòng thủ công — đã xác minh qua Playwright (2026-08-14) rằng
              // trình duyệt KHÔNG có sẵn hành vi mặc định nào cho Ctrl/Cmd+Enter trên
              // <textarea> (chỉ Enter thường mới tự chèn "\n"), nên phải tự làm bằng
              // setRangeText thay vì chỉ bỏ qua preventDefault như bản trước (không có tác
              // dụng gì, đây là lý do tính năng "không dùng được" dù code tưởng đã đúng).
              e.preventDefault();
              const ta = e.currentTarget;
              const start = ta.selectionStart;
              const end = ta.selectionEnd;
              ta.setRangeText("\n", start, end, "end");
              setDraft(ta.value);
              return;
            }
            e.preventDefault();
            commit();
            return;
          }
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
            return;
          }
          handleCellTab(e, commit);
        }}
        {...{ [CELL_NAV_ATTR]: "1" }}
        className={`w-full resize-y rounded-md border border-accent bg-bg-elevated px-2 py-1 text-left text-xs outline-none`}
      />
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type === "number" || type === "currency" ? "number" : type === "date" ? "date" : type === "phone" ? "tel" : "text"}
        value={(draft as string | number) ?? ""}
        maxLength={type === "zipcode" ? 5 : undefined}
        onChange={(e) => {
          if (type === "number" || type === "currency") {
            setDraft(Number(e.target.value));
          } else if (type === "phone" || type === "digits") {
            setDraft(e.target.value.replace(/\D/g, ""));
          } else if (type === "zipcode") {
            setDraft(e.target.value.replace(/\D/g, "").slice(0, 5));
          } else {
            setDraft(e.target.value);
          }
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
          handleCellTab(e, commit);
        }}
        {...{ [CELL_NAV_ATTR]: "1" }}
        className="w-full rounded-md border border-accent bg-bg-elevated px-2 py-1 text-center text-xs outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      {...{ [CELL_NAV_ATTR]: "1" }}
      className={`w-full rounded-md ${alignClass} transition hover:bg-surface-hover ${viewTextClass} ${
        dense ? "px-1.5 py-1.5 text-[11px] font-semibold" : "px-2.5 py-1.5 text-xs"
      } ${colorClass ?? (dense ? "text-text" : "")}`}
      title={displayText || undefined}
    >
      {displayText || <span className="text-text-faint">—</span>}
    </button>
  );
}

function SelectCell({
  value,
  options,
  editable,
  onCommit,
  searchable,
}: {
  value: string | null;
  options: SelectOption[];
  editable: boolean;
  onCommit: (value: Value) => void;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, maxHeight: 320 });
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const current = options.find((o) => o.id === value);
  const filteredOptions =
    searchable && query.trim() ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : options;

  // Đo lại vị trí sau khi menu render (biết chiều cao thật) và lật lên trên nếu không đủ
  // chỗ bên dưới — tránh popup bị khuất màn hình khi ô nằm ở hàng gần cuối bảng.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    const spaceAbove = rect.top - MENU_MARGIN;
    const openUpward = menuHeight > spaceBelow && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, openUpward ? spaceAbove : spaceBelow);
    const y = openUpward ? rect.top - 4 - Math.min(menuHeight, maxHeight) : rect.bottom + 4;
    setPos((p) => (p.x === rect.left && p.y === y && p.maxHeight === maxHeight ? p : { x: rect.left, y, maxHeight }));
  }, [open, filteredOptions.length]);

  // Tự focus ô tìm kiếm ngay khi popup mở, để gõ được luôn không cần click thêm.
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  const badge = current ? (
    <OptionBadge option={current} />
  ) : (
    <span className="text-xs text-text-faint">—</span>
  );

  if (!editable) {
    return (
      <div className="flex min-w-0 items-center justify-center px-2 py-1.5">{badge}</div>
    );
  }

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ x: rect.left, y: rect.bottom + 4, maxHeight: 320 });
    setQuery("");
    setOpen((o) => !o);
  }

  return (
    <div className="relative w-full min-w-0">
      <button
        ref={triggerRef}
        onClick={openMenu}
        className="flex w-full min-w-0 items-center justify-center px-2 py-1.5 text-center transition hover:bg-surface-hover"
      >
        {badge}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className="popover fixed z-[100] flex w-44 flex-col rounded-xl p-1.5 shadow-2xl shadow-black/60"
              style={{ left: pos.x, top: pos.y, maxHeight: pos.maxHeight }}
            >
              {searchable && (
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="Tìm kiếm..."
                  className="mb-1 w-full shrink-0 rounded-lg border border-border bg-bg-elevated px-2 py-1 text-xs outline-none focus:border-accent"
                />
              )}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filteredOptions.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      onCommit(o.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-hover"
                  >
                    <OptionBadge option={o} />
                  </button>
                ))}
                {filteredOptions.length === 0 && (
                  <div className="px-2 py-2 text-xs text-text-faint">
                    {options.length === 0 ? "Chưa có lựa chọn nào." : "Không tìm thấy lựa chọn phù hợp."}
                  </div>
                )}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
