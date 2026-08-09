"use client";

import { useEffect, useRef, useState } from "react";
import { formatSsn, isValidSsn } from "@/lib/ssn";
import { useT } from "@/lib/i18n";
import { CELL_NAV_ATTR, handleCellTab } from "@/lib/cell-nav";

function SsnSlot({
  value,
  editable,
  isDuplicate,
  onCommit,
}: {
  value: string | null;
  editable: boolean;
  isDuplicate: (candidate: string) => boolean;
  onCommit: (value: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("");
      setEditing(false);
      if (value !== null) onCommit(null);
      return;
    }
    if (!isValidSsn(trimmed)) {
      setError(t("ssn.errFormat"));
      return;
    }
    if (isDuplicate(trimmed)) {
      setError(t("ssn.errDuplicate"));
      return;
    }
    setError("");
    setEditing(false);
    if (trimmed !== value) onCommit(trimmed);
  }

  if (editing) {
    return (
      <div className="px-1.5 py-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(formatSsn(e.target.value));
            setError("");
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(value ?? "");
              setError("");
              setEditing(false);
            }
            handleCellTab(e, commit);
          }}
          {...{ [CELL_NAV_ATTR]: "1" }}
          placeholder="xxx-xx-xxxx"
          maxLength={11}
          className={`w-full rounded-md border bg-bg-elevated px-1.5 py-0.5 text-center text-xs outline-none ${
            error ? "border-red-500" : "border-accent"
          }`}
        />
        {error && <div className="mt-0.5 text-center text-[10px] leading-tight text-red-400">{error}</div>}
      </div>
    );
  }

  if (!editable) {
    return (
      <div className="truncate px-2 py-0.5 text-center text-xs text-text-dim">
        {value || <span className="text-text-faint">—</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      {...{ [CELL_NAV_ATTR]: "1" }}
      className="w-full truncate rounded-md px-2 py-0.5 text-center text-xs transition hover:bg-surface-hover"
    >
      {value || <span className="text-text-faint">{t("ssn.add")}</span>}
    </button>
  );
}

export function SsnCell({
  value,
  editable,
  isDuplicate,
  onCommit,
}: {
  value: [string | null, string | null];
  editable: boolean;
  isDuplicate: (slot: 0 | 1, candidate: string) => boolean;
  onCommit: (slot: 0 | 1, value: string | null) => void;
}) {
  return (
    <div className="flex flex-col justify-center gap-0.5 py-1">
      <SsnSlot
        value={value[0]}
        editable={editable}
        isDuplicate={(c) => isDuplicate(0, c)}
        onCommit={(v) => onCommit(0, v)}
      />
      <SsnSlot
        value={value[1]}
        editable={editable}
        isDuplicate={(c) => isDuplicate(1, c)}
        onCommit={(v) => onCommit(1, v)}
      />
    </div>
  );
}
