"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, X, Table2, Users, ShieldCheck, ClipboardList, Coins, FileSpreadsheet, ChevronDown } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { hasFeature } from "@/lib/rbac";
import { Avatar } from "@/components/avatar";
import { AvatarUpload } from "@/components/avatar-upload";
import { RoleBadge } from "@/components/role-badge";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { PhoenixClock } from "@/components/phoenix-clock";
import { NotificationBell } from "@/components/notification-bell";
import { RulesPanel } from "@/components/rules-panel";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { FeatureKey, Role } from "@/lib/types";
import { useT } from "@/lib/i18n";

// "Rules" KHÔNG còn là 1 route riêng trong danh sách này nữa — đã đổi thành dropdown
// (RulesPanel, kiểu bảng thông báo giống NotificationBell) mở ngay tại chỗ, không điều
// hướng rời màn hình đang làm việc. Tách NAV thành 2 nhóm PRIMARY_NAV/ADMIN_NAV (thay vì 1
// mảng phẳng) để chèn <RulesPanel variant="tab"/> vào GIỮA 2 nhóm khi render (xem TopNav bên
// dưới) — đảm bảo thứ tự luôn đúng "Cases -> Orders -> Rules -> (Tài khoản/Phân quyền nếu
// có)" theo yêu cầu 2026-08-11, bất kể role đang đăng nhập thấy bao nhiêu tab trong mỗi nhóm.
const PRIMARY_NAV: { href: string; labelKey: string; icon: typeof Table2; roles: Role[] | "all"; feature?: FeatureKey }[] = [
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
  // Tab mới (2026-08-12), độc lập hoàn toàn với bảng Hồ sơ — bảng thu hồi công nợ dạng
  // Excel. roles: "all" + feature "viewCollecting" (2026-08-13) — Admin cấu hình nhóm nào
  // xem được qua trang Phân quyền thay vì hard-code, xem DEFAULT_FEATURE_PERMISSIONS.
  {
    href: "/dashboard/collecting",
    labelKey: "nav.collecting",
    icon: Coins,
    roles: "all",
    feature: "viewCollecting",
  },
  // Tab mới (2026-08-14) — bảng riêng khớp cấu trúc Google Sheet "CPA Review" thật (đồng
  // bộ 2 chiều, xem deployment-database-sync.md mục 4.22), dữ liệu vẫn là CHÍNH Case (khớp
  // theo SSN), không phải bảng độc lập kiểu Collecting.
  {
    href: "/dashboard/cpa-review",
    labelKey: "nav.cpaReview",
    icon: FileSpreadsheet,
    roles: "all",
    feature: "viewCpaReview",
  },
];
const ADMIN_NAV: { href: string; labelKey: string; icon: typeof Table2; roles: Role[] | "all" }[] = [
  { href: "/dashboard/users", labelKey: "nav.users", icon: Users, roles: ["manager"] },
  { href: "/dashboard/permissions", labelKey: "nav.permissions", icon: ShieldCheck, roles: ["manager"] },
];

export function TopNav() {
  const user = useCurrentUser();
  const featurePermissions = useAppStore((s) => s.featurePermissions);
  const pathname = usePathname();
  const logout = useAppStore((s) => s.logout);
  const updateAvatar = useAppStore((s) => s.updateAvatar);
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const t = useT();

  if (!user) return null;

  const primaryItems = PRIMARY_NAV.filter(
    (item) =>
      (item.roles === "all" || item.roles.includes(user.role)) &&
      (!item.feature || hasFeature(featurePermissions, item.feature, user.role))
  );
  const adminItems = ADMIN_NAV.filter((item) => item.roles === "all" || item.roles.includes(user.role));

  // Dùng chung cho cả hàng tab desktop lẫn danh sách trong menu hamburger mobile (2 nơi gọi
  // bên dưới) — tránh lặp lại JSX Link 4 lần khi giờ NAV tách 2 nhóm để chèn RulesPanel vào
  // giữa (xem PRIMARY_NAV/ADMIN_NAV phía trên).
  function renderNavLink(item: (typeof PRIMARY_NAV)[number], mobile: boolean) {
    const { href, labelKey, icon: Icon } = item;
    const active = pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={mobile ? () => setMobileOpen(false) : undefined}
        className={`flex items-center gap-1.5 rounded-lg text-sm transition ${mobile ? "gap-2.5 px-3 py-2" : "px-3 py-1.5"} ${
          active
            ? "border border-border-strong bg-accent-soft text-text"
            : "border border-transparent text-text-dim hover:bg-surface-hover hover:text-text"
        }`}
      >
        <Icon size={mobile ? 16 : 15} />
        {t(labelKey)}
      </Link>
    );
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg-elevated px-4 sm:px-6">
      <div className="flex shrink-0 items-center">
        {/* Wordmark rộng chỉ vừa mắt trên desktop — trên di động màn hẹp đổi sang icon tròn
            gọn hơn (df-logo.png 273x35 quá rộng, chiếm gần hết header trên màn nhỏ). */}
        <Image
          src="/df-logo.png"
          alt="Direct Funder"
          width={273}
          height={35}
          priority
          className="hidden h-6 w-auto sm:block"
        />
        <Image
          src="/icon.jpg"
          alt="Direct Funder"
          width={32}
          height={32}
          priority
          className="block h-8 w-8 rounded-full sm:hidden"
        />
      </div>

      <nav className="ml-2 hidden items-center gap-1 md:flex">
        {primaryItems.map((item) => renderNavLink(item, false))}
        {/* Rules đặt NGAY SAU Cases/Orders (yêu cầu 2026-08-11: thứ tự Cases -> Orders ->
            Rules) — vẫn là dropdown (variant="tab" chỉ đổi hình thức hiển thị cho khớp style
            Link, KHÔNG điều hướng route). */}
        <RulesPanel variant="tab" />
        {adminItems.map((item) => renderNavLink(item, false))}
      </nav>

      <button
        onClick={() => setMobileOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-dim md:hidden"
        aria-label={t("nav.openMenu")}
      >
        {mobileOpen ? <X size={17} /> : <Menu size={17} />}
      </button>

      {/* Rules trên mobile đặt NGAY CẠNH nút menu (yêu cầu 2026-08-11) thay vì nằm trong danh
          sách bên trong menu hamburger — dropdown của nó tự neo trái ngay dưới nút này (xem
          rules-panel.tsx). */}
      <div className="md:hidden">
        <RulesPanel variant="icon" />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Darkmode/Ngôn ngữ chỉ hiện trực tiếp trên header ở desktop (md+) — trên mobile
            dồn vào menu hamburger (xem khối mobileOpen bên dưới) để header đỡ chật. Rules đã
            chuyển vào hàng tab điều hướng chính (Cases -> Orders -> Rules, xem <nav> phía
            trên/menu mobile bên dưới) — không còn đặt riêng ở đây nữa. */}
        <div className="hidden items-center gap-2 md:flex">
          <ThemeSwitcher compact />
          <LanguageSwitcher compact />
        </div>
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
              <div className="popover absolute right-0 z-50 mt-2 max-h-[80vh] w-56 overflow-y-auto rounded-xl p-2 shadow-2xl shadow-black/60">
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
            {primaryItems.map((item) => renderNavLink(item, true))}
            {adminItems.map((item) => renderNavLink(item, true))}
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
