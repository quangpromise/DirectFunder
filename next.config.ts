import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist (dùng trong lib/irs-splitter để đọc text PDF, xem tab "Notice Splitter")
  // có 1 nhánh code `require("canvas")` dùng cho vẽ bitmap (KHÔNG dùng tới khi chỉ trích
  // text bằng getTextContent()) -- nếu để Turbopack/webpack bundle package này, nó cố
  // resolve tĩnh "canvas" (dependency native/optional, không cài) và build lỗi cứng dù
  // nhánh đó không bao giờ thật sự chạy. Đánh dấu external để Node tự require() thẳng lúc
  // chạy (bỏ qua bundling) -- cách khắc phục chuẩn theo tài liệu pdfjs-dist cho bundler.
  // `@napi-rs/canvas` (tính năng "Nén PDF", con của tab Notice Splitter -- render trang PDF
  // thành bitmap rồi tự encode JPEG bằng chính API của package này, không cần thêm sharp) có
  // binary native (.node) dựng sẵn theo từng platform -- cùng lý do trên, KHÔNG để bundler cố
  // đóng gói tĩnh, để Node tự require() đúng binary khớp platform lúc chạy.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
