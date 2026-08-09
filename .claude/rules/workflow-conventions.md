# Quy ước làm việc

- Ưu tiên inline edit và trải nghiệm gần giống Excel nhất có thể cho bảng chính.
- Mọi thay đổi quyền/cột phải qua Quản lý duyệt hoặc cấu hình, tránh hard-code phân quyền trong code từng chỗ — tập trung logic RBAC ở một lớp middleware/service.
- Khi thêm cột mới, đảm bảo cập nhật ma trận phân quyền tương ứng.
- **SSN là số duy nhất đại diện cho mỗi hồ sơ** (không phải mã hồ sơ/Case Code) — mọi thông báo (bell notification) và mọi bản ghi lịch sử chỉnh sửa/xóa (màn hình History) đều phải tham chiếu hồ sơ theo SSN, kèm theo tên Client, thay vì theo mã hồ sơ. Dùng `primarySsn()` (`src/lib/client-name.ts`, ưu tiên SSN dòng 1, dòng 2 nếu dòng 1 trống) để lấy SSN đại diện; xem `caseRefLabel()` trong `src/store/app-store.ts` cho cách ghép "Tên Client (SSN: ...)" dùng chung cho thông báo.
- **Mật khẩu mặc định của MỌI tài khoản trong DB dev (kể cả admin) là `12345678`** — khi test qua Playwright/tay, dùng thẳng mật khẩu này cho mọi tài khoản, KHÔNG cần tự reset mật khẩu qua script Prisma trước khi test nữa (khác quy trình cũ mỗi phiên phải tự đặt lại). Tài khoản mới do Admin tạo ở trang Quản lý tài khoản tự động điền sẵn mật khẩu này (vẫn sửa được nếu muốn); Admin cũng có thể đặt lại mật khẩu bất kỳ tài khoản nào khác về giá trị này (hoặc giá trị khác) qua nút "Đặt lại mật khẩu" trên từng thẻ tài khoản, không cần biết mật khẩu cũ (xem `resetUserPassword` trong `src/store/app-store.ts` + nhánh `adminNewPassword` trong `PATCH /api/users/[id]`). Mỗi tài khoản vẫn tự đổi mật khẩu của chính mình qua `ChangePasswordDialog` (cần nhập đúng mật khẩu hiện tại).

> Xem thêm [[deployment-database-sync]] cho quy tắc an toàn dữ liệu khi thay đổi schema (Zustand persist hiện tại và database thật khi triển khai).
