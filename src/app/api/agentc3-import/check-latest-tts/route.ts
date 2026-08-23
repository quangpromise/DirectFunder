import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { canViewCase } from "@/lib/rbac";
import { getFullName, primarySsn } from "@/lib/client-name";
import { broadcastNotification } from "@/lib/pusher-server";
import { toNotificationRecord } from "@/app/api/notifications/route";
import type { ClientNameEntry } from "@/lib/types";
import {
  AgentC3ConfigError,
  AgentC3LoginError,
  AgentC3NotFoundError,
  fetchLatestTtsAndWit,
  parseAgentC3CustomerId,
} from "@/lib/agentc3-client";

const THROTTLE_MS = 30 * 1000;

function caseRefLabel(c: { clients: [ClientNameEntry, ClientNameEntry]; ssn: [string | null, string | null] }): string {
  const name = getFullName(c);
  const ssn = primarySsn(c);
  return ssn ? `${name} (SSN: ${ssn})` : name;
}

/** Nút "TTS & WIT" ở cột "Check CRM" (bấm tay, không phải cron) — đọc tab Documentation của
 * CRM agentc3, so với snapshot lần kiểm tra trước (`Case.crmLatestTtsUploadedAt`/
 * `crmLatestWitUploadedAt`), báo Notification cho Agent 1 + Processor 1 của hồ sơ nếu có file
 * mới hơn. Lần kiểm tra ĐẦU TIÊN của 1 hồ sơ chỉ lưu baseline, không báo (tránh báo "mới" cho
 * toàn bộ file cũ có sẵn từ trước khi tính năng ra đời). */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ ok: false, error: "Chưa đăng nhập" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { caseId?: string } | null;
  const caseId = body?.caseId;
  if (!caseId) return NextResponse.json({ ok: false, error: "Thiếu caseId" }, { status: 400 });

  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      clients: true,
      ssn: true,
      clientLink: true,
      assignedTo: true,
      assignedProcessor: true,
      assignedTo2: true,
      assignedProcessor2: true,
      createdBy: true,
      crmLatestTtsUploadedAt: true,
      crmLatestWitUploadedAt: true,
      crmTtsCheckedAt: true,
    },
  });
  if (!kase) return NextResponse.json({ ok: false, error: "Không tìm thấy hồ sơ" }, { status: 404 });
  if (!canViewCase(me.role, me.id, kase, me.teamMemberIds)) {
    return NextResponse.json({ ok: false, error: "Không có quyền xem hồ sơ này" }, { status: 403 });
  }

  const customerId = kase.clientLink ? parseAgentC3CustomerId(kase.clientLink) : null;
  if (!customerId) {
    return NextResponse.json({ ok: false, error: "Hồ sơ chưa liên kết với CRM agentc3 (chưa có link)" }, { status: 400 });
  }

  if (kase.crmTtsCheckedAt && Date.now() - kase.crmTtsCheckedAt.getTime() < THROTTLE_MS) {
    return NextResponse.json({ ok: true, throttled: true, foundNew: { tts: false, wit: false } });
  }

  try {
    const { tts, wit } = await fetchLatestTtsAndWit(customerId);

    const foundNew = { tts: false, wit: false };
    const data: Record<string, unknown> = { crmTtsCheckedAt: new Date() };

    const refLabel = caseRefLabel({
      clients: kase.clients as unknown as [ClientNameEntry, ClientNameEntry],
      ssn: kase.ssn as unknown as [string | null, string | null],
    });
    const recipients = Array.from(new Set([kase.assignedTo, kase.assignedProcessor].filter((v): v is string => Boolean(v))));

    async function notify(label: string, snapshot: { timestamp: string; filename: string; title: string }) {
      for (const toUserId of recipients) {
        const notif = await prisma.notification.create({
          data: {
            type: "status_change",
            toUserId,
            fromUserId: toUserId,
            caseId: kase!.id,
            message: `Hồ sơ ${refLabel} có tài liệu ${label} mới trên CRM (${snapshot.title}, ${snapshot.filename}, ${snapshot.timestamp})`,
          },
        });
        await broadcastNotification(toUserId, toNotificationRecord(notif), null);
      }
    }

    if (tts) {
      if (!kase.crmLatestTtsUploadedAt) {
        data.crmLatestTtsUploadedAt = tts.timestamp;
      } else if (tts.timestamp > kase.crmLatestTtsUploadedAt) {
        data.crmLatestTtsUploadedAt = tts.timestamp;
        foundNew.tts = true;
        await notify("TTS", tts);
      }
    }
    if (wit) {
      if (!kase.crmLatestWitUploadedAt) {
        data.crmLatestWitUploadedAt = wit.timestamp;
      } else if (wit.timestamp > kase.crmLatestWitUploadedAt) {
        data.crmLatestWitUploadedAt = wit.timestamp;
        foundNew.wit = true;
        await notify("WIT", wit);
      }
    }

    await prisma.case.update({ where: { id: kase.id }, data });

    return NextResponse.json({ ok: true, throttled: false, foundNew });
  } catch (err) {
    await prisma.case.update({ where: { id: kase.id }, data: { crmTtsCheckedAt: new Date() } }).catch(() => {});
    if (err instanceof AgentC3ConfigError) {
      return NextResponse.json({ ok: false, error: "Chưa cấu hình tài khoản CRM agentc3" }, { status: 501 });
    }
    if (err instanceof AgentC3LoginError) return NextResponse.json({ ok: false, error: err.message }, { status: 502 });
    if (err instanceof AgentC3NotFoundError) return NextResponse.json({ ok: false, error: err.message }, { status: 404 });
    console.error("[agentc3-import/check-latest-tts] Lỗi không xác định:", err);
    return NextResponse.json({ ok: false, error: "Không đọc được dữ liệu từ CRM agentc3" }, { status: 502 });
  }
}
