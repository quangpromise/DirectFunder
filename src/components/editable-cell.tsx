"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ColumnType, SelectOption } from "@/lib/types";
import { OptionBadge } from "@/components/option-badge";
import { CELL_NAV_ATTR, handleCellTab } from "@/lib/cell-nav";

type Value = string | number | boolean | null;

export function EditableCell({
  value,
  type,
  editable,
  options,
  onCommit,
}: {
  value: Value;
  type: ColumnType;
  editable: boolean;
  options?: SelectOption[];
  onCommit: (value: Value) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Value>(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
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
      <SelectCell value={value as string} options={options ?? []} editable={editable} onCommit={onCommit} />
    );
  }

  const displayText =
    type === "currency" && typeof value === "number"
      ? `$${value.toLocaleString("en-US")}`
      : value !== null && value !== "" ? String(value) : "";

  if (!editable) {
    return (
      <div className="truncate px-2.5 py-1.5 text-center text-xs text-text-dim" title={displayText || undefined}>
        {displayText || <span className="text-text-faint">—</span>}
      </div>
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
      className="w-full truncate rounded-md px-2.5 py-1.5 text-center text-xs transition hover:bg-surface-hover"
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
}: {
  value: string | null;
  options: SelectOption[];
  editable: boolean;
  onCommit: (value: Value) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.id === value);

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
    if (rect) setPos({ x: rect.left, y: rect.bottom + 4 });
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
              className="popover fixed z-[100] w-44 rounded-xl p-1.5 shadow-2xl shadow-black/60"
              style={{ left: pos.x, top: pos.y }}
            >
              {options.map((o) => (
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
              {options.length === 0 && (
                <div className="px-2 py-2 text-xs text-text-faint">Chưa có lựa chọn nào.</div>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
