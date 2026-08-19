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
// TRANG nhỏ mỗi lần gọi thay vì cả file (client tự gọi nhiều lần, xem
// pdf-compress-panel.tsx), để mỗi lần gọi luôn nằm trong giới hạn này kể cả với file rất
// nặng/trang (đã gặp thật trên production: file 15 trang, 48MB -- ~3.2MB/trang, đủ nặng để
// riêng bước GIẢI MÃ ảnh gốc của 15 trang cộng dồn vượt quá 60s nếu xử lý trong 1 lần gọi).
export const maxDuration = 60;
const PROCESSING_TIMEOUT_MS = 50_000;

/**
 * Xử lý ĐÚNG 1 TRANG của 1 file PDF -- render thành JPEG vừa `perPageBudgetBytes` ở `dpi` cho
 * trước, trả về base64 (client tự ráp lại thành PDF cuối cùng bằng `pdf-lib` ngay trên trình
 * duyệt, xem `src/lib/pdf-compress/compress-pdf.ts` cho chi tiết).
 *
 * Nhận trang theo 1 trong 2 cách (2026-08-19, đổi từ nhận `blobUrl` trỏ tới TOÀN BỘ file gốc):
 * - `pagePdfBase64`: client tự cắt riêng trang đó thành 1 PDF nhỏ bằng `pdf-lib` NGAY TRÊN
 *   TRÌNH DUYỆT (đã có sẵn toàn bộ file trong bộ nhớ) rồi gửi thẳng trong thân request --
 *   đường đi MẶC ĐỊNH, áp dụng khi trang đủ nhỏ để nằm trong giới hạn ~4.5MB thân request.
 * - `blobUrl`: dự phòng cho trang quá nặng (ảnh scan độ phân giải rất cao) không vừa thân
 *   request kể cả khi đã tách ri  êng -- client upload RIÊNG trang đó (không phải cả file) lên
 *   Vercel Blob rồi gửi URL, route tự tải về.
 *
 * Lý do đổi từ `blobUrl` trỏ TOÀN BỘ file (thiết kế cũ) sang cắt riêng từng trang: khi mỗi
 * request chỉ xử lý 1 trang nhưng vẫn phải tải lại TOÀN BỘ file gốc từ Blob mỗi lần (thiết kế
 * cũ), số lần tải lặp lại cùng 1 blobUrl tăng vọt (hàng chục lần trong vài giây với file nhiều
 * trang) -- gặp thật production (2026-08-19): 1 trong số đó bị Vercel Blob trả 403 (nghi ngờ
 * chặn do truy cập dồn dập cùng 1 URL), làm fail cả lượt nén dù đã có retry. Cắt riêng từng
 * trang loại bỏ hẳn việc tải lặp lại này.
 */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "useIrsNoticeSplitter", me.role)) {
    return NextResponse.json({ error: "Không có quyền dùng công cụ này" }, { status: 403 });
  }

  const { pagePdfBase64, blobUrl, pageIndex, dpi, perPageBudgetBytes } = await request.json();
  if (
    typeof pageIndex !== "number" ||
    typeof dpi !== "number" ||
    typeof perPageBudgetBytes !== "number" ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 1 ||
    dpi <= 0 ||
    perPageBudgetBytes <= 0 ||
    (typeof pagePdfBase64 !== "string" && typeof blobUrl !== "string")
  ) {
    return NextResponse.json({ error: "Tham số không hợp lệ" }, { status: 400 });
  }

  let bytes: Uint8Array;
  try {
    if (typeof pagePdfBase64 === "string") {
      bytes = new Uint8Array(Buffer.from(pagePdfBase64, "base64"));
    } else {
      bytes = await fetchBlobPdfBytes(blobUrl);
    }
  } catch (err) {
    if (err instanceof BlobFetchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    // Bytes truyền vào luôn là 1 PDF ĐÚNG 1 TRANG (đã cắt riêng phía client hoặc phía đọc
    // blob riêng của trang đó) -- render trang duy nhất (startPage=endPage=1), rồi gắn lại
    // đúng `pageIndex` GỐC (trong tài liệu ban đầu) mà client đã gửi lên trước khi trả về.
    const pages = await withTimeout(
      renderPageRangeToJpegs(bytes, 1, 1, dpi, perPageBudgetBytes),
      PROCESSING_TIMEOUT_MS,
      "Nén quá lâu ở trang này -- thử lại, hoặc file có thể quá nặng để nén được trong giới hạn nền tảng hiện tại."
    );
    const page = pages[0];
    if (!page) {
      return NextResponse.json({ error: "Không đọc được trang PDF đã gửi lên." }, { status: 400 });
    }
    return NextResponse.json({ pages: [{ pageIndex, jpegBase64: page.jpegBase64 }] });
  } catch (err) {
    if (err instanceof ProcessingTimeoutError) {
      return NextResponse.json({ error: err.message }, { status: 408 });
    }
    console.error("[irs-splitter/compress-chunk]", err);
    return NextResponse.json({ error: "Nén file thất bại (file có thể bị hỏng hoặc không đúng định dạng PDF)." }, { status: 400 });
  }
}
