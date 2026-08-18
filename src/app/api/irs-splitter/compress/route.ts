import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { compressPdfUnder1MB } from "@/lib/pdf-compress";
import { BlobFetchError, fetchBlobPdfBytes } from "@/lib/irs-splitter/fetch-blob-pdf";
import { ProcessingTimeoutError, withTimeout } from "@/lib/irs-splitter/with-timeout";
import type { FeaturePermissions } from "@/lib/types";

export const runtime = "nodejs";
// 60s là mốc CỨNG của gói Vercel Hobby -- xem PROCESSING_TIMEOUT_MS + comment tương tự ở
// analyze/route.ts, split/route.ts cho lý do chủ động trả lỗi sớm hơn mốc này.
export const maxDuration = 60;
const PROCESSING_TIMEOUT_MS = 50_000;

/**
 * Tab con "Nén PDF" trong "Notice Splitter" -- nén 1 file PDF xuống dưới 1MB BẤT KỂ file gốc
 * nặng bao nhiêu (rasterize từng trang thành JPEG, xem `src/lib/pdf-compress/compress-pdf.ts`
 * cho thuật toán + đánh đổi mất lớp text đã được người dùng xác nhận chấp nhận). Cùng cơ chế
 * upload qua Vercel Blob với `analyze`/`split` (né giới hạn ~4.5MB thân request) -- dùng
 * CHUNG route sinh token `/api/irs-splitter/blob-upload` (cùng quyền `useIrsNoticeSplitter`,
 * không cần feature key riêng vì tính năng này nằm lồng trong cùng tab, không phải mục điều
 * hướng độc lập).
 */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "useIrsNoticeSplitter", me.role)) {
    return NextResponse.json({ error: "Không có quyền dùng công cụ này" }, { status: 403 });
  }

  const { blobUrl, fileName } = await request.json();

  let bytes: Uint8Array;
  try {
    bytes = await fetchBlobPdfBytes(blobUrl);
  } catch (err) {
    if (err instanceof BlobFetchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  let response: NextResponse;
  try {
    const result = await withTimeout(
      compressPdfUnder1MB(bytes),
      PROCESSING_TIMEOUT_MS,
      "Nén file quá lâu (file có thể quá nhiều trang cho giới hạn xử lý 60 giây) -- hãy thử chia nhỏ file trước (dùng tab Tách thư) rồi nén từng phần."
    );
    const zipName = (typeof fileName === "string" && fileName.replace(/\.pdf$/i, "")) || "compressed";
    response = new NextResponse(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${zipName} - compressed.pdf"`,
        "X-Compress-Hit-Floor": String(result.hitFloor),
        "X-Compress-Final-Bytes": String(result.bytes.length),
        "X-Compress-Final-Dpi": String(result.finalDpi),
      },
    });
  } catch (err) {
    if (err instanceof ProcessingTimeoutError) {
      return NextResponse.json({ error: err.message }, { status: 408 });
    }
    console.error("[irs-splitter/compress]", err);
    return NextResponse.json({ error: "Nén file thất bại (file có thể bị hỏng hoặc không đúng định dạng PDF)." }, { status: 400 });
  }

  // Xoá blob ngay sau khi đã nén xong -- best-effort, không chặn trả kết quả nếu xoá lỗi
  // (cùng tradeoff đã chọn cho route split, xem deployment-database-sync.md mục 4.31).
  if (typeof blobUrl === "string") {
    try {
      await del(blobUrl);
    } catch (err) {
      console.error("[irs-splitter/compress] xoá blob thất bại (không chặn response)", err);
    }
  }

  return response;
}
