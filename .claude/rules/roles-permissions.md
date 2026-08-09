# Phân quyền tài khoản (Roles)

5 vai trò, mỗi vai trò có phạm vi xem/sửa riêng:

| Role | Mô tả | Quyền gợi ý |
|---|---|---|
| **Quản lý (Admin/Manager)** | Toàn quyền | Xem/sửa/xóa tất cả, quản lý user, cấu hình cột, phân quyền, xem báo cáo tổng |
| **Kế toán (Accounting)** | Quản lý tài chính | Sửa cột Money, Status thanh toán; xem toàn bộ hồ sơ; không xóa hồ sơ |
| **Agent** | Người tạo/chăm sóc khách hàng | Tạo hồ sơ mới, sửa thông tin Client Name/Phone/Zipcode/Description; xem hồ sơ mình phụ trách |
| **Processor** | Xử lý hồ sơ | Sửa Status, Case, Description; xem hồ sơ được giao |
| **Support** | Hỗ trợ khách hàng | Sửa Emailed, Description; xem hồ sơ liên quan |

- Định nghĩa quyền nên lưu dạng ma trận (role × cột × hành động: view/edit) để Quản lý cấu hình linh hoạt, không hard-code.
- Mỗi user thuộc đúng 1 role (hoặc nhiều, tùy quyết định khi triển khai), Quản lý tạo/sửa/khóa tài khoản.
