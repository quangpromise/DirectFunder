import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import type { FeaturePermissions } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Sinh token cho client upload file đính kèm "Send mail to CPA" THẲNG lên Vercel Blob — né
 * giới hạn CỨNG ~4.5MB thân request của Vercel Serverless Function (trước đây file đính kèm
 * gửi base64 thẳng trong body, giới hạn tổng 4MB). Cùng pattern đã dùng cho Notice Splitter,
 * xem `.claude/skills/vercel-blob-large-upload/SKILL.md`.
 *
 * KHÔNG giới hạn `allowedContentTypes` (khác route blob-upload của Notice Splitter chỉ nhận
 * PDF) — file đính kèm CPA có thể là ảnh/doc/xlsx bất kỳ, để trống nghĩa là chấp nhận mọi
 * loại. Không có `onUploadCompleted` (không cần, xoá blob đặt ngay trong route
 * `send-cpa-email` sau khi gửi mail xong — khác Notice Splitter, ở đây gửi mail LUÔN LÀ bước
 * cuối cùng của luồng, không cần tách route xoá riêng).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const me = await requireUser();
        if (!me) throw new Error("Chưa đăng nhập");

        const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
        const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
        if (!permissions || !hasFeature(permissions, "sendCpaEmail", me.role)) {
          throw new Error("Không có quyền gửi email cho CPA");
        }

        return { addRandomSuffix: true };
      },
      onUploadCompleted: async () => {
        // no-op có chủ đích -- xem comment đầu file.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Xin token upload thất bại" }, { status: 400 });
  }
}
