import { prisma } from "@/lib/prisma";
import { getFullName, primarySsn } from "@/lib/client-name";
import { todayIsoDate } from "@/lib/date-format";
import { broadcastNotification } from "@/lib/pusher-server";
import { toNotificationRecord } from "@/app/api/notifications/route";
import type { ClientNameEntry, RefundYearAlarm } from "@/lib/types";

function caseRefLabel(c: { clients: [ClientNameEntry, ClientNameEntry]; ssn: [string | null, string | null] }): string {
  const name = getFullName(c);
  const ssn = primarySsn(c);
  return ssn ? `${name} (SSN: ${ssn})` : name;
}

/**
 * Quét mọi hồ sơ có lịch nhắc TTS & WIT (Case.refundYearAlarm, đặt qua icon đồng hồ trong
 * popup "Refund by years") — với mỗi năm có `date` <= hôm nay (giờ Phoenix) và `notifiedAt`
 * còn null, tạo 1 Notification cho đúng người đã đặt lịch rồi set `notifiedAt` để không bắn
 * lặp lại. Gọi 1 lần/ngày, piggyback trên cron/ringcentral-renew (xem route đó) thay vì đăng
 * ký thêm 1 Cron Job riêng — gói Vercel Hobby giới hạn số Cron Job.
 */
export async function checkAndFireRefundYearAlarms(): Promise<{ checked: number; fired: number }> {
  const today = todayIsoDate();
  const cases = await prisma.case.findMany({
    select: { id: true, clients: true, ssn: true, refundYearAlarm: true },
  });

  let checked = 0;
  let fired = 0;

  for (const kase of cases) {
    const alarms = (kase.refundYearAlarm as unknown as Record<string, RefundYearAlarm | null>) ?? {};
    let changed = false;
    const nextAlarms = { ...alarms };

    for (const [year, alarm] of Object.entries(alarms)) {
      if (!alarm || !alarm.date) continue;
      checked += 1;
      if (alarm.notifiedAt || alarm.date > today) continue;

      const refLabel = caseRefLabel({
        clients: kase.clients as unknown as [ClientNameEntry, ClientNameEntry],
        ssn: kase.ssn as unknown as [string | null, string | null],
      });
      const notif = await prisma.notification.create({
        data: {
          type: "status_change",
          toUserId: alarm.userId,
          fromUserId: alarm.userId,
          caseId: kase.id,
          message: `Hồ sơ ${refLabel} đã đến hạn kiểm tra TTS & WIT cho năm ${year}`,
        },
      });
      await broadcastNotification(alarm.userId, toNotificationRecord(notif), null);

      nextAlarms[year] = { ...alarm, notifiedAt: new Date().toISOString() };
      changed = true;
      fired += 1;
    }

    if (changed) {
      await prisma.case.update({ where: { id: kase.id }, data: { refundYearAlarm: nextAlarms } });
    }
  }

  return { checked, fired };
}
