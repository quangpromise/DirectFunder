# Định hướng thiết kế (UI/UX)

Lấy cảm hứng từ [www.authkit.com_.png](../../www.authkit.com_.png): phong cách **Financial-Tech**, tối giản, hiện đại.

- **Theme**: Dark mode làm chủ đạo, nền gần đen (#0A0A0F – #0D0D14), có thể toggle light mode.
- **Accent color**: Gradient tím–xanh dương (purple → blue/indigo), dùng cho nút chính, active state, biểu đồ.
- **Glassmorphism**: Card/panel dùng nền mờ (backdrop-blur), viền mảnh sáng nhẹ (border 1px, opacity thấp), bo góc lớn (rounded-2xl).
- **Typography**: Sans-serif hiện đại (Inter/Geist), heading đậm, kích thước lớn, letter-spacing gọn.
- **Layout landing/login**: Card trung tâm nổi trên nền gradient tối có hiệu ứng ánh sáng (glow) mờ ảo phía sau — dùng cho trang đăng nhập.
- **Bảng dữ liệu**: dù nền tối nhưng phải rõ ràng, dễ đọc — hàng zebra nhẹ, hover highlight, border mảnh, không dùng màu chói làm nền cell.
- **Nút & badge trạng thái**: bo tròn, màu theo semantic (xanh lá = hoàn thành, vàng = đang xử lý, đỏ = từ chối/quá hạn, xanh dương = mới).
- Tham khảo thêm skill `dataviz` khi làm dashboard/báo cáo để đảm bảo hệ màu nhất quán sáng/tối.

> **Cập nhật (2026-08-09)**: tông màu thực tế trong code hiện là **xanh dương** lấy theo logo chính thức Direct Funder (`df-logo-1.png`, mẫu màu `#3888c8`) — `--accent`/`--accent-from`/`--accent-to` trong `src/app/globals.css` đã đổi từ cam sang xanh để đồng nhất toàn bộ giao diện (header bảng, nút chính, active state, trang Login) với logo. Mô tả "tím–xanh dương" ở mục Accent color phía trên đã lỗi thời, thay bằng gradient xanh dương nhạt → đậm (`#5cb0ee` → `#2569b0`).
