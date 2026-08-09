"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, useCurrentUser } from "@/store/app-store";

export default function Home() {
  const router = useRouter();
  const currentUserId = useAppStore((s) => s.currentUserId);
  const user = useCurrentUser();

  useEffect(() => {
    if (!currentUserId) {
      router.replace("/login");
      return;
    }
    // Support chỉ có quyền trên tab Order, không có tab Hồ sơ — đưa thẳng vào Order.
    router.replace(user?.role === "support" ? "/dashboard/orders" : "/dashboard/cases");
  }, [currentUserId, user, router]);

  return null;
}
