# Quy ước làm việc

- Ưu tiên inline edit và trải nghiệm gần giống Excel nhất có thể cho bảng chính.
- Mọi thay đổi quyền/cột phải qua Quản lý duyệt hoặc cấu hình, tránh hard-code phân quyền trong code từng chỗ — tập trung logic RBAC ở một lớp middleware/service.
- Khi thêm cột mới, đảm bảo cập nhật ma trận phân quyền tương ứng.

> Xem thêm [[deployment-database-sync]] cho quy tắc an toàn dữ liệu khi thay đổi schema (Zustand persist hiện tại và database thật khi triển khai).
