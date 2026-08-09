# Đề xuất kiến trúc kỹ thuật

> Đây là đề xuất khởi điểm khi bắt đầu dự án, sẽ điều chỉnh khi bắt đầu code tùy theo môi trường triển khai (hosting, ngân sách, đội ngũ). **Xem [[deployment-database-sync]] để biết hiện trạng thực tế và kế hoạch triển khai backend/DB cụ thể.**

- **Frontend**: React + TypeScript, TailwindCSS (dễ style theo glassmorphism), thư viện bảng dạng grid mạnh (vd. TanStack Table / AG Grid) để đạt hành vi giống Excel (inline edit, sort/filter, freeze column, paste từ clipboard).
- **Backend**: Node.js (NestJS/Express) hoặc tương đương, REST hoặc GraphQL API.
- **Database**: PostgreSQL — phù hợp cho dữ liệu quan hệ (users, roles, cases, assignments) + hỗ trợ cột động (JSONB cho custom fields).
- **Auth**: JWT + role-based access control (RBAC) middleware kiểm tra quyền theo cột/hành động.
- **Realtime notification**: WebSocket (Socket.io) hoặc Server-Sent Events cho thông báo giao việc tức thời.
- **File/Export**: hỗ trợ export bảng ra Excel (xlsx) và import từ Excel.
