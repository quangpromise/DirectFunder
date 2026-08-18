import { Canvas, createCanvas, SKRSContext2D } from "@napi-rs/canvas";

/** Canvas/context cặp đôi mà pdfjs-dist mong đợi từ 1 CanvasFactory tuỳ biến -- không phải
 * type chính thức của pdfjs (thư viện không export sẵn type cho phần mở rộng này), chỉ cần
 * đúng shape `{canvas, context}` mà `page.render()` dùng. `SKRSContext2D` (của
 * `@napi-rs/canvas`) tự kế thừa `CanvasRenderingContext2D` chuẩn nên đủ tương thích API-shape
 * để pdfjs vẽ được (fill/stroke/drawImage/transform/clip...) mà không cần ép kiểu `any`. */
export interface CanvasAndContext {
  canvas: Canvas;
  context: SKRSContext2D;
}

/**
 * Factory canvas tuỳ biến cho pdfjs-dist (bản "legacy" Node, xem `src/lib/irs-splitter/
 * extract-text.ts`) dựng trên `@napi-rs/canvas` -- binary dựng sẵn theo platform, KHÔNG cần
 * compile Cairo như package `canvas` gốc pdfjs mặc định dùng (`canvas` không được cài trong
 * repo này, xem next.config.ts). Truyền factory NÀY vào cả `getDocument({canvasFactory})`
 * lẫn `page.render({canvasFactory})` để pdfjs KHÔNG BAO GIỜ tự `require("canvas")` nội bộ
 * nữa -- nhánh đó bị factory này thay thế hoàn toàn.
 */
export class NapiCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}
