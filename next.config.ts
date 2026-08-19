import type { NextConfig } from "next";

// Notice Splitter (lib/irs-splitter) giờ dùng pdfjs-dist HOÀN TOÀN ở client (trình duyệt xử
// lý, file PDF không tải lên server) -- không còn route server nào import pdfjs-dist nữa, nên
// không cần `serverExternalPackages` nữa (khác trước đây).
//
// Thay vào đó cần alias "canvas" -> stub rỗng cho bundle CLIENT: `pdfjs-dist/build/pdf.js`
// (bản trình duyệt, KHÔNG chỉ bản "legacy") vẫn có 1 nhánh nội bộ `require("canvas")`
// (NodeCanvasFactory, chỉ dùng khi RENDER bitmap -- tính năng này chỉ trích text, không bao
// giờ chạm nhánh đó) -- Turbopack vẫn cố resolve tĩnh package "canvas" (native, không cài) lúc
// build client bundle và lỗi cứng "Module not found: Can't resolve 'canvas'" dù nhánh đó
// không bao giờ thật sự chạy trong trình duyệt. Xem src/lib/irs-splitter/canvas-stub.ts.
const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      canvas: "./src/lib/irs-splitter/canvas-stub.ts",
    },
  },
};

export default nextConfig;
