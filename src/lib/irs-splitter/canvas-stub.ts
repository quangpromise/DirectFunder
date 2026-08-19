// Stub cho package "canvas" (Node native, không cài trong repo này) -- pdfjs-dist (kể cả bản
// "build/pdf.js" dành cho trình duyệt, không chỉ "legacy/build/pdf.js") có 1 nhánh code nội bộ
// `NodeCanvasFactory._createCanvas()` gọi `require("canvas")`, CHỈ dùng khi thật sự RENDER
// bitmap (`page.render()`) -- tính năng "Tách thư" chỉ trích text (`getTextContent()`), không
// bao giờ chạm nhánh này. Turbopack vẫn cố resolve tĩnh "canvas" lúc bundle dù không bao giờ
// thật sự chạy -> alias qua stub này (xem `turbopack.resolveAlias` trong next.config.ts) để
// build không lỗi "Module not found: Can't resolve 'canvas'".
export {};
