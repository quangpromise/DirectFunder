"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Volume2, VolumeX, UserPlus, RefreshCw, AtSign, X } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useLanguage, useT } from "@/lib/i18n";
import { Avatar } from "@/components/avatar";
import type { NotificationType } from "@/lib/types";

/** Icon + màu badge nhỏ đè góc dưới-phải avatar (kiểu Facebook: mỗi loại thông báo có
 * 1 icon tròn màu riêng) — chỉ 3 loại NotificationType hiện có nên map trực tiếp,
 * không cần bảng cấu hình rời. */
const NOTIF_TYPE_STYLE: Record<NotificationType, { icon: typeof UserPlus; className: string }> = {
  assigned: { icon: UserPlus, className: "bg-blue-500" },
  status_change: { icon: RefreshCw, className: "bg-amber-500" },
  mention: { icon: AtSign, className: "bg-emerald-500" },
};

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
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const notifications = useAppStore((s) => s.notifications);
  /** Thông báo mới nhất vừa nhận (không phải toàn bộ mine) — hiện 1 banner nhỏ ngay dưới
   * nút chuông trong ~10s rồi tự tắt (xem useEffect phát âm thanh bên dưới, tái dùng
   * đúng logic phát hiện id MỚI qua seenIdsRef). null = không hiện banner. */
  const [toastNotification, setToastNotification] = useState<(typeof notifications)[number] | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const users = useAppStore((s) => s.users);
  const markNotificationRead = useAppStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useAppStore((s) => s.markAllNotificationsRead);
  const notificationSoundMuted = useAppStore((s) => s.notificationSoundMuted);
  const setNotificationSoundMuted = useAppStore((s) => s.setNotificationSoundMuted);
  const { language } = useLanguage();
  const t = useT();
  const router = useRouter();
  const currentUser = users.find((u) => u.id === currentUserId);

  // Bấm vào 1 thông báo -> nhảy tới đúng dòng (hồ sơ) mà thông báo đó nhắc tới rồi cuộn
  // + nhấp nháy 5s (xem cases/page.tsx và orders/page.tsx). Support không có quyền vào
  // tab Hồ sơ (xem top-nav.tsx) nên đưa họ sang tab Order, nơi họ thực sự thao tác.
  function goToNotification(caseId: string) {
    const path = currentUser?.role === "support" ? "/dashboard/orders" : "/dashboard/cases";
    router.push(`${path}?highlight=${caseId}`);
  }

  const mine = notifications.filter((n) => n.toUserId === currentUserId);
  const unreadCount = mine.filter((n) => !n.read).length;

  // Mở dropdown đánh dấu TOÀN BỘ đã đọc ngay (giữ hành vi cũ, tắt số đỏ trên chuông) —
  // nhưng vẫn cần biết "cái nào MỚI VỪA chưa đọc trước khi mở" để giữ style nổi bật
  // (bold/nền xanh nhạt/chấm xanh) trong lúc panel đang mở, giống Facebook: đã "seen"
  // (số đỏ tắt) không có nghĩa là hết nổi bật ngay lập tức. Chụp nhanh (snapshot) 1 lần
  // ngay TRƯỚC khi gọi markAllNotificationsRead(), không đọc lại theo n.read (đã đổi
  // thành true trong store ngay sau đó).
  const [unreadSnapshot, setUnreadSnapshot] = useState<Set<string>>(new Set());
  const visibleList = filter === "unread" ? mine.filter((n) => unreadSnapshot.has(n.id)) : mine;

  // Phát âm thanh mỗi khi có notification MỚI cho đúng tài khoản đang đăng nhập — so
  // sánh id với lần render trước (không dùng length vì đọc/markAllRead cũng đổi length
  // theo hướng khác, chỉ quan tâm id THỰC SỰ mới xuất hiện). seenIdsRef bắt đầu bằng
  // đúng tập id hiện có lúc mount nên không tự phát khi mới tải trang.
  const audioRef = useRef<HTMLAudioElement>(null);
  const seenIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(mine.map((n) => n.id));
    if (seenIdsRef.current) {
      const newIds = mine.filter((n) => !seenIdsRef.current!.has(n.id));
      if (newIds.length > 0) {
        if (!notificationSoundMuted) audioRef.current?.play().catch(() => {});
        // Hiện banner cho thông báo mới nhất trong đợt này (nếu nhiều cái tới cùng lúc) —
        // tự tắt sau 10s; nếu 1 thông báo mới khác tới trước khi hết 10s, reset lại đồng
        // hồ đếm cho thông báo mới nhất đó thay vì tắt giữa chừng.
        setToastNotification(newIds[newIds.length - 1]);
        if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = setTimeout(() => setToastNotification(null), 10_000);
      }
    }
    seenIdsRef.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications, currentUserId]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  return (
    <div className="relative">
      <audio ref={audioRef} src="/notification-sound.mp3" preload="auto" />
      <button
        onClick={() => {
          // Mở dropdown là xem như đã đọc hết — không cần nút "Đánh dấu đã đọc" riêng nữa.
          // Side effect (markAllNotificationsRead) đặt NGOÀI functional updater của setOpen:
          // React có thể gọi lại updater bất kỳ lúc nào (kể cả lúc render), gọi set() của
          // store khác bên trong đó gây lỗi "Cannot update a component while rendering
          // a different component".
          const next = !open;
          setOpen(next);
          if (next) {
            setUnreadSnapshot(new Set(mine.filter((n) => !n.read).map((n) => n.id)));
            setFilter("all");
            if (unreadCount > 0) markAllNotificationsRead();
            setToastNotification(null);
          }
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-dim transition hover:bg-surface-hover hover:text-text active:scale-95"
        aria-label={t("notif.ariaLabel")}
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Banner thông báo mới — thẻ nổi kiểu Facebook desktop (avatar tròn + icon-badge góc
          theo loại thông báo, giống hệt style dùng trong dropdown bên dưới), KHÔNG còn
          bong bóng đuôi tam giác/nhấp nháy như bản cũ — trượt nhẹ + mờ dần vào (xem
          .notif-toast-in trong globals.css) trông hiện đại và ít gây rối mắt hơn. Bấm vào
          nội dung -> đánh dấu đã đọc + nhảy tới đúng hồ sơ; nút X riêng chỉ đóng banner,
          KHÔNG đánh dấu đã đọc (vẫn còn nguyên trong dropdown để xem lại). Tự tắt sau 10s
          nếu không thao tác gì (xem useEffect phát hiện id mới ở trên). */}
      {!open &&
        toastNotification &&
        (() => {
          const n = toastNotification;
          const from = users.find((u) => u.id === n.fromUserId);
          const { icon: TypeIcon, className: badgeClassName } = NOTIF_TYPE_STYLE[n.type];
          return (
            <div className="notif-toast-in popover absolute right-0 top-full z-50 mt-2.5 w-80 max-w-[85vw] rounded-2xl p-3 shadow-2xl shadow-black/60">
              <button
                onClick={() => {
                  markNotificationRead(n.id);
                  setToastNotification(null);
                  goToNotification(n.caseId);
                }}
                className="flex w-full items-start gap-3 text-left"
              >
                <div className="relative shrink-0">
                  <Avatar name={from?.name ?? "?"} color={from?.avatarColor ?? "#6b7280"} url={from?.avatarUrl} size={44} />
                  <span
                    className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-bg-elevated ${badgeClassName}`}
                  >
                    <TypeIcon size={11} strokeWidth={2.5} className="text-white" />
                  </span>
                </div>
                <div className="min-w-0 flex-1 pt-0.5 pr-5">
                  <p className="text-[13px] font-semibold leading-snug text-text">{n.message}</p>
                  <p className="mt-0.5 text-[12px] font-semibold text-accent-from">{timeAgo(n.createdAt, language)}</p>
                </div>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setToastNotification(null);
                  if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
                }}
                aria-label={t("common.close")}
                title={t("common.close")}
                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-text-faint transition hover:bg-surface-hover hover:text-text"
              >
                <X size={13} />
              </button>
            </div>
          );
        })()}

      {open &&
        (() => {
          // Kiểu Facebook: panel rộng hơn, tiêu đề đậm cỡ lớn, 2 pill lọc Tất cả/Chưa đọc,
          // mỗi dòng có avatar tròn lớn + icon-badge nhỏ đè góc dưới-phải theo loại thông
          // báo (assigned/status_change/mention — xem NOTIF_TYPE_STYLE), dòng chưa đọc có
          // nền xanh nhạt + chữ đậm + chấm tròn xanh bên phải.
          const panelBody = (
            <>
              <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
                <span className="text-[17px] font-bold tracking-tight text-text">{t("notif.title")}</span>
                <button
                  onClick={() => setNotificationSoundMuted(!notificationSoundMuted)}
                  title={notificationSoundMuted ? t("notif.unmute") : t("notif.mute")}
                  aria-label={notificationSoundMuted ? t("notif.unmute") : t("notif.mute")}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-text-dim transition hover:bg-surface-hover hover:text-text"
                >
                  {notificationSoundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
              </div>

              <div className="flex items-center gap-1.5 px-3.5 pb-2.5 pt-1">
                {(["all", "unread"] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                      filter === key
                        ? "bg-accent-soft text-accent-from"
                        : "text-text-dim hover:bg-surface-hover hover:text-text"
                    }`}
                  >
                    {key === "all" ? t("notif.all") : t("notif.unread")}
                  </button>
                ))}
              </div>

              <div className="max-h-96 overflow-y-auto px-2 pb-2">
                {visibleList.length === 0 && (
                  <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
                    <Bell size={26} className="text-text-faint" strokeWidth={1.5} />
                    <span className="text-xs text-text-faint">
                      {filter === "unread" ? t("notif.emptyUnread") : t("notif.empty")}
                    </span>
                  </div>
                )}
                {visibleList.map((n) => {
                  const from = users.find((u) => u.id === n.fromUserId);
                  const unread = unreadSnapshot.has(n.id);
                  const { icon: TypeIcon, className: badgeClassName } = NOTIF_TYPE_STYLE[n.type];
                  return (
                    <button
                      key={n.id}
                      onClick={() => {
                        markNotificationRead(n.id);
                        setOpen(false);
                        goToNotification(n.caseId);
                      }}
                      className={`group flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${
                        unread ? "bg-accent-soft hover:brightness-[1.08]" : "hover:bg-surface-hover"
                      }`}
                    >
                      <div className="relative shrink-0">
                        <Avatar name={from?.name ?? "?"} color={from?.avatarColor ?? "#6b7280"} url={from?.avatarUrl} size={44} />
                        <span
                          className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-bg-elevated ${badgeClassName}`}
                        >
                          <TypeIcon size={11} strokeWidth={2.5} className="text-white" />
                        </span>
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className={`text-[13px] leading-snug ${unread ? "font-semibold text-text" : "text-text-dim"}`}>
                          {n.message}
                        </p>
                        <p className={`mt-0.5 text-[12px] ${unread ? "font-semibold text-accent-from" : "text-text-faint"}`}>
                          {from?.name} · {timeAgo(n.createdAt, language)}
                        </p>
                      </div>
                      {unread && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-accent-from" />}
                    </button>
                  );
                })}
              </div>
            </>
          );

          return (
            <>
              {/* Desktop (sm+): dropdown neo theo trigger như cũ. */}
              <div className="fixed inset-0 z-40 hidden sm:block" onClick={() => setOpen(false)} />
              <div className="popover absolute right-0 z-50 mt-2 hidden w-96 max-w-[90vw] flex-col rounded-2xl p-0 shadow-2xl shadow-black/60 sm:flex">
                {panelBody}
              </div>

              {/* Mobile: neo theo cạnh trigger (right-0) vẫn tràn màn hình vì chuông không
                  nằm sát mép phải viewport (avatar/menu tài khoản đứng sau nó) — width co
                  theo 100vw không đủ, offset ngang của trigger mới là nguyên nhân tràn. Đổi
                  sang fixed + căn giữa NGANG theo viewport (left-1/2 -translate-x-1/2, không
                  phụ thuộc vị trí trigger nữa), đặt ngay dưới header (top-16) để không che
                  hết màn hình. */}
              <div className="fixed inset-0 z-40 sm:hidden" onClick={() => setOpen(false)} />
              <div
                className="popover fixed left-1/2 top-16 z-50 flex max-h-[75vh] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-y-auto rounded-2xl p-0 shadow-2xl shadow-black/60 sm:hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {panelBody}
              </div>
            </>
          );
        })()}
    </div>
  );
}
