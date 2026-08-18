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

interface RenderPassResult {
  bytes: Uint8Array;
  /** true nếu dừng render giữa chừng vì đã chắc chắn vượt TARGET_BYTES (còn trang chưa xử lý
   * -- `bytes` khi đó KHÔNG đầy đủ toàn bộ tài liệu, chỉ dùng để biết mức DPI này hỏng, không
   * phải kết quả cuối cùng). */
  bailedEarly: boolean;
}

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
 * 2 tối ưu tốc độ (thêm 2026-08-18 sau khi gặp timeout thật trên production với file 10-50
 * trang trên gói Vercel Hobby, giới hạn cứng 60s/lần xử lý):
 * 1. Chọn mức DPI BẮT ĐẦU dựa trên dung lượng trung bình/trang của file GỐC -- file scan độ
 *    phân giải cao/ảnh nặng gần như chắc chắn không vừa ngân sách ở DPI cao, bỏ qua thẳng các
 *    mức đó thay vì tốn 1 lượt render đầy đủ (chậm nhất) rồi mới biết hỏng.
 * 2. DỪNG SỚM giữa chừng 1 lượt DPI ngay khi tổng byte JPEG đã vượt ngân sách (còn trang chưa
 *    xử lý) -- không lãng phí thời gian hoàn thành 1 lượt chắc chắn thất bại.
 *
 * Nếu hết mọi mức DPI mà vẫn > 1MB (file quá nhiều trang) -- KHÔNG lỗi cứng, trả về kết quả
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

  const avgSourceBytesPerPage = data.length / pageCount;
  const startIndex = avgSourceBytesPerPage > 3_000_000 ? 2 : avgSourceBytesPerPage > 1_000_000 ? 1 : 0;
  const dpiSteps = DPI_STEPS.slice(startIndex);

  let lastAttempt: RenderPassResult | null = null;
  let lastAttemptDpi = dpiSteps[0];

  for (const dpi of dpiSteps) {
    const attempt = await renderPass(doc, canvasFactory, dpi, pageCount, perPageBudgetBytes);
    lastAttempt = attempt;
    lastAttemptDpi = dpi;
    if (!attempt.bailedEarly && attempt.bytes.length <= TARGET_BYTES) {
      return { bytes: attempt.bytes, pageCount, hitFloor: false, finalDpi: dpi };
    }
  }

  // Mọi mức DPI đã thử đều bail sớm (kể cả mức thấp nhất `dpiSteps` luôn bao gồm 72, sàn cuối
  // của DPI_STEPS) -- render lại đúng 1 lần ở DPI sàn KHÔNG cho bail sớm, để luôn có 1 kết quả
  // đầy đủ trả về (dù vẫn vượt 1MB) thay vì 1 bản dở dang.
  if (!lastAttempt || lastAttempt.bailedEarly) {
    const floorDpi = DPI_STEPS[DPI_STEPS.length - 1];
    const attempt = await renderPass(doc, canvasFactory, floorDpi, pageCount, perPageBudgetBytes, { allowBail: false });
    lastAttempt = attempt;
    lastAttemptDpi = floorDpi;
  }

  return { bytes: lastAttempt.bytes, pageCount, hitFloor: true, finalDpi: lastAttemptDpi };
}

/** Render TOÀN BỘ trang ở 1 mức DPI, đóng gói thành 1 PDF -- dừng sớm (`bailedEarly: true`,
 * xem RenderPassResult) nếu `allowBail` (mặc định true) và tổng byte JPEG đã vượt
 * `TARGET_BYTES` trong khi còn trang chưa xử lý. */
async function renderPass(
  doc: pdfjsLib.PDFDocumentProxy,
  canvasFactory: NapiCanvasFactory,
  dpi: number,
  pageCount: number,
  perPageBudgetBytes: number,
  options: { allowBail?: boolean } = {}
): Promise<RenderPassResult> {
  const allowBail = options.allowBail ?? true;
  const outDoc = await PDFDocument.create();
  let runningBytes = 0;

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    // Kích thước THẬT của trang PDF gốc (đơn vị point, 1/72 inch) -- dùng để tạo trang output
    // đúng tỷ lệ, KHÔNG phải kích thước pixel đã render ở DPI cao hơn.
    const pointsViewport = page.getViewport({ scale: 1 });
    const renderViewport = page.getViewport({ scale: dpi / 72 });
    const width = Math.max(1, Math.ceil(renderViewport.width));
    const height = Math.max(1, Math.ceil(renderViewport.height));
    const canvasAndContext = canvasFactory.create(width, height);

    // `canvasFactory` KHÔNG cần truyền lại ở đây -- `canvasContext` đã là context THẬT tự tạo
    // qua factory ở dòng trên, render() dùng thẳng context đó (không cần tự tạo canvas nội bộ
    // qua factory nữa, khác `getDocument({canvasFactory})` ở caller). pdfjs type hoá
    // `canvasContext` là `CanvasRenderingContext2D` (DOM chuẩn) -- `SKRSContext2D` của
    // `@napi-rs/canvas` đủ tương thích API-shape để pdfjs vẽ được, chỉ thiếu vài method chỉ
    // dành cho DOM (vd `drawFocusIfNeeded`, không liên quan tới vẽ headless) nên cần ép kiểu
    // qua `unknown` (không dùng `any`).
    await page.render({
      canvasContext: canvasAndContext.context as unknown as CanvasRenderingContext2D,
      viewport: renderViewport,
    }).promise;

    const jpegBuffer = encodeJpegToBudget(canvasAndContext.canvas, perPageBudgetBytes);
    canvasFactory.destroy(canvasAndContext);

    const embedded = await outDoc.embedJpg(jpegBuffer);
    const pdfPage = outDoc.addPage([pointsViewport.width, pointsViewport.height]);
    pdfPage.drawImage(embedded, { x: 0, y: 0, width: pointsViewport.width, height: pointsViewport.height });

    runningBytes += jpegBuffer.length;
    if (allowBail && runningBytes > TARGET_BYTES && i < pageCount) {
      return { bytes: await outDoc.save(), bailedEarly: true };
    }
  }

  return { bytes: await outDoc.save(), bailedEarly: false };
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
