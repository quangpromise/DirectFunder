# Chiến lược Deploy & Đồng bộ Database

## 1. Hiện trạng (cập nhật 2026-08-09)

**Giai đoạn 1 (Users + Auth + Cases) đã triển khai đầy đủ và chạy được ở local, kể cả frontend đã nối vào API thật** (không còn chỉ là backend đứng riêng):

- Postgres chạy local qua Docker (`docker-compose.yml`, service `db`, port 5432).
- Prisma 7 (`prisma/schema.prisma`) — model `User`, `Case` (JSON nhúng cho `clients`/`orders`/`descriptionReplies`/`ssn`/`custom`), `AppConfig` (bảng singleton lưu `columns` + `featurePermissions`). Lưu ý Prisma 7 đổi cách cấu hình connection: không còn `url` trong `datasource` của `schema.prisma` nữa, chuyển qua `prisma.config.ts` (`datasource.url`) + driver adapter `@prisma/adapter-pg` truyền vào `PrismaClient` constructor (`src/lib/prisma.ts`).
- Migration đầu tiên đã chạy (`prisma/migrations/20260809033253_init`), seed script (`prisma/seed.ts`) nạp dữ liệu mẫu từ `src/lib/mock-data.ts` + `src/lib/rbac.ts` (1 user admin, 6 case demo, 1 dòng cấu hình cột/phân quyền), mật khẩu hash bằng bcrypt (`src/lib/password.ts`).
- Auth thật: session cookie JWT httpOnly (ký bằng `jose`, xác minh trong `src/lib/auth.ts` / `src/lib/api-auth.ts`) — **không dùng Auth.js/NextAuth như đề xuất ban đầu ở mục 2**, chọn JWT tự viết để giảm rủi ro tương thích với breaking changes của Next.js 16 (xem `.claude/rules/architecture.md` cho lý do; mục 2 vẫn giữ nguyên như đề xuất gốc, coi phần Auth ở đó là "đã lệch, tự viết JWT thay vì Auth.js").
- API routes (Next.js Route Handlers): `POST /api/auth/login|logout`, `GET /api/me`, `GET|POST /api/users`, `PATCH|DELETE /api/users/[id]`, `GET|POST /api/cases`, `PATCH|DELETE /api/cases/[id]`, `GET|PUT /api/config`. RBAC server-side dùng lại `hasFeature`/`canEditColumn`/`canViewCase` từ `src/lib/rbac.ts` — cùng 1 nguồn logic với frontend.
- **Frontend đã nối vào API thật** (`src/lib/api-client.ts` + `src/store/app-store.ts`): đăng nhập/đăng xuất, `hydrateFromServer()` nạp users/cases/columns/permissions từ DB mỗi khi vào dashboard, mọi thao tác sửa dữ liệu (sửa ô, thêm/xoá hồ sơ, order, SSN, tên khách, cột tuỳ chỉnh, tài khoản, đổi mật khẩu...) đều đồng bộ nền lên server qua `syncInBackground()`. Đã test end-to-end qua Playwright + curl, xác nhận dữ liệu còn nguyên sau khi reload trang (không chỉ nằm ở localStorage).

**Còn thiếu / chưa làm:**
- Orders/Notifications/Deletion/Edit history vẫn dùng field JSON nhúng trong `Case` hoặc còn ở Zustand-only, chưa tách bảng riêng.
- `reorderCase`/`reorderColumn` (thứ tự hiển thị) chưa đồng bộ lên server — DB chưa có field lưu thứ tự.
- **Chưa deploy production thật** — chưa có tài khoản Vercel/Neon, chưa có remote GitHub. Xem mục 6 (checklist hành động) để biết chính xác cần làm gì.
- Chưa có script export dữ liệu localStorage cũ (mục 3) — không cấp thiết vì dữ liệu hiện tại chỉ là seed demo, chưa có người dùng thật nào dùng bản local-only trước đó.

