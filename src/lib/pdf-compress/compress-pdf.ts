import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";
import type { Canvas } from "@napi-rs/canvas";
import { NapiCanvasFactory } from "./node-canvas-factory";
import type { PageJpegResult } from "./types";

const MIN_JPEG_QUALITY = 35;
const MAX_JPEG_QUALITY = 92;
// ~6 bước binary-search đưa quality về sai số ±1, đủ chính xác mà không cần thử quá nhiều
// lần (encode JPEG tuy rẻ hơn render nhưng vẫn tốn CPU nhân với số trang).
const QUALITY_SEARCH_STEPS = 6;

/**
 * Render 1 KHOẢNG TRANG (không phải cả tài liệu) của 1 file PDF thành JPEG ở 1 mức DPI cho
 * trước, mỗi trang vừa `perPageBudgetBytes` (binary-search JPEG quality). Đây là đơn vị xử
 * lý NHỎ NHẤT gọi từ route `/api/irs-splitter/compress-chunk` -- việc chia nhỏ theo khoảng
 * trang + gọi nhiều lần (thay vì xử lý trọn 1 file trong 1 lần gọi server) là để mỗi lần gọi
 * luôn nằm trong giới hạn 60s/lần của Vercel (đặc biệt gói Hobby, KHÔNG nâng được bằng code)
 * -- xem `src/components/pdf-compress-panel.tsx` cho phần điều phối gọi nhiều lần + ráp lại
 * PDF cuối cùng NGAY TRÊN TRÌNH DUYỆT bằng `pdf-lib` (không cần thêm 1 lần gọi server để ráp).
 *
 * KHÔNG trả về kích thước point của trang (client đã tự có sẵn qua `pdf-lib` lúc đọc file gốc
 * trước khi upload, xem `readPageSizesPt` phía client) -- giữ payload trả về gọn nhất có thể
 * (chỉ JPEG base64), vì phải gửi qua nhiều lần gọi.
 */
export async function renderPageRangeToJpegs(
  pdfData: Uint8Array | Buffer,
  startPage: number,
  endPage: number,
  dpi: number,
  perPageBudgetBytes: number
): Promise<PageJpegResult[]> {
  const data = new Uint8Array(pdfData);
  const canvasFactory = new NapiCanvasFactory();
  const loadingTask = pdfjsLib.getDocument({ data, disableFontFace: true, canvasFactory });
  const doc = await loadingTask.promise;
  const lastPage = Math.min(endPage, doc.numPages);

  const results: PageJpegResult[] = [];
  for (let i = Math.max(1, startPage); i <= lastPage; i++) {
    const page = await doc.getPage(i);
    const renderViewport = page.getViewport({ scale: dpi / 72 });
    const width = Math.max(1, Math.ceil(renderViewport.width));
    const height = Math.max(1, Math.ceil(renderViewport.height));
    const canvasAndContext = canvasFactory.create(width, height);

    // pdfjs type hoá `canvasContext` là `CanvasRenderingContext2D` (DOM chuẩn) --
    // `SKRSContext2D` của `@napi-rs/canvas` đủ tương thích API-shape để pdfjs vẽ được, chỉ
    // thiếu vài method chỉ dành cho DOM (vd `drawFocusIfNeeded`, không liên quan tới vẽ
    // headless) nên cần ép kiểu qua `unknown` (không dùng `any`).
    await page.render({
      canvasContext: canvasAndContext.context as unknown as CanvasRenderingContext2D,
      viewport: renderViewport,
    }).promise;

    const jpegBuffer = encodeJpegToBudget(canvasAndContext.canvas, perPageBudgetBytes);
    canvasFactory.destroy(canvasAndContext);

    results.push({ pageIndex: i, jpegBase64: jpegBuffer.toString("base64") });
  }

  return results;
}

/** Binary-search JPEG quality để vừa `budgetBytes`. Trả về buffer LỚN NHẤT tìm được mà vẫn
 * <= budget; nếu ngay cả MIN_JPEG_QUALITY cũng vượt budget, chấp nhận trả về mức đó (không cố
 * hạ thấp hơn nữa -- dưới sàn này ảnh bắt đầu vỡ khối rõ rệt, không còn đáng đánh đổi). */
function encodeJpegToBudget(canvas: Canvas, budgetBytes: number): Buffer {
  let lo = MIN_JPEG_QUALITY;
  let hi = MAX_JPEG_QUALITY;
  let best: Buffer = canvas.toBuffer("image/jpeg", MIN_JPEG_QUALITY);
  for (let step = 0; step < QUALITY_SEARCH_STEPS && lo <= hi; step++) {
    const mid = Math.round((lo + hi) / 2);
    const buf: Buffer = canvas.toBuffer("image/jpeg", mid);
    if (buf.length <= budgetBytes) {
      best = buf;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
