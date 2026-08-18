// Bản "legacy" CJS (không phải build .mjs mặc định) -- bản DUY NHẤT chạy được trong Node
// route handler mà không cần polyfill DOM (canvas/fs) -- xem README của irs-notice-splitter
// gốc.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

/**
 * Trích xuất text từng trang của 1 file PDF (dùng để nhận diện ranh giới các notice IRS
 * trong 1 file scan gộp nhiều thư — xem detect-records.ts).
 */
export async function extractPageTexts(pdfData: Uint8Array | Buffer): Promise<string[]> {
  // pdfjs-dist từ chối Node Buffer dù nó là subclass của Uint8Array -- luôn ép về
  // Uint8Array thuần trước khi truyền vào.
  const data = new Uint8Array(pdfData);
  const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return pages;
}
