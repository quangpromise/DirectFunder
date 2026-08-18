import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { renderPageRangeToJpegs } from "@/lib/pdf-compress";
import { BlobFetchError, fetchBlobPdfBytes } from "@/lib/irs-splitter/fetch-blob-pdf";
import { ProcessingTimeoutError, withTimeout } from "@/lib/irs-splitter/with-timeout";
import type { FeaturePermissions } from "@/lib/types";

export const runtime = "nodejs";
// 60s là mốc CỨNG của gói Vercel Hobby -- xem comment ở dưới cho lý do route này chỉ xử lý 1
// KHOẢNG TRANG nhỏ mỗi lần gọi thay vì cả file (client tự gọi nhiều lần, xem
// pdf-compress-panel.tsx), để mỗi lần gọi luôn nằm trong giới hạn này kể cả với file rất
// nặng/trang (đã gặp thật trên production: file 15 trang, 48MB -- ~3.2MB/trang, đủ nặng để
// riêng bước GIẢI MÃ ảnh gốc của 15 trang cộng dồn vượt quá 60s nếu xử lý trong 1 lần gọi).
export const maxDuration = 60;
const PROCESSING_TIMEOUT_MS = 50_000;

/**
 * Xử lý 1 KHOẢNG TRANG của 1 file PDF -- render mỗi trang thành JPEG vừa `perPageBudgetBytes`
 * ở `dpi` cho trước, trả về base64 (client tự ráp lại thành PDF cuối cùng bằng `pdf-lib` ngay
 * trên trình duyệt, xem `src/lib/pdf-compress/compress-pdf.ts` cho chi tiết + lý do chia nhỏ
 * theo khoảng trang thay vì xử lý trọn file trong 1 lần gọi).
 */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "useIrsNoticeSplitter", me.role)) {
    return NextResponse.json({ error: "Không có quyền dùng công cụ này" }, { status: 403 });
  }

  const { blobUrl, startPage, endPage, dpi, perPageBudgetBytes } = await request.json();
  if (
    typeof startPage !== "number" ||
    typeof endPage !== "number" ||
    typeof dpi !== "number" ||
    typeof perPageBudgetBytes !== "number" ||
    !Number.isInteger(startPage) ||
    !Number.isInteger(endPage) ||
    startPage < 1 ||
    endPage < startPage ||
    dpi <= 0 ||
    perPageBudgetBytes <= 0
  ) {
    return NextResponse.json({ error: "Tham số không hợp lệ" }, { status: 400 });
  }

  let bytes: Uint8Array;
  try {
    bytes = await fetchBlobPdfBytes(blobUrl);
  } catch (err) {
    if (err instanceof BlobFetchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    const pages = await withTimeout(
      renderPageRangeToJpegs(bytes, startPage, endPage, dpi, perPageBudgetBytes),
      PROCESSING_TIMEOUT_MS,
      "Nén quá lâu ở khoảng trang này -- thử lại, hoặc file có thể quá nặng để nén được trong giới hạn nền tảng hiện tại."
    );
    return NextResponse.json({ pages });
  } catch (err) {
    if (err instanceof ProcessingTimeoutError) {
      return NextResponse.json({ error: err.message }, { status: 408 });
    }
    console.error("[irs-splitter/compress-chunk]", err);
    return NextResponse.json({ error: "Nén file thất bại (file có thể bị hỏng hoặc không đúng định dạng PDF)." }, { status: 400 });
  }
}
