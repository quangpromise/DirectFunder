# Direct Funder — Task & Case Management Platform

Phần mềm quản lý công việc/hồ sơ (case) dạng bảng kiểu Excel, kết hợp CRM (giao việc, thông báo) và phân quyền theo vai trò, cho các công ty tài chính/funding xử lý hồ sơ khách hàng qua nhiều bộ phận (Kế toán, Agent, Processor, Support, Quản lý).

## Chi tiết

Nội dung chi tiết được tách theo chủ đề trong `.claude/rules/` — đọc file tương ứng khi làm việc liên quan:

- [.claude/rules/product-overview.md](.claude/rules/product-overview.md) — tổng quan sản phẩm, đối tượng dùng.
- [.claude/rules/features.md](.claude/rules/features.md) — tính năng cốt lõi: quản lý case, bảng dữ liệu kiểu Excel, giao việc & thông báo.
- [.claude/rules/roles-permissions.md](.claude/rules/roles-permissions.md) — ma trận 5 vai trò và quyền xem/sửa.
- [.claude/rules/ui-design.md](.claude/rules/ui-design.md) — định hướng thiết kế UI/UX (theme, accent, glassmorphism...).
- [.claude/rules/architecture.md](.claude/rules/architecture.md) — đề xuất kiến trúc kỹ thuật (frontend/backend/DB/auth).
- [.claude/rules/workflow-conventions.md](.claude/rules/workflow-conventions.md) — quy ước làm việc trong repo.
- [.claude/rules/deployment-database-sync.md](.claude/rules/deployment-database-sync.md) — hiện trạng (chưa có backend/DB thật), kiến trúc deploy đề xuất, và quy trình đồng bộ local ↔ production không mất dữ liệu.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
