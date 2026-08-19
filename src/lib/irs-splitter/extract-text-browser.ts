// Bản CHẠY TRÊN TRÌNH DUYỆT của extract-text.ts (đã xoá, chỉ dùng ở server) -- toàn bộ tính
// năng "Tách thư" (Notice Splitter) giờ xử lý HOÀN TOÀN trong trình duyệt người dùng, file PDF
// scan gốc (có thể chứa SSN) KHÔNG BAO GIỜ rời khỏi máy người dùng nữa (trước đây phải upload
// lên Vercel Blob + gửi qua server, xem lịch sử ở deployment-database-sync.md mục 4.31).
//
// `pdfjs-dist` (bản `build/pdf.js`, KHÁC bản `legacy/build/pdf.js` dùng ở server trước đây --
// bản "legacy" là bản tương thích Node/trình duyệt cũ, bản thường mới đúng là bản dành cho
// trình duyệt hiện đại) cần 1 Web Worker riêng để giải mã PDF không chặn UI thread -- dùng
// pattern `new URL(..., import.meta.url)` chuẩn của bundler (Next.js/Turbopack tự nhận diện,
// đóng gói file worker thành asset tĩnh có URL riêng) thay vì trỏ tới CDN ngoài.
//
// Lazy-import (chỉ tải pdfjs-dist + file worker ~1-1.5MB lúc THẬT SỰ cần, không cộng dồn vào
// bundle chính của Dashboard) -- gọi `getPdfjsLib()` bên trong hàm dùng, không import tĩnh ở
// đầu file.

let pdfjsLibPromise: ReturnType<typeof importPdfjs> | null = null;

async function importPdfjs() {
  const pdfjsLib = await import("pdfjs-dist/build/pdf");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.js",
    import.meta.url
  ).toString();
  return pdfjsLib;
}

function getPdfjsLib() {
  if (!pdfjsLibPromise) pdfjsLibPromise = importPdfjs();
  return pdfjsLibPromise;
}

/** Trích xuất text từng trang của 1 file PDF (dùng để nhận diện ranh giới các notice IRS
 * trong 1 file scan gộp nhiều thư — xem detect-records.ts). Chạy hoàn toàn trong trình duyệt. */
export async function extractPageTextsBrowser(pdfData: Uint8Array | ArrayBuffer): Promise<string[]> {
  const pdfjsLib = await getPdfjsLib();
  const data = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);
  const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return pages;
}
