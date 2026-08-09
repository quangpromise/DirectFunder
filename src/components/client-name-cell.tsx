"use client";

import { useEffect, useRef, useState } from "react";
import { ClientNameEntry } from "@/lib/types";
import { ClientLinkButton } from "@/components/client-link-button";
import { CELL_NAV_ATTR, handleCellTab } from "@/lib/cell-nav";

function NameField({
  value,
  placeholder,
  editable,
  hasLink,
  onCommit,
}: {
  value: string;
  placeholder: string;
  editable: boolean;
  hasLink: boolean;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
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
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-md border border-accent bg-bg-elevated px-1.5 py-0.5 text-center text-xs outline-none"
      />
    );
  }

  // Có link đính kèm (kiểu hyperlink Excel) -> đổi màu chữ tên khách sang xanh dương
  // sáng để nhận biết ngay trên bảng, không cần hover vào icon link.
  const linkColorClass = hasLink && value ? "text-blue-400" : "";

  if (!editable) {
    return (
      <div
        className={`min-w-0 flex-1 truncate px-1.5 py-0.5 text-center text-xs ${linkColorClass || "text-text-dim"}`}
        title={value || undefined}
      >
        {value || <span className="text-text-faint">—</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title={value || undefined}
      {...{ [CELL_NAV_ATTR]: "1" }}
      className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-0.5 text-center text-xs transition hover:bg-surface-hover ${linkColorClass}`}
    >
      {value || <span className="text-text-faint">{placeholder}</span>}
    </button>
  );
}

function ClientSlot({
  entry,
  editable,
  hasLink,
  onCommitFirstName,
  onCommitLastName,
}: {
  entry: ClientNameEntry;
  editable: boolean;
  hasLink: boolean;
  onCommitFirstName: (value: string) => void;
  onCommitLastName: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <NameField value={entry.firstName} placeholder="First name" editable={editable} hasLink={hasLink} onCommit={onCommitFirstName} />
      <NameField value={entry.lastName} placeholder="Last name" editable={editable} hasLink={hasLink} onCommit={onCommitLastName} />
    </div>
  );
}

export function ClientNameCell({
  clients,
  link,
  editable,
  onCommitName,
  onCommitLink,
}: {
  clients: [ClientNameEntry, ClientNameEntry];
  link: string | null;
  editable: boolean;
  onCommitName: (slot: 0 | 1, field: "firstName" | "lastName", value: string) => void;
  onCommitLink: (link: string | null) => void;
}) {
  const [hoveringIcon, setHoveringIcon] = useState(false);

  return (
    <div
      className="relative flex h-full min-w-0 items-stretch"
      onMouseEnter={() => setHoveringIcon(true)}
      onMouseLeave={() => setHoveringIcon(false)}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1">
        <ClientSlot
          entry={clients[0]}
          editable={editable}
          hasLink={Boolean(link)}
          onCommitFirstName={(v) => onCommitName(0, "firstName", v)}
          onCommitLastName={(v) => onCommitName(0, "lastName", v)}
        />
        <ClientSlot
          entry={clients[1]}
          editable={editable}
          hasLink={Boolean(link)}
          onCommitFirstName={(v) => onCommitName(1, "firstName", v)}
          onCommitLastName={(v) => onCommitName(1, "lastName", v)}
        />
      </div>

      <div className="flex w-6 shrink-0 items-center justify-center">
        <ClientLinkButton link={link} visible={hoveringIcon} editable={editable} onCommitLink={onCommitLink} />
      </div>
    </div>
  );
}
