import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { canEditCase, canEditColumn } from "@/lib/rbac";
import type { ColumnDef } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Sinh token cho client upload file đính kèm THẲNG lên Vercel Blob (né giới hạn ~4.5MB thân
 * request Serverless Function — xem `.claude/skills/vercel-blob-large-upload/SKILL.md`) khi
 * reply Description trên 1 hồ sơ cụ thể. KHÁC mọi use-case blob khác trong repo: file ở đây
 * KHÔNG lưu lại lâu dài — chỉ dùng để đính link vào tin nhắn Teams gửi Agent 1 rồi bị `del()`
 * ngay sau khi gửi xong (xem PATCH /api/cases/[id]/route.ts) — không có DB field nào tham
 * chiếu tới blob này.
 *
 * `onBeforeGenerateToken` là ranh giới bảo mật thật — kiểm tra CHÍNH XÁC điều kiện client
 * đang dùng để quyết định hiện nút Reply cho Description (`canEditColumn` cột "description"
 * + `canEditCase`, xem src/app/dashboard/cases/page.tsx dòng `editable={...}`).
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/cases/[id]/description-attachment-upload">
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const me = await requireUser();
        if (!me) throw new Error("Chưa đăng nhập");

        const kase = await prisma.case.findUnique({
          where: { id },
          select: { assignedTo: true, assignedTo2: true, assignedProcessor: true, assignedProcessor2: true, createdBy: true },
        });
        if (!kase) throw new Error("Không tìm thấy hồ sơ");

        const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
        const columns = (config?.columns as ColumnDef[] | undefined) ?? [];
        const column = columns.find((c) => c.key === "description");
        if (!column || !canEditColumn(me.role, column) || !canEditCase(me.role, me.id, kase, me.teamMemberIds)) {
          throw new Error("Không có quyền đính kèm file cho hồ sơ này");
        }

        return { addRandomSuffix: true };
      },
      onUploadCompleted: async () => {
        // no-op có chủ đích — xoá blob đặt trong PATCH /api/cases/[id]/route.ts ngay sau khi
        // gửi Teams xong, không cần webhook này (cũng không hoạt động ở localhost).
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Xin token upload thất bại" }, { status: 400 });
  }
}
