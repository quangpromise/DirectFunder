import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";
import { PDFDocument } from "pdf-lib";
import type { Canvas } from "@napi-rs/canvas";
import { NapiCanvasFactory } from "./node-canvas-factory";
import type { CompressResult } from "./types";

const TARGET_BYTES = 1_000_000;
// Chừa an toàn dưới mốc 1MB thật (920KB) để bù overhead container PDF (xref table, object
// header mỗi trang...) -- tổng byte mỗi trang cộng lại vừa khít KHÔNG có nghĩa file cuối
// cùng cũng khít vậy, luôn nhỉnh hơn 1 chút.
const SAFETY_MARGIN = 0.92;
// Giảm dần DPI khi JPEG quality thấp nhất vẫn không đủ -- giảm dần thay vì binary-search vì
// RENDER (pdfjs) mới là bước tốn kém, encode JPEG lại ở nhiều mức quality thì rẻ (không cần
// render lại). 200 gần như luôn đủ nét để đọc; 72 (DPI "màn hình") là sàn cuối cùng.
const DPI_STEPS = [200, 150, 120, 96, 72];
const MIN_JPEG_QUALITY = 35;
const MAX_JPEG_QUALITY = 92;
// ~6 bước binary-search đưa quality về sai số ±1, đủ chính xác mà không cần thử quá nhiều
// lần (encode JPEG tuy rẻ hơn render nhưng vẫn tốn CPU nhân với số trang).
const QUALITY_SEARCH_STEPS = 6;

/**
 * Nén 1 file PDF xuống dưới 1MB BẤT KỂ file gốc nặng bao nhiêu -- CHỈ CÓ CÁCH DUY NHẤT đảm
 * bảo được ngưỡng cứng này: rasterize từng trang thành ảnh JPEG rồi ráp lại thành 1 PDF toàn
 * ảnh (KHÔNG giữ được lớp text/copy-paste/search chữ nữa -- đánh đổi đã được người dùng xác
 * nhận chấp nhận trước khi làm tính năng này, xem deployment-database-sync.md).
 *
 * Thuật toán: với mỗi mức DPI (giảm dần nếu mức trước không đủ), render TỪNG TRANG MỘT
 * (tuần tự, không giữ tất cả trong RAM cùng lúc -- tránh vượt bộ nhớ hàm serverless với file
 * nhiều trang) bằng pdfjs-dist + `@napi-rs/canvas`, rồi binary-search JPEG quality cho từng
 * trang để vừa 1 ngân sách byte/trang (`TARGET_BYTES * SAFETY_MARGIN / pageCount`) -- ngân
 * sách này chỉ là mục tiêu HEURISTIC, không phải giới hạn cứng (trang phức tạp có thể vượt
 * ngân sách ở quality sàn, trang đơn giản/trắng nhiều sẽ tự nhiên nhẹ hơn ngân sách). Đo lại
 * TỔNG dung lượng PDF thật sau khi ráp xong ở mỗi mức DPI mới là điều kiện dừng thật sự.
 *
 * Nếu hết cả 5 mức DPI mà vẫn > 1MB (file quá nhiều trang) -- KHÔNG lỗi cứng, trả về kết quả
 * tốt nhất đã có kèm cờ `hitFloor: true` để caller tự quyết định cách báo cho người dùng.
 */
export async function compressPdfUnder1MB(pdfData: Uint8Array | Buffer): Promise<CompressResult> {
  const data = new Uint8Array(pdfData);
  const canvasFactory = new NapiCanvasFactory();
  const loadingTask = pdfjsLib.getDocument({ data, disableFontFace: true, canvasFactory });
  const doc = await loadingTask.promise;
  const pageCount = doc.numPages;
  if (pageCount === 0) throw new Error("File PDF không có trang nào.");

  const perPageBudgetBytes = Math.max(1, Math.floor((TARGET_BYTES * SAFETY_MARGIN) / pageCount));

  let lastAttemptBytes: Uint8Array | null = null;
  let lastAttemptDpi = DPI_STEPS[0];

  for (const dpi of DPI_STEPS) {
    const outDoc = await PDFDocument.create();

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      // Kích thước THẬT của trang PDF gốc (đơn vị point, 1/72 inch) -- dùng để tạo trang
      // output đúng tỷ lệ, KHÔNG phải kích thước pixel đã render ở DPI cao hơn.
      const pointsViewport = page.getViewport({ scale: 1 });
      const renderViewport = page.getViewport({ scale: dpi / 72 });
      const width = Math.max(1, Math.ceil(renderViewport.width));
      const height = Math.max(1, Math.ceil(renderViewport.height));
      const canvasAndContext = canvasFactory.create(width, height);

      // `canvasFactory` KHÔNG cần truyền lại ở đây -- `canvasContext` đã là context THẬT tự
      // tạo qua factory ở dòng trên, render() dùng thẳng context đó (không cần tự tạo canvas
      // nội bộ qua factory nữa, khác `getDocument({canvasFactory})` ở trên). pdfjs type hoá
      // `canvasContext` là `CanvasRenderingContext2D` (DOM chuẩn) -- `SKRSContext2D` của
      // `@napi-rs/canvas` đủ tương thích API-shape để pdfjs vẽ được, chỉ thiếu vài method chỉ
      // dành cho DOM (vd `drawFocusIfNeeded`, không liên quan tới vẽ headless) nên cần ép
      // kiểu qua `unknown` (không dùng `any`).
      await page.render({
        canvasContext: canvasAndContext.context as unknown as CanvasRenderingContext2D,
        viewport: renderViewport,
      }).promise;

      const jpegBuffer = encodeJpegToBudget(canvasAndContext.canvas, perPageBudgetBytes);
      canvasFactory.destroy(canvasAndContext);

      const embedded = await outDoc.embedJpg(jpegBuffer);
      const pdfPage = outDoc.addPage([pointsViewport.width, pointsViewport.height]);
      pdfPage.drawImage(embedded, { x: 0, y: 0, width: pointsViewport.width, height: pointsViewport.height });
    }

    const bytes = await outDoc.save();
    lastAttemptBytes = bytes;
    lastAttemptDpi = dpi;
    if (bytes.length <= TARGET_BYTES) {
      return { bytes, pageCount, hitFloor: false, finalDpi: dpi };
    }
  }

  return { bytes: lastAttemptBytes as Uint8Array, pageCount, hitFloor: true, finalDpi: lastAttemptDpi };
}

/** Binary-search JPEG quality (không render lại -- chỉ encode lại canvas đã có sẵn, rẻ) để
 * vừa `budgetBytes`. Trả về buffer LỚN NHẤT tìm được mà vẫn <= budget; nếu ngay cả
 * MIN_JPEG_QUALITY cũng vượt budget, chấp nhận trả về mức đó (không cố hạ thấp hơn nữa --
 * dưới sàn này ảnh bắt đầu vỡ khối rõ rệt, không còn đáng đánh đổi). */
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
