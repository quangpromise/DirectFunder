import type { NextConfig } from "next";

// Notice Splitter (lib/irs-splitter) dùng pdfjs-dist Ở CLIENT (trình duyệt xử lý, file PDF
// không tải lên server) -- cần alias "canvas" -> stub rỗng cho bundle CLIENT:
// `pdfjs-dist/build/pdf.js` (bản trình duyệt, KHÔNG chỉ bản "legacy") vẫn có 1 nhánh nội bộ
// `require("canvas")` (NodeCanvasFactory, chỉ dùng khi RENDER bitmap -- tính năng này chỉ
// trích text, không bao giờ chạm nhánh đó) -- Turbopack vẫn cố resolve tĩnh package "canvas"
// (native, không cài) lúc build client bundle và lỗi cứng "Module not found: Can't resolve
// 'canvas'" dù nhánh đó không bao giờ thật sự chạy trong trình duyệt. Xem
// src/lib/irs-splitter/canvas-stub.ts.
//
// `serverExternalPackages: ["pdfjs-dist"]` (thêm lại 2026-08-25 cho tính năng "So sánh WIT vs
// TTS", xem .claude/skills/crm-tts-wit-compare/SKILL.md) -- route so sánh chạy pdfjs-dist Ở
// SERVER (cần cookie session CRM + giấu API key LLM, không thể client-side như Notice
// Splitter) -- đánh dấu package này KHÔNG bundle, Node tự require() thẳng lúc chạy, tránh đúng
// lỗi "canvas" ở trên nhưng theo hướng khác (server không cần alias, chỉ cần loại khỏi bundle).
const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  turbopack: {
    resolveAlias: {
      canvas: "./src/lib/irs-splitter/canvas-stub.ts",
    },
  },
};

export default nextConfig;
