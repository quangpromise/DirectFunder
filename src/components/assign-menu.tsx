"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { UserPlus } from "lucide-react";
import { User } from "@/lib/types";
import { Avatar } from "@/components/avatar";
import { useT } from "@/lib/i18n";

export function AssignMenu({
  users,
  assignedTo,
  canAssign,
  onAssign,
}: {
  users: User[];
  assignedTo: string | null;
  canAssign: boolean;
  onAssign: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const assignedUser = users.find((u) => u.id === assignedTo);
  const t = useT();

  if (!canAssign) {
    return assignedUser ? (
      <div className="flex min-w-0 items-center justify-center gap-1.5 px-2">
        <Avatar name={assignedUser.name} color={assignedUser.avatarColor} url={assignedUser.avatarUrl} size={22} />
        <span className="min-w-0 flex-1 truncate text-center text-xs text-text-dim">{assignedUser.name}</span>
      </div>
    ) : (
      <div className="flex w-full items-center justify-center px-2 text-center text-xs text-text-faint">{t("assign.notAssigned")}</div>
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
        title={assignedUser?.name}
        className="flex w-full min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs transition hover:bg-surface-hover"
      >
        {assignedUser ? (
          <>
            <Avatar name={assignedUser.name} color={assignedUser.avatarColor} url={assignedUser.avatarUrl} size={22} />
            <span className="min-w-0 flex-1 truncate text-center text-text-dim">{assignedUser.name}</span>
          </>
        ) : (
          <>
            <UserPlus size={14} className="shrink-0 text-text-faint" />
            <span className="min-w-0 flex-1 truncate text-center text-text-faint">{t("assign.assign")}</span>
          </>
        )}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div
              className="popover fixed z-[100] w-48 rounded-xl p-1.5 shadow-2xl shadow-black/60"
              style={{ left: pos.x, top: pos.y }}
            >
              {users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    onAssign(u.id);
                    setOpen(false);
                  }}
                  className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-surface-hover"
                >
                  <Avatar name={u.name} color={u.avatarColor} url={u.avatarUrl} size={22} />
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                </button>
              ))}
              {users.length === 0 && (
                <div className="px-2 py-2 text-xs text-text-faint">{t("assign.noMatching")}</div>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
