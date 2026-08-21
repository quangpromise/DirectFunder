# Direct Funder MCP server (chỉ đọc, chạy local)

MCP (Model Context Protocol) server cho phép Claude Desktop/Claude Code đọc trực tiếp dữ
liệu hồ sơ/tài khoản/rules từ app Direct Funder, thay vì phải mở web để tra cứu thủ công.

**Phạm vi hiện tại**: CHỈ ĐỌC (read-only) — không có tool nào tạo/sửa/xoá dữ liệu. Chạy
LOCAL trên máy bạn (stdio), KHÔNG deploy lên đâu cả, KHÔNG dùng API key riêng — tự đăng
nhập bằng đúng tài khoản Direct Funder thật của bạn rồi gọi lại các API route sẵn có, nên
dữ liệu trả về đã lọc đúng quyền (RBAC) của tài khoản đó, giống hệt khi bạn dùng qua web.

## 1. Chuẩn bị

1. App phải đang chạy (local: `npm run dev`, cổng 3000; hoặc trỏ tới production nếu muốn).
2. Có sẵn 1 tài khoản Direct Funder thật (email/username + password) để MCP server dùng
   đăng nhập.

## 2. Test nhanh (không qua Claude Desktop)

Thêm vào `.env.local`:

```
MCP_APP_BASE_URL="http://localhost:3000"
MCP_LOGIN_EMAIL="ten@directfunder.com"
MCP_LOGIN_PASSWORD="mat-khau-that"
```

Chạy:

```bash
npm run mcp
```

Thấy dòng `[mcp-server] Direct Funder MCP server đã sẵn sàng ...` ở stderr là đăng nhập
thành công. Nhấn Ctrl+C để dừng (server đợi input qua stdin theo giao thức MCP, không tự
làm gì nếu không có client thật kết nối).

## 3. Kết nối với Claude Desktop

Mở file cấu hình Claude Desktop:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Thêm vào mục `mcpServers` (tạo mới nếu chưa có file):

```json
{
  "mcpServers": {
    "direct-funder": {
      "command": "npx",
      "args": ["tsx", "D:\\Projects\\Direct Funder\\mcp-server\\index.ts"],
      "env": {
        "MCP_APP_BASE_URL": "http://localhost:3000",
        "MCP_LOGIN_EMAIL": "ten@directfunder.com",
        "MCP_LOGIN_PASSWORD": "mat-khau-that"
      }
    }
  }
}
```

Sửa đúng đường dẫn `mcp-server\index.ts` theo máy bạn (đường dẫn tuyệt đối, dùng `\\` trên
Windows). Lưu file, khởi động lại Claude Desktop — icon 🔌 ở góc dưới ô chat sẽ hiện
"direct-funder" nếu kết nối thành công.

Muốn dùng với **Claude Code** (CLI) thay vì Claude Desktop: chạy
`claude mcp add direct-funder -- npx tsx "D:\Projects\Direct Funder\mcp-server\index.ts"`
rồi set 3 biến môi trường tương tự qua `claude mcp` hoặc file `.mcp.json` của project.

## 4. Các tool hiện có

| Tool | Mô tả |
|---|---|
| `whoami` | Tài khoản đang dùng để gọi API (id, tên, email, role) |
| `list_cases` | Liệt kê hồ sơ (lọc `status`, tìm `search` theo tên/SSN/SĐT, giới hạn `limit`) |
| `get_case` | Chi tiết đầy đủ 1 hồ sơ theo `idOrSsn` |
| `list_users` | Danh sách tài khoản (lọc `role`) — tra tên Agent/Processor |
| `list_rules` | Bảng tin Rules nội bộ (`includeDeleted` để xem cả rule đã xoá) |

Dữ liệu trả về đã qua đúng RBAC của tài khoản đăng nhập (`canViewCase`...) — vd tài khoản
role Agent chỉ thấy đúng hồ sơ của mình, y hệt khi mở web.

## 5. Lưu ý bảo mật

- `.env.local` đã có sẵn trong `.gitignore` — KHÔNG commit mật khẩu thật vào git.
- Nếu trỏ `MCP_APP_BASE_URL` vào production, hãy dùng 1 tài khoản có quyền phù hợp (không
  nhất thiết phải là manager) — quyền đọc qua MCP giới hạn đúng bằng quyền tài khoản đó.
- Cookie session (7 ngày, giống đăng nhập web) chỉ tồn tại trong bộ nhớ tiến trình MCP
  server, không ghi ra đĩa.