Mục 2–5 bên dưới là kiến trúc/quy trình đề xuất (phần lớn đã áp dụng đúng như mô tả, trừ Auth đã nêu ở trên). Mục 6 là checklist hành động cụ thể để đưa app này lên cloud thật.

## 2. Kiến trúc đề xuất

Tận dụng tối đa những gì đã có (Next.js) để giảm số hệ thống phải vận hành:

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| Hosting app | **Vercel** | Native cho Next.js, auto-deploy từ git push, preview deployment theo PR miễn phí |
| Database | **Neon** (Postgres quản lý) | Free tier tốt cho riêng Postgres, có DB branching (tách nhánh dev/preview khỏi prod — khớp đúng quy trình preview ở mục 4.7), point-in-time recovery. Supabase là phương án thay thế nếu sau này cần thêm Realtime/Storage tích hợp sẵn (Realtime đã liệt kê riêng ở dòng dưới) |
| ORM & Migration | **Prisma** | File migration versioned commit vào git — cùng tư duy với `version` + `migrate()` đang dùng cho Zustand persist hiện tại, dev đã quen pattern này |
| API | Next.js Route Handlers (`app/api/**`) | Không cần dựng service backend riêng, cùng 1 lần deploy với frontend |
| Auth | **Auth.js (NextAuth)** + hash mật khẩu bằng bcrypt | Thay cho việc so sánh password client-side hiện tại — đây là lỗ hổng bảo mật cần vá khi có DB thật |
| Realtime notification | Dịch vụ hosted (Pusher/Ably) hoặc Supabase Realtime | Vercel serverless không giữ được kết nối WebSocket dài hạn, nên không tự host Socket.io server |

## 3. Di trú dữ liệu hiện có (localStorage → DB thật)

Khi backend thật sẵn sàng, cần một đường di trú 1 lần để không mất dữ liệu người dùng đã tạo trong lúc dùng bản local-only:
1. Thêm chức năng "Xuất dữ liệu" (chỉ Admin) trong app hiện tại: dump toàn bộ state Zustand ra file JSON.
2. Viết script/API import chạy 1 lần, đọc JSON đó và seed vào DB thật (users, cases, columns, permissions...).
3. Xác minh số lượng bản ghi khớp trước khi cho phép tắt hẳn chế độ local-only.

## 4. Quy trình đồng bộ local ↔ production khi ra tính năng mới

Đây là phần trả lời trực tiếp câu hỏi "làm sao update tính năng mới mà không mất dữ liệu":

1. **Tách môi trường DB**: máy dev nối vào DB dev riêng (branch riêng trên Neon hoặc Postgres chạy local qua Docker) — không bao giờ code local trỏ thẳng vào DB production.
2. **Mọi thay đổi schema = 1 file migration Prisma mới** (`prisma migrate dev --name <ten>`), luôn theo nguyên tắc **additive-first**: thêm cột/bảng mới ở dạng nullable hoặc có default, backfill dữ liệu nếu cần, chỉ xoá cột/bảng cũ ở một release **sau đó** khi đã chắc chắn không còn dùng — giống hệt triết lý migration ladder `if (version < N)` đang dùng cho Zustand persist, chỉ khác là chạy trên DB thật thay vì localStorage.
3. **Migration file commit chung với code tính năng** trong cùng 1 PR — schema và code luôn đi cùng nhau, review cùng lúc, tránh lệch pha "code đã deploy nhưng DB chưa migrate".
4. **Pipeline deploy**: push lên `main` → Vercel build → chạy `prisma migrate deploy` lên DB production (áp các migration còn thiếu) → sau đó mới build/publish code mới. Tuyệt đối không dùng `prisma db push` hay các lệnh reset trên production.
5. **Biến môi trường tách biệt**: `.env.local` (gitignore, không commit) chứa `DATABASE_URL` trỏ DB dev; biến môi trường project trên Vercel Dashboard chứa `DATABASE_URL` production + các secret khác — không bao giờ để credential thật lọt vào git.
6. **Bật backup tự động / point-in-time recovery** của Neon, và kiểm tra backup gần nhất còn dùng được **trước khi** chạy bất kỳ migration nào lên production — để có đường lùi nếu migration có vấn đề.
7. **Preview deployment theo PR** (Vercel tự tạo) nên trỏ vào một DB branch nháp (branch ra từ *schema* production, không phải *data* production) để test tính năng mới không đụng vào dữ liệu thật.

