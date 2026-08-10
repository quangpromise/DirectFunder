"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Volume2, VolumeX } from "lucide-react";
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
          if (next && unreadCount > 0) markAllNotificationsRead();
          if (next) setToastNotification(null);
        }}
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

      {/* Banner thông báo mới — bong bóng kiểu tin nhắn NỐI LIỀN từ chân nút chuông (đuôi
          tam giác xem .notif-toast::before trong globals.css), nền ĐEN cố định + chữ màu
          xanh dương SÁNG (--accent-from, đầu gradient logo — sáng hơn --accent gốc, xem
          globals.css/ui-design.md — KHÔNG đổi theo theme). Tự nhấp nháy chậm (tái dùng
          .greeting-blink đã có — mờ dần rồi rõ lại, chu kỳ 3.5s) để dễ thu hút chú ý hơn.
          Bấm vào -> đánh dấu đã đọc + tắt banner ngay (đúng như bấm 1 thông báo trong
          dropdown, kèm nhảy tới đúng hồ sơ). Tự tắt sau 10s nếu không bấm (xem useEffect
          phát hiện id mới ở trên) hoặc tắt ngay nếu người dùng mở dropdown xem chi tiết. */}
      {!open && toastNotification && (
        <button
          onClick={() => {
            const n = toastNotification;
            markNotificationRead(n.id);
            setToastNotification(null);
            goToNotification(n.caseId);
          }}
          className="notif-toast greeting-blink absolute right-0 top-full z-50 mt-2.5 w-72 max-w-[70vw] rounded-xl bg-black px-3 py-2.5 text-left text-xs font-medium text-accent-from shadow-2xl shadow-black/60 transition hover:bg-neutral-900"
        >
          {toastNotification.message}
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="popover absolute right-0 z-50 mt-2 w-80 max-w-[85vw] rounded-xl p-2 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-sm font-medium">{t("notif.title")}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setNotificationSoundMuted(!notificationSoundMuted)}
                  title={notificationSoundMuted ? t("notif.unmute") : t("notif.mute")}
                  aria-label={notificationSoundMuted ? t("notif.unmute") : t("notif.mute")}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text"
                >
                  {notificationSoundMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              </div>
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
                    onClick={() => {
                      markNotificationRead(n.id);
                      setOpen(false);
                      goToNotification(n.caseId);
                    }}
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
