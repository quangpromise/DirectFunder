"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, X, Table2, Users, ShieldCheck, ClipboardList, ChevronDown } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { Avatar } from "@/components/avatar";
import { AvatarUpload } from "@/components/avatar-upload";
import { RoleBadge } from "@/components/role-badge";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { PhoenixClock } from "@/components/phoenix-clock";
import { NotificationBell } from "@/components/notification-bell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Role } from "@/lib/types";
import { useT } from "@/lib/i18n";

const NAV: { href: string; labelKey: string; icon: typeof Table2; roles: Role[] | "all" }[] = [
  // Support chỉ làm việc trên tab Order — không hiện tab Hồ sơ với nhóm này.
  {
    href: "/dashboard/cases",
    labelKey: "nav.cases",
    icon: Table2,
    roles: ["manager", "accounting", "agent", "processor", "agent_leader", "processor_leader"],
  },
  {
    href: "/dashboard/orders",
    labelKey: "nav.orders",
    icon: ClipboardList,
    roles: ["agent", "processor", "support", "agent_leader", "processor_leader"],
  },
  { href: "/dashboard/users", labelKey: "nav.users", icon: Users, roles: ["manager"] },
  { href: "/dashboard/permissions", labelKey: "nav.permissions", icon: ShieldCheck, roles: ["manager"] },
];

export function TopNav() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const logout = useAppStore((s) => s.logout);
  const updateAvatar = useAppStore((s) => s.updateAvatar);
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const t = useT();

  if (!user) return null;

  const items = NAV.filter((item) => item.roles === "all" || item.roles.includes(user.role));

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg-elevated px-4 sm:px-6">
      <div className="flex shrink-0 items-center">
        <Image src="/df-logo.png" alt="Direct Funder" width={273} height={35} priority className="h-6 w-auto" />
      </div>

      <nav className="ml-2 hidden items-center gap-1 md:flex">
        {items.map(({ href, labelKey, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
                active
                  ? "border border-border-strong bg-accent-soft text-text"
                  : "border border-transparent text-text-dim hover:bg-surface-hover hover:text-text"
              }`}
            >
              <Icon size={15} />
              {t(labelKey)}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={() => setMobileOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-dim md:hidden"
        aria-label={t("nav.openMenu")}
      >
        {mobileOpen ? <X size={17} /> : <Menu size={17} />}
      </button>

      <div className="ml-auto flex items-center gap-2">
        <ThemeSwitcher compact />
        <LanguageSwitcher compact />
        <PhoenixClock />
        <NotificationBell currentUserId={user.id} />

        <div className="relative">
          <button
            onClick={() => setProfileOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-lg border border-transparent px-1 py-1 transition hover:bg-surface-hover"
          >
            <Avatar name={user.name} color={user.avatarColor} url={user.avatarUrl} size={30} />
            <ChevronDown size={14} className="hidden text-text-faint sm:block" />
          </button>

          {profileOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
              <div className="popover absolute right-0 z-50 mt-2 w-56 rounded-xl p-2 shadow-2xl shadow-black/60">
                <div className="flex items-center gap-2.5 px-2 py-2">
                  <AvatarUpload
                    name={user.name}
                    color={user.avatarColor}
                    url={user.avatarUrl}
                    size={32}
                    onChange={(url) => updateAvatar(user.id, url)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{user.name}</div>
                    <RoleBadge role={user.role} />
                  </div>
                </div>
                <div className="my-1.5 border-t border-border" />
                <ChangePasswordDialog userId={user.id} />
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    logout();
                    router.push("/login");
                  }}
                  className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
                >
                  <LogOut size={16} />
                  {t("nav.logout")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {mobileOpen && (
        <div className="absolute left-0 right-0 top-14 z-50 border-b border-border bg-bg-elevated p-3 shadow-2xl md:hidden">
          <nav className="flex flex-col gap-1">
            {items.map(({ href, labelKey, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "border border-border-strong bg-accent-soft text-text"
                      : "border border-transparent text-text-dim hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  <Icon size={16} />
                  {t(labelKey)}
                </Link>
              );
            })}
            <div className="mt-1 flex items-center gap-2 px-1">
              <LanguageSwitcher />
              <ThemeSwitcher />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
