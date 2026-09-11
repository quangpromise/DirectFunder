/** Mã hoá/giải mã đường dẫn tới 1 dòng cụ thể trên tab "CPA Review" trong field `caseId` của
 * Notification (field tái dùng, không có FK tới Case) — dùng cho thông báo "Status năm ...
 * đã chuyển sang Rejected" (thêm 2026-09-11, xem notifyProcessorOnRejectedCpaReviewStatus
 * trong cpa-review-case-sync.ts). Tách ra file riêng (isomorphic, không import prisma) để dùng
 * được ở CẢ server (encode lúc tạo Notification) lẫn client (decode lúc bấm vào thông báo,
 * notification-bell.tsx / cpa-review/page.tsx). */
const CPA_REVIEW_NOTIFICATION_PREFIX = "cpareview:";

export function encodeCpaReviewNotificationTarget(month: string, recordId: string): string {
  return `${CPA_REVIEW_NOTIFICATION_PREFIX}${month}:${recordId}`;
}

export interface CpaReviewNotificationTarget {
  month: string;
  recordId: string;
}

export function parseCpaReviewNotificationTarget(caseId: string): CpaReviewNotificationTarget | null {
  if (!caseId.startsWith(CPA_REVIEW_NOTIFICATION_PREFIX)) return null;
  const rest = caseId.slice(CPA_REVIEW_NOTIFICATION_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  const month = rest.slice(0, sep);
  const recordId = rest.slice(sep + 1);
  if (!month || !recordId) return null;
  return { month, recordId };
}
