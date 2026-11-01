"use client";

import { useEffect } from "react";
import { getPusherClient } from "@/lib/pusher-client";
import { useAppStore } from "@/store/app-store";
import { hasFeature } from "@/lib/rbac";
import type { AppNotification } from "@/lib/types";

const CASES_CHANNEL = "private-cases";
const CPA_REVIEW_CHANNEL = "private-cpa-review";
const RULES_CHANNEL = "private-rules";
const PROCESSOR_REPORT_CHANNEL = "private-processor-report";
const PRESENCE_ONLINE_CHANNEL = "presence-online-users";

interface PresenceMembers {
  each: (callback: (member: { id: string }) => void) => void;
}

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
 * - "private-processor-report": "processorReport:changed" — popup "For Processor" (bảng cá
 *   nhân LẪN bảng tổng hợp Leader) tự refetch, kể cả thay đổi đến từ webhook Sheet cá nhân
 *   (thêm 2026-09-02, xem broadcastProcessorReportChanged/pusher-server.ts).
 * - "presence-online-users": Pusher tự theo dõi ai đang online, MỌI user đăng nhập đều
 *   subscribe (không chỉ Admin) để chính mình được tính vào danh sách — chấm xanh cạnh
 *   avatar ở trang Quản lý tài khoản chỉ Admin mới thấy UI, nhưng dữ liệu presence không
 *   nhạy cảm (chỉ id/tên/role đồng nghiệp nội bộ) nên không cần chặn subscribe theo role.
 */
