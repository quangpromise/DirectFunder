import { del } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { sendCpaEmail, type CpaEmailAttachment } from "@/lib/mailer";
import type { FeaturePermissions } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// File đính kèm giờ upload thẳng lên Vercel Blob từ client (né giới hạn ~4.5MB thân request
// của Serverless Function -- xem .claude/skills/vercel-blob-large-upload/SKILL.md), route
// này chỉ nhận blobUrl rồi tự tải bytes về. 20MB đủ rộng cho hầu hết file CPA thật (scan/xlsx)
// mà vẫn để margin an toàn dưới giới hạn đính kèm thật của Gmail (~25MB, tính cả overhead
// MIME encoding).
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function isNonEmptyEmailArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim().length > 0);
}

interface AttachmentInput {
  filename: string;
  contentType: string;
  blobUrl: string;
}

function isAttachmentInputArray(v: unknown): v is AttachmentInput[] {
  return (
    Array.isArray(v) &&
    v.every(
      (a) =>
        a &&
        typeof a.filename === "string" &&
        typeof a.contentType === "string" &&
        typeof a.blobUrl === "string" &&
        a.blobUrl.length > 0
    )
  );
}

/** Gửi email cho CPA từ 1 hồ sơ cụ thể — lưu `cpaEmailSentAt` xuống bảng Case (gửi thật
 * hoặc "Mark as sent" thủ công đều lưu) để nút giữ đúng trạng thái xanh (đã gửi) qua
 * reload/deploy lại — trước đây chỉ lưu ở React state nên mất ngay khi F5. `clear: true`
 * (bấm "muốn gửi lại") xoá lại giá trị này, không gọi Gmail. Lịch sử gửi chi tiết (nội
 * dung mail...) vẫn chỉ lưu ở Edit History phía client như cũ (xem sendCpaEmail trong
 * app-store.ts, gọi logEdit() sau khi request này trả về thành công). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/cases/[id]/send-cpa-email">) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "sendCpaEmail", me.role)) {
    return NextResponse.json({ error: "Không có quyền gửi email cho CPA" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const kase = await prisma.case.findUnique({ where: { id } });
  if (!kase) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });

  const body = await request.json().catch(() => null);

  // manual: bấm "Mark as sent" (đã gửi qua đường khác, KHÔNG gọi Gmail thật).
  // clear: bấm xác nhận "muốn gửi lại" (xoá cpaEmailSentAt, không gọi Gmail).
  if (body?.clear === true) {
    const updated = await prisma.case.update({ where: { id }, data: { cpaEmailSentAt: null } });
    return NextResponse.json({ ok: true, cpaEmailSentAt: updated.cpaEmailSentAt });
  }
  if (body?.manual === true) {
    const updated = await prisma.case.update({ where: { id }, data: { cpaEmailSentAt: new Date() } });
    return NextResponse.json({ ok: true, cpaEmailSentAt: updated.cpaEmailSentAt!.toISOString() });
  }

  if (!body || !isNonEmptyEmailArray(body.to)) {
    return NextResponse.json({ error: "Thiếu người nhận (To)" }, { status: 400 });
  }
  if (typeof body.subject !== "string" || !body.subject.trim()) {
    return NextResponse.json({ error: "Thiếu tiêu đề (Subject)" }, { status: 400 });
  }
  const cc: string[] = Array.isArray(body.cc) ? body.cc.filter((s: unknown) => typeof s === "string" && s.trim()) : [];
  if (!isAttachmentInputArray(body.attachments)) {
    console.error("[send-cpa-email] attachments không hợp lệ, body.attachments nhận được:", JSON.stringify(body.attachments));
    return NextResponse.json({ error: "Tệp đính kèm không hợp lệ" }, { status: 400 });
  }
  const attachmentInputs: AttachmentInput[] = body.attachments;

  // Tải bytes từng file đính kèm về từ Vercel Blob (client đã upload thẳng lên Blob, xem
  // send-cpa-email-dialog.tsx) -- server-to-server fetch không bị giới hạn ~4.5MB thân
  // request như request gốc từ trình duyệt.
  let attachments: CpaEmailAttachment[];
  let totalBytes = 0;
  try {
    attachments = await Promise.all(
      attachmentInputs.map(async (a): Promise<CpaEmailAttachment> => {
        const res = await fetch(a.blobUrl);
        if (!res.ok) {
          throw new Error(`Không tải được tệp đính kèm "${a.filename}" từ storage tạm (link có thể đã hết hạn).`);
        }
        const content = Buffer.from(await res.arrayBuffer());
        totalBytes += content.length;
        return { filename: a.filename, contentType: a.contentType, content };
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Không tải được tệp đính kèm.";
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    // Xoá blob NGAY sau khi đã tải xong (dù thành công hay lỗi) -- gửi mail là bước cuối
    // cùng của luồng này, không cần giữ lại blob chờ bước nào khác.
    for (const a of attachmentInputs) {
      del(a.blobUrl).catch((err) => console.error("[send-cpa-email] xoá blob thất bại", a.blobUrl, err));
    }
  }

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "Tổng dung lượng tệp đính kèm vượt quá 20MB" }, { status: 400 });
  }

  try {
    await sendCpaEmail({
      to: body.to,
      cc,
      subject: body.subject.trim(),
      html: typeof body.html === "string" ? body.html : "",
      text: typeof body.text === "string" ? body.text : "",
      attachments,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gửi email thất bại, thử lại sau.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const updated = await prisma.case.update({ where: { id }, data: { cpaEmailSentAt: new Date() } });
  return NextResponse.json({ ok: true, cpaEmailSentAt: updated.cpaEmailSentAt!.toISOString() });
}
