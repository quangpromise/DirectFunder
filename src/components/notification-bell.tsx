"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useLanguage, useT } from "@/lib/i18n";

function timeAgo(iso: string, language: "vi" | "en"): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (language === "en") {
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} giờ trước`;
  return `${Math.floor(hrs / 24)} ngày trước`;
}

export function NotificationBell({ currentUserId }: { currentUserId: string }) {
  const [open, setOpen] = useState(false);
  const notifications = useAppStore((s) => s.notifications);
  const users = useAppStore((s) => s.users);
  const markNotificationRead = useAppStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useAppStore((s) => s.markAllNotificationsRead);
  const { language } = useLanguage();
  const t = useT();

  const mine = notifications.filter((n) => n.toUserId === currentUserId);
  const unreadCount = mine.filter((n) => !n.read).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-dim transition hover:bg-surface-hover hover:text-text"
        aria-label={t("notif.ariaLabel")}
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="popover absolute right-0 z-50 mt-2 w-80 max-w-[85vw] rounded-xl p-2 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-sm font-medium">{t("notif.title")}</span>
              {unreadCount > 0 && (
                <button
                  onClick={markAllNotificationsRead}
                  className="text-xs text-accent hover:underline"
                >
                  {t("notif.markAllRead")}
                </button>
              )}
            </div>
            <div className="mt-1 max-h-80 overflow-y-auto">
              {mine.length === 0 && (
                <div className="px-2 py-6 text-center text-xs text-text-faint">{t("notif.empty")}</div>
              )}
              {mine.map((n) => {
                const from = users.find((u) => u.id === n.fromUserId);
                return (
                  <button
                    key={n.id}
                    onClick={() => markNotificationRead(n.id)}
                    className={`flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-surface-hover ${
                      !n.read ? "bg-accent-soft" : ""
                    }`}
                  >
                    <span className="text-text">{n.message}</span>
                    <span className="text-text-faint">
                      {from?.name} · {timeAgo(n.createdAt, language)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
