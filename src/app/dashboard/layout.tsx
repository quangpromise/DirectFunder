"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { useRealtime } from "@/hooks/use-realtime";
import { TopNav } from "@/components/top-nav";
import { StatusCelebrationOverlay } from "@/components/status-celebration-overlay";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const currentUserId = useAppStore((s) => s.currentUserId);
  const hydrateFromServer = useAppStore((s) => s.hydrateFromServer);
  const logout = useAppStore((s) => s.logout);
  const theme = useAppStore((s) => s.theme);
  const user = useCurrentUser();

  // Áp dụng Dark/Light theme (data-theme trên <html>, đọc bởi các biến CSS trong
  // globals.css) — CHỈ có hiệu lực ở các màn hình sau đăng nhập. Đặt trên <html> (không
  // phải 1 div con) để các phần render qua portal (dropdown, dialog...) cũng ăn đúng
  // theme. Trang Login tự xoá attribute này khi mount nên luôn giữ nguyên nền tối cố
  // định bất kể lựa chọn theme đã lưu.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  // Zustand persist đọc localStorage bất đồng bộ (Promise) dù storage bản chất là đồng
  // bộ — ở lần render đầu currentUserId có thể tạm là null trước khi persist hydrate
  // xong. Phải đợi persistReady rồi mới quyết định redirect, tránh văng nhầm người
  // dùng đã đăng nhập về /login mỗi lần load lại trang. Luôn khởi tạo false và chỉ gọi
  // useAppStore.persist.* bên trong useEffect (client-only) — gọi trong lazy initializer
  // của useState chạy cả lúc SSR, nơi persist chưa sẵn sàng, gây lỗi 500.
  const [persistReady, setPersistReady] = useState(false);
  useEffect(() => {
    if (useAppStore.persist.hasHydrated()) {
      setPersistReady(true);
      return;
    }
    return useAppStore.persist.onFinishHydration(() => setPersistReady(true));
  }, []);

  useEffect(() => {
    if (!persistReady) return;
    if (!currentUserId) {
      router.replace("/login");
      return;
    }
    // currentUserId có thể vẫn đúng dù cookie session (JWT httpOnly) đã hết hạn/bị xoá —
    // luôn xác thực + nạp lại dữ liệu mới nhất từ server mỗi lần vào dashboard, không chỉ
    // tin vào bản cache cũ trên trình duyệt.
    hydrateFromServer().catch(() => {
      logout();
      router.replace("/login");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistReady, currentUserId, router]);

  // Chuông thông báo + bảng Hồ sơ/Order tự cập nhật khi người khác sửa (Pusher) — xem
  // src/hooks/use-realtime.ts. No-op an toàn nếu chưa cấu hình Pusher.
  useRealtime(persistReady ? user?.id : undefined);

  if (!persistReady || !user) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Ảnh nền theo theme (darkmode.jpg/lightmode.avif) + lớp phủ để bảng/chữ luôn đủ
          tương phản — 2 div fixed nằm dưới mọi nội dung, không nằm trong luồng cuộn. */}
      <div className="app-bg" aria-hidden />
      <div className="app-bg-overlay" aria-hidden />
      <TopNav />
      <main className="flex-1 overflow-auto">{children}</main>
      <StatusCelebrationOverlay />
    </div>
  );
}
