import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Đổi font toàn app (2026-08-24, theo yêu cầu làm mới UI giống mẫu @backgroundnew.jpg) — từ
// Inter sang Plus Jakarta Sans: cùng họ geometric sans hiện đại nhưng bo tròn/đậm nét hơn ở
// heading, đúng phong cách dashboard SaaS trong ảnh mẫu ("Make Things Simple!"). Vẫn giữ tên
// biến CSS `--font-inter` (không đổi thành --font-jakarta) để KHÔNG phải sửa lại globals.css
// (`--font-sans: var(--font-inter)`) và mọi chỗ khác đang tham chiếu — chỉ đổi NGUỒN font gán
// vào đúng biến đó.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
});

export const metadata: Metadata = {
  title: "Direct Funder — Case Management",
  description: "Quản lý công việc và hồ sơ khách hàng, kiểu Excel, phân quyền theo vai trò.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-text">{children}</body>
    </html>
  );
}
