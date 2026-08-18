import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { analyzeIrsPdf } from "@/lib/irs-splitter";
import { BlobFetchError, fetchBlobPdfBytes } from "@/lib/irs-splitter/fetch-blob-pdf";
import type { FeaturePermissions } from "@/lib/types";

// Chạy trên Node runtime (không phải Edge) -- pdfjs-dist/pdf-lib cần Buffer/API Node đầy đủ.
export const runtime = "nodejs";
// File PDF gộp nhiều thư có thể khá lớn (scan nhiều trang) -- nới thời gian xử lý so với
// mặc định 10s (Vercel Hobby)/không giới hạn (route handler local).
export const maxDuration = 60;

/**
 * Bước 1 của công cụ "Notice Splitter": đọc 1 file PDF gộp nhiều thư IRS, trả về danh sách
 * record (khoảng trang + tên/loại thư/tax year/cờ "Not Update CRM" đoán được) để hiện bảng
 * soát/sửa ở client TRƯỚC khi tách file thật -- xem lib/irs-splitter/index.ts. Chưa ghi gì
 * xuống DB/đĩa, chỉ xử lý trong bộ nhớ của request này.
 *
 * Nhận `{blobUrl}` (JSON) thay vì file thật qua FormData -- client tự upload file thẳng lên
 * Vercel Blob trước (`/api/irs-splitter/blob-upload`), né giới hạn CỨNG ~4.5MB thân request
 * của Vercel Serverless Function. Route này chỉ tự tải lại bytes từ URL đó (server-to-server
 * fetch không bị giới hạn kiểu này).
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

  try {
    const bytes = await fetchBlobPdfBytes(blobUrl);
    const { pageCount, records } = await analyzeIrsPdf(bytes);
    return NextResponse.json({ pageCount, records });
  } catch (err) {
    if (err instanceof BlobFetchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[irs-splitter/analyze]", err);
    return NextResponse.json({ error: "Không đọc được file PDF (file có thể bị hỏng hoặc không đúng định dạng)." }, { status: 400 });
  }
}
