"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { TopNav } from "@/components/top-nav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const currentUserId = useAppStore((s) => s.currentUserId);
  const hydrateFromServer = useAppStore((s) => s.hydrateFromServer);
  const logout = useAppStore((s) => s.logout);
  const user = useCurrentUser();

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

  if (!persistReady || !user) return null;

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <TopNav />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
