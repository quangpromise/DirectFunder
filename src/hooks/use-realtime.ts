"use client";

import { useEffect } from "react";
import { getPusherClient } from "@/lib/pusher-client";
import { useAppStore } from "@/store/app-store";
import type { AppNotification } from "@/lib/types";

const CASES_CHANNEL = "private-cases";
const CPA_REVIEW_CHANNEL = "private-cpa-review";

/** Subscribe realtime (Pusher) cho toàn dashboard — gọi 1 lần ở layout, cạnh
 * hydrateFromServer(). No-op nếu chưa đăng nhập hoặc Pusher chưa được cấu hình
 * (getPusherClient() trả null, xem pusher-client.ts) — app vẫn chạy bình thường, chỉ mất
 * phần tự cập nhật, người dùng vẫn tự F5 được như trước.
 *
 * 2 kênh:
 * - "private-cases": tín hiệu chung "case:changed" {caseId} — refetch lại state.cases qua
 *   GET /api/cases (đã lọc RBAC), KHÔNG tin dữ liệu trực tiếp từ Pusher (xem
 *   src/lib/pusher-server.ts cho lý do). Debounce 500ms để gộp nhiều tín hiệu dồn dập.
 * - "private-notifications-{userId}": "notification:new" — thông báo thật, prepend thẳng
 *   vào store qua receiveNotification.
 */
export function useRealtime(userId: string | undefined): void {
  useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher || !userId) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function onCaseChanged() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        useAppStore.getState().refetchCases();
      }, 500);
    }
    let cpaReviewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    function onCpaReviewChanged() {
      if (cpaReviewDebounceTimer) clearTimeout(cpaReviewDebounceTimer);
      cpaReviewDebounceTimer = setTimeout(() => {
        useAppStore.getState().refetchCpaReview();
      }, 500);
    }
    function onNotification(n: AppNotification) {
      useAppStore.getState().receiveNotification(n);
    }

    const casesChannel = pusher.subscribe(CASES_CHANNEL);
    casesChannel.bind("case:changed", onCaseChanged);

    const cpaReviewChannel = pusher.subscribe(CPA_REVIEW_CHANNEL);
    cpaReviewChannel.bind("cpaReview:changed", onCpaReviewChanged);

    const notifChannelName = `private-notifications-${userId}`;
    const notifChannel = pusher.subscribe(notifChannelName);
    notifChannel.bind("notification:new", onNotification);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (cpaReviewDebounceTimer) clearTimeout(cpaReviewDebounceTimer);
      casesChannel.unbind("case:changed", onCaseChanged);
      cpaReviewChannel.unbind("cpaReview:changed", onCpaReviewChanged);
      notifChannel.unbind("notification:new", onNotification);
      pusher.unsubscribe(CASES_CHANNEL);
      pusher.unsubscribe(CPA_REVIEW_CHANNEL);
      pusher.unsubscribe(notifChannelName);
    };
  }, [userId]);
}