export function useRealtime(userId: string | undefined): void {
  useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher || !userId) return;

    // Gộp các tín hiệu tới dồn dập trong 500ms, rồi chỉ tải ĐÚNG những hồ sơ/dòng vừa đổi
    // (không tải lại cả bảng — tốn băng thông Neon, hết hạn mức 5GB tháng 10/2026). Quá nhiều
    // id cùng lúc (vd nhập Excel/đồng bộ hàng loạt) thì tải lại cả bảng 1 lần cho gọn.
    const MAX_TARGETED = 20;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingCaseIds = new Set<string>();
    let pendingFullCases = false;
    let pendingSms = false;
    function onCaseChanged(data?: { caseId?: string | null; sms?: boolean }) {
      if (data?.sms) pendingSms = true;
      else if (typeof data?.caseId === "string" && data.caseId) pendingCaseIds.add(data.caseId);
      else pendingFullCases = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const state = useAppStore.getState();
        const ids = [...pendingCaseIds];
        const full = pendingFullCases || ids.length > MAX_TARGETED;
        const sms = pendingSms;
        pendingCaseIds.clear();
        pendingFullCases = false;
        pendingSms = false;
        if (full) state.refetchCases();
        else if (ids.length > 0) state.applyCaseChanges(ids);
        if (sms && !full) state.refreshUnreadSmsFlags();
        // Hộp thư SMS tổng hợp (badge cạnh chuông) chỉ cần nạp lại khi tin nhắn thật sự đổi.
        // Gate theo quyền sendSms để tránh gọi API vô ích (server cũng tự chặn 403).
        const me = state.users.find((u) => u.id === userId);
        if (sms && me && hasFeature(state.featurePermissions, "sendSms", me.role)) {
          state.fetchSmsInbox();
        }
      }, 500);
    }
    let cpaReviewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingCpaReviewIds = new Set<string>();
    let pendingFullCpaReview = false;
    function onCpaReviewChanged(data?: { recordId?: string | null }) {
      if (typeof data?.recordId === "string" && data.recordId) pendingCpaReviewIds.add(data.recordId);
      else pendingFullCpaReview = true;
      if (cpaReviewDebounceTimer) clearTimeout(cpaReviewDebounceTimer);
      cpaReviewDebounceTimer = setTimeout(() => {
        const state = useAppStore.getState();
        const ids = [...pendingCpaReviewIds];
        const full = pendingFullCpaReview || ids.length > MAX_TARGETED;
        pendingCpaReviewIds.clear();
        pendingFullCpaReview = false;
        if (full) state.refetchCpaReview();
        else if (ids.length > 0) state.applyCpaReviewChanges(ids);
      }, 500);
    }
    function onNotification(n: AppNotification) {
      useAppStore.getState().receiveNotification(n);
    }
    let rulesDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    function onRulesChanged() {
      if (rulesDebounceTimer) clearTimeout(rulesDebounceTimer);
      rulesDebounceTimer = setTimeout(() => {
        useAppStore.getState().refetchRules();
      }, 500);
    }
    let processorReportDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    function onProcessorReportChanged() {
      if (processorReportDebounceTimer) clearTimeout(processorReportDebounceTimer);
      processorReportDebounceTimer = setTimeout(() => {
        useAppStore.getState().refetchProcessorReportEntries();
      }, 500);
    }

    const casesChannel = pusher.subscribe(CASES_CHANNEL);
    casesChannel.bind("case:changed", onCaseChanged);

    const cpaReviewChannel = pusher.subscribe(CPA_REVIEW_CHANNEL);
    cpaReviewChannel.bind("cpaReview:changed", onCpaReviewChanged);

    const rulesChannel = pusher.subscribe(RULES_CHANNEL);
    rulesChannel.bind("rules:changed", onRulesChanged);

    const processorReportChannel = pusher.subscribe(PROCESSOR_REPORT_CHANNEL);
    processorReportChannel.bind("processorReport:changed", onProcessorReportChanged);

    const notifChannelName = `private-notifications-${userId}`;
    const notifChannel = pusher.subscribe(notifChannelName);
    notifChannel.bind("notification:new", onNotification);

    function onPresenceSubscribed(members: PresenceMembers) {
      const ids: string[] = [];
      members.each((m) => ids.push(m.id));
      useAppStore.getState().setOnlineUserIds(ids);
    }
    function onMemberAdded(member: { id: string }) {
      useAppStore.getState().addOnlineUserId(member.id);
    }
    function onMemberRemoved(member: { id: string }) {
      useAppStore.getState().removeOnlineUserId(member.id);
    }
    const presenceChannel = pusher.subscribe(PRESENCE_ONLINE_CHANNEL);
    presenceChannel.bind("pusher:subscription_succeeded", onPresenceSubscribed);
    presenceChannel.bind("pusher:member_added", onMemberAdded);
    presenceChannel.bind("pusher:member_removed", onMemberRemoved);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (cpaReviewDebounceTimer) clearTimeout(cpaReviewDebounceTimer);
      if (rulesDebounceTimer) clearTimeout(rulesDebounceTimer);
      if (processorReportDebounceTimer) clearTimeout(processorReportDebounceTimer);
      casesChannel.unbind("case:changed", onCaseChanged);
      cpaReviewChannel.unbind("cpaReview:changed", onCpaReviewChanged);
      rulesChannel.unbind("rules:changed", onRulesChanged);
      processorReportChannel.unbind("processorReport:changed", onProcessorReportChanged);
      notifChannel.unbind("notification:new", onNotification);
      presenceChannel.unbind("pusher:subscription_succeeded", onPresenceSubscribed);
      presenceChannel.unbind("pusher:member_added", onMemberAdded);
      presenceChannel.unbind("pusher:member_removed", onMemberRemoved);
      pusher.unsubscribe(CASES_CHANNEL);
      pusher.unsubscribe(CPA_REVIEW_CHANNEL);
      pusher.unsubscribe(RULES_CHANNEL);
      pusher.unsubscribe(PROCESSOR_REPORT_CHANNEL);
      pusher.unsubscribe(notifChannelName);
      pusher.unsubscribe(PRESENCE_ONLINE_CHANNEL);
      useAppStore.getState().setOnlineUserIds([]);
    };
  }, [userId]);
}
