# Tính năng cốt lõi

### 1. Quản lý công việc (Task/Case)
- Tạo, sửa, xóa công việc/hồ sơ.
- Tick hoàn thành (checkbox) → cập nhật `Status` tự động, có thể ẩn/lọc việc đã xong.
- Lịch sử thay đổi (audit log) cho mỗi hồ sơ: ai sửa, sửa gì, khi nào.

### 2. Bảng dữ liệu kiểu Excel
Cột mặc định:
| Cột | Kiểu dữ liệu | Ghi chú |
|---|---|---|
| Status | enum/select | New, In Progress, Emailed, Approved, Denied, Completed... (tùy chỉnh được) |
| Client Name | text | |
| Zipcode | text | validate 5 số (US) |
| Phone | text | format tự động |
| Description | textarea | |
| Case | text/number | mã hồ sơ, unique |
| Money | currency | định dạng $ |
| Emailed | boolean/date | tick hoặc lưu ngày gửi email |

Yêu cầu hành vi kiểu Excel:
- Thêm/xóa cột tùy ý (custom fields), kéo thả sắp xếp thứ tự cột.
- Thêm/xóa dòng nhanh (giống Excel: Enter để tạo dòng mới, Tab để qua cột kế).
- Inline edit trực tiếp trên ô (click để sửa, không cần mở form riêng).
- Sort, filter, search theo từng cột.
- Copy/paste dữ liệu dạng bảng (kể cả từ Excel/Google Sheets).
- Freeze cột đầu (Client Name) khi scroll ngang.
- **Phân quyền theo cột**: mỗi role chỉ được xem/sửa các cột được cấp phép (xem [[roles-permissions]]).

### 3. Giao việc & Thông báo (CRM-style)
- Assign một hồ sơ/công việc cho 1 hoặc nhiều tài khoản khác (theo role phù hợp).
- Người được giao nhận thông báo trong app (bell icon/notification center) + có thể mở rộng email/push sau.
- Trạng thái giao việc: Assigned, Accepted, In Progress, Done.
- Lịch sử giao việc lưu lại (ai giao, giao cho ai, khi nào, hồ sơ nào).
- Dashboard cá nhân: "Việc được giao cho tôi", "Việc tôi đã giao".
