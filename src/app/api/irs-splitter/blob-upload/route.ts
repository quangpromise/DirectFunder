import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import type { FeaturePermissions } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Sinh token cho client upload PDF THẲNG lên Vercel Blob (bỏ qua route handler này hoàn
 * toàn cho phần thân file) — né giới hạn CỨNG ~4.5MB thân request của Vercel Serverless
 * Function (chặn ở tầng edge/proxy, không có cách nào nới từ code Next.js). Request tới
 * route NÀY chỉ xin token (thân rất nhỏ), không dính giới hạn đó.
 *
 * `onUploadCompleted` là webhook Vercel tự gọi ngược lại sau khi client upload xong — CHỈ
 * hoạt động khi app có domain public (Vercel production), KHÔNG gọi được từ localhost, nên
 * không đặt logic quan trọng ở đây. Xoá blob sau khi dùng xong đặt ở route
 * `/api/irs-splitter/split` (điểm cuối của luồng xử lý), không phụ thuộc webhook này.
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
        if (!permissions || !hasFeature(permissions, "useIrsNoticeSplitter", me.role)) {
          throw new Error("Không có quyền dùng công cụ này");
        }

        return {
          allowedContentTypes: ["application/pdf"],
          addRandomSuffix: true,
        };
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
