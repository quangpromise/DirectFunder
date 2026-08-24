"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, UserPlus, X } from "lucide-react";
import { User } from "@/lib/types";
import { Avatar } from "@/components/avatar";
import { useT } from "@/lib/i18n";
import { useConfirm } from "@/components/confirm-dialog";

const MENU_MARGIN = 8;

export function AssignMenu({
  users,
  assignedTo,
  canAssign,
  onAssign,
  compact,
}: {
  users: User[];
  assignedTo: string | null;
  canAssign: boolean;
  /** null = bỏ giao việc (chọn mục "Để trống") — chỉ xoá người được giao, KHÔNG xoá hồ sơ/
   * dòng dữ liệu. Không cần xác nhận, khác với giao cho 1 người cụ thể (luôn hỏi xác nhận
   * trước khi lưu). Lưu ý: nếu người đang xem chính là người vừa bị bỏ giao (Agent tự bỏ
   * mình khỏi cột Agent, Processor tự bỏ mình khỏi cột Processor), hồ sơ đó có thể biến
   * mất khỏi BẢNG CỦA HỌ do canViewCase lọc theo đúng field này — đây chỉ là thay đổi
   * hiển thị theo quyền xem, dữ liệu hồ sơ vẫn còn nguyên cho Manager/Accounting/Support. */
  onAssign: (userId: string | null) => void;
  /** Chữ nhỏ/đậm hơn (10px, khớp `tinyDense` của EditableCell) + avatar nhỏ hơn — dùng cho
   * các cột Processor/Agent của tab "CPA Review" (thêm 2026-08-24) để đồng bộ độ nhỏ gọn với
   * các cột khác trong cùng bảng. Mặc định false, không ảnh hưởng mọi nơi khác đang dùng
   * AssignMenu (Hồ sơ/Order/Collecting...). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, maxHeight: 320 });
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const assignedUser = users.find((u) => u.id === assignedTo);
  const t = useT();
  const { confirm, ConfirmDialogUI } = useConfirm();

  // Lọc theo tên khi danh sách dài — hữu ích khi số tài khoản Agent/Processor/Support tăng
  // lên, khỏi phải cuộn tìm thủ công trong menu cao tối đa 320px.
  const filteredUsers = search.trim()
    ? users.filter((u) => u.name.toLowerCase().includes(search.trim().toLowerCase()))
    : users;

  // Sau khi menu render (biết chiều cao thật), tự đo lại và lật lên trên nếu không đủ
  // chỗ bên dưới — tránh bị khuất màn hình khi trigger nằm ở hàng cuối bảng.
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
    const maxHeight = Math.max(120, (openUpward ? spaceAbove : spaceBelow));
    const y = openUpward ? rect.top - 4 - Math.min(menuHeight, maxHeight) : rect.bottom + 4;
    setPos((p) => (p.x === rect.left && p.y === y && p.maxHeight === maxHeight ? p : { x: rect.left, y, maxHeight }));
  }, [open, filteredUsers.length]);

  async function selectUser(u: User) {
    setOpen(false);
    if (await confirm(t("assign.confirmMessage", { name: u.name }), { title: t("assign.confirmTitle") })) {
      onAssign(u.id);
    }
  }

  async function clearAssignment() {
    setOpen(false);
    if (await confirm(t("assign.confirmClearMessage"), { title: t("assign.confirmTitle") })) {
      onAssign(null);
    }
  }

  if (!canAssign) {
    return assignedUser ? (
      <div className="flex min-w-0 items-center justify-center gap-1.5 px-2">
        <Avatar name={assignedUser.name} color={assignedUser.avatarColor} url={assignedUser.avatarUrl} size={compact ? 16 : 22} />
        <span className={`min-w-0 flex-1 truncate text-center ${compact ? "text-[10px] font-semibold text-text" : "text-xs text-text-dim"}`}>
          {assignedUser.name}
        </span>
      </div>
    ) : (
      <div
        className={`flex w-full items-center justify-center px-2 text-center ${compact ? "text-[10px] font-semibold" : "text-xs"} text-text-faint`}
      >
        {t("assign.notAssigned")}
      </div>
    );
  }

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ x: rect.left, y: rect.bottom + 4, maxHeight: 320 });
    setSearch("");
    setOpen((o) => {
      const next = !o;
      if (next) setTimeout(() => searchRef.current?.focus(), 0);
      return next;
    });
  }

  return (
    <div className="relative w-full min-w-0">
      <button
        ref={triggerRef}
        onClick={openMenu}
        title={assignedUser?.name}
        className={`flex w-full min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-surface-hover ${
          compact ? "text-[10px] font-semibold" : "text-xs"
        }`}
      >
        {assignedUser ? (
          <>
            <Avatar name={assignedUser.name} color={assignedUser.avatarColor} url={assignedUser.avatarUrl} size={compact ? 16 : 22} />
            <span className={`min-w-0 flex-1 truncate text-center ${compact ? "text-text" : "text-text-dim"}`}>{assignedUser.name}</span>
          </>
        ) : (
          <>
            <UserPlus size={compact ? 12 : 14} className="shrink-0 text-text-faint" />
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
              ref={menuRef}
              className="popover fixed z-[100] flex w-48 flex-col rounded-xl p-1.5 shadow-2xl shadow-black/60"
              style={{ left: pos.x, top: pos.y, maxHeight: pos.maxHeight }}
            >
              {users.length > 5 && (
                <div className="relative mb-1 shrink-0">
                  <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder={t("assign.searchPlaceholder")}
                    className="w-full rounded-md border border-border bg-bg-elevated py-1 pl-6 pr-2 text-xs outline-none focus:border-accent"
                  />
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <button
                  onClick={clearAssignment}
                  className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-text-faint transition hover:bg-surface-hover"
                >
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-border">
                    <X size={12} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t("assign.clear")}</span>
                </button>
                {filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => selectUser(u)}
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-surface-hover"
                  >
                    <Avatar name={u.name} color={u.avatarColor} url={u.avatarUrl} size={22} />
                    <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  </button>
                ))}
                {filteredUsers.length === 0 && (
                  <div className="px-2 py-2 text-xs text-text-faint">{t("assign.noMatching")}</div>
                )}
              </div>
            </div>
          </>,
          document.body
        )}
      {ConfirmDialogUI}
    </div>
  );
}
