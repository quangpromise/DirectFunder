import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import type { FeaturePermissions } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Xoá 1 blob khỏi Vercel Blob sau khi client đã xử lý xong (dùng cho luồng "Nén PDF" chunked
 * -- client tự ráp PDF cuối cùng trên trình duyệt, không có 1 route server "cuối cùng" nào để
 * tiện xoá kèm theo như route `split`, nên cần route riêng này). Best-effort từ phía CLIENT
 * gọi (không phải sự kiện server tự trigger) -- nếu client đóng tab trước khi gọi được, blob
 * mồ côi lại (chấp nhận được, cùng tradeoff "không cần TTL/cron dọn rác" đã chọn cho toàn bộ
 * tính năng Notice Splitter/Nén PDF).
 */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "useIrsNoticeSplitter", me.role)) {
    return NextResponse.json({ error: "Không có quyền dùng công cụ này" }, { status: 403 });
  }

  const { blobUrl } = await request.json();
  if (typeof blobUrl !== "string" || !blobUrl) {
    return NextResponse.json({ error: "Thiếu blobUrl" }, { status: 400 });
  }

  try {
    await del(blobUrl);
  } catch (err) {
    console.error("[irs-splitter/blob-delete]", err);
    // Không chặn client -- xoá thất bại chỉ để mồ côi 1 file, không phải lỗi người dùng cần biết.
  }

  return NextResponse.json({ ok: true });
}