## 5. Checklist an toàn dữ liệu khi đổi schema

Áp dụng cho cả Zustand persist hiện tại lẫn DB thật sau này:
- [ ] Thay đổi có phải additive không (thêm cột/bảng, không xoá/đổi kiểu cột đang có dữ liệu)?
- [ ] Nếu bắt buộc phải xoá/đổi kiểu cột cũ: đã có bước backfill/migrate dữ liệu cũ sang định dạng mới chưa, và đã tách thành 2 release (thêm mới → xoá cũ) chưa?
- [ ] Đã test migration trên DB dev/staging với dữ liệu gần giống thật trước khi chạy lên production chưa?
- [ ] Đã có backup mới nhất trước khi migrate production chưa?
- [ ] Migration file đã commit vào git cùng code tính năng liên quan chưa?

## 6. Checklist triển khai thực tế lên cloud

Repo đã chuẩn bị sẵn cho deploy: `.env.example` (danh sách biến môi trường cần thiết, không chứa giá trị thật), `package.json` có `postinstall: "prisma generate"` (tự generate Prisma Client trên máy CI/Vercel sạch — đã test bằng cách xoá `node_modules/@prisma/client` rồi `npm install` lại, chạy đúng). Phần còn lại cần tài khoản cá nhân nên tách rõ 2 nhóm việc:

**A. Việc bạn cần tự làm** (cần tài khoản cá nhân/thanh toán, không làm thay được):
1. Tạo repo trống trên GitHub, rồi báo tôi URL — tôi sẽ chạy `git remote add origin ...` + `git push` giúp (repo hiện **chưa có remote nào**).
2. Tạo tài khoản tại [neon.tech](https://neon.tech) (đã chốt dùng Neon — xem lý do ở mục 2) → tạo 1 project Postgres mới → copy connection string dạng **pooled connection** (phù hợp môi trường serverless của Vercel).
3. Tạo tài khoản tại [vercel.com](https://vercel.com) → "Add New Project" → import repo GitHub ở bước 1.
4. Trong Vercel → Project Settings → Environment Variables, thêm cho môi trường Production:
   - `DATABASE_URL` = connection string lấy từ Neon (bước 2).
   - `AUTH_SECRET` = một chuỗi ngẫu nhiên **mới**, khác secret đang dùng ở `.env.local` (không tái dùng secret local cho production).
5. Đưa tôi connection string đó (hoặc tự chạy lệnh tôi hướng dẫn) để chạy migration lần đầu — DB Neon mới tạo đang rỗng, chưa có bảng nào, cần `prisma migrate deploy` trước khi app production dùng được.

**B. Việc tôi sẽ làm** (khi có đủ thông tin ở mục A):
1. `prisma migrate deploy` nhắm vào `DATABASE_URL` production — tạo bảng theo đúng các migration đã có trong `prisma/migrations/`.
2. Chạy `prisma db seed` (tuỳ chọn) để có sẵn 1 tài khoản Admin đăng nhập lần đầu — app hiện chưa có màn hình "đăng ký tài khoản", nên production cần ít nhất 1 tài khoản Admin có sẵn.
3. Sau khi Vercel deploy xong: mở URL production, đăng nhập thử, kiểm tra dữ liệu hiển thị đúng từ DB cloud (không phải seed cũ hay cache).
4. Từ lần sau: mỗi tính năng mới đụng schema → tạo migration file additive-first (mục 4) → **trước khi push code lên `main`**, chạy `prisma migrate deploy` nhắm vào production để áp migration trước khi code mới lên live.
