// pdfjs-dist không kèm sẵn file .d.ts cạnh "build/pdf.js" (bản dành cho trình duyệt hiện đại,
// khác "legacy/build/pdf.js" dùng ở server trước đây -- xem extract-text-browser.ts) --
// package chỉ publish type ở "types/src/pdf.d.ts" (entry chính) và ở
// "legacy/build/pdf.d.ts" (chỉ 1 dòng "export * from \"pdfjs-dist\";"). Khai báo lại y hệt
// cho subpath "build/pdf" để TypeScript resolve đúng type khi import động
// `import("pdfjs-dist/build/pdf")` -- KHÔNG ảnh hưởng gì tới việc bundler (Turbopack/webpack)
// resolve đúng file JS thật lúc build, chỉ phục vụ type-check.
declare module "pdfjs-dist/build/pdf" {
  export * from "pdfjs-dist";
}
