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
- Chưa có script export dữ liệu localStorage cũ (mục 3) — không cấp thiết vì dữ liệu hiện tại chỉ là seed demo, chưa có người dùng thật nào dùng bản local-only trước đó.

**Cập nhật 2026-08-10 — production ĐÃ deploy thật**: Vercel (`funder-crm-mini.vercel.app`) + Neon, remote GitHub đã có (`origin`). Dòng "chưa deploy production thật" ở các mục dưới đây đã lỗi thời — chỉ còn đúng ở lịch sử, không áp dụng nữa. Xem mục 4.8 (mới) cho một class lỗi quan trọng vừa phát hiện + đã vá liên quan tới việc này.

### 4.8 Gotcha quan trọng: bảng `AppConfig` (columns/featurePermissions) KHÔNG có cơ chế migrate

Khác với `columns`/`featurePermissions` ở Zustand persist (có `migrate()` ladder chạy tự động mỗi lần load), bảng **`AppConfig` trên server KHÔNG có bất kỳ cơ chế đồng bộ tự động nào** khi `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS` trong `src/lib/rbac.ts` thay đổi — DB chỉ nhận giá trị này **đúng 1 lần lúc `prisma db seed` chạy**, sau đó hoàn toàn độc lập với code.

**Hậu quả thực tế đã xảy ra** (phát hiện 2026-08-10): production được seed từ rất lâu, sau đó `rbac.ts` được sửa nhiều lần (thêm quyền `processor`/`agent_leader`/`processor_leader` vào các cột SSN/Phone/Zip/Order, tách cột `orderStatus` thành `orderStatusOrder8821`/`orderStatusOrderTtsWit`, đổi `caseNumber` thành ẩn + thêm `caseLabel`...) nhưng **AppConfig trên production không hề được cập nhật theo** → Processor không sửa được SSN/Phone/Zip, cột Order không dùng được, cột Case không nhận giá trị mới, cột Status (vốn chỉ dành cho tab Order) bị lộ ra bảng Hồ sơ chính — dù code đã deploy đúng, đã pass mọi test ở local.

**Cách vá đã dùng** (không mất dữ liệu, không đụng bảng `User`/`Case`): script merge CỘNG DỒN — với mỗi cột trong `DEFAULT_COLUMNS`, hợp nhất (union) `editableBy` giữa bản production hiện có và bản default (giữ mọi quyền production đang có + thêm quyền mới thiếu), giữ `options` của production nếu có (đề phòng đã tuỳ biến màu/tên qua UI), thêm cột nào production thiếu hẳn (`caseLabel`), tách `orderStatus` cũ thành 2 cột mới nếu production còn ở dạng cũ. Tương tự với `featurePermissions` — union từng danh sách role theo từng feature.

**Quy tắc rút ra — LUÔN LÀM khi sửa `DEFAULT_COLUMNS` hoặc `DEFAULT_FEATURE_PERMISSIONS` trong `rbac.ts` VÀ production đã có dữ liệu thật**: sau khi deploy code, phải chạy thêm 1 script merge cộng dồn tương tự nhắm vào `DATABASE_URL` production để đồng bộ `AppConfig` — **không được** `prisma.appConfig.update()` ghi đè thẳng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS` vào production (sẽ xoá mất mọi tuỳ biến admin đã làm qua UI, vd. đổi tên cột, thêm option mới, đổi màu badge). Luôn dry-run (in ra kết quả merge, không ghi) trước khi ghi thật.

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

## 6. Checklist triển khai thực tế lên cloud (ĐÃ HOÀN THÀNH — giữ lại làm tham khảo quy trình)

Production đã live thật tại **`funder-crm-mini.vercel.app`** (Vercel, auto-deploy từ GitHub `origin/main`) + Neon Postgres, có dữ liệu người dùng thật (không phải seed demo nữa). Mục này giữ lại nguyên văn để tham khảo lại quy trình ban đầu đã dùng; các bước A/B bên dưới đã xong hết, không cần làm lại — trừ bước B.4 (mỗi lần schema đổi vẫn phải lặp lại) và mục 4.8 mới (đồng bộ AppConfig, dễ bị quên vì không có lỗi build/deploy nào báo hiệu, chỉ lộ ra khi người dùng thật gặp lỗi phân quyền).

**A. Việc đã làm (cần tài khoản cá nhân/thanh toán)**:
1. Repo GitHub `origin` đã có, Vercel đã import và tự deploy từ `main`.
2. Neon Postgres project đã tạo, connection string pooled đã cấu hình trong Vercel Environment Variables (`DATABASE_URL`, `AUTH_SECRET` riêng biệt với local).

**B. Quy trình lặp lại mỗi khi có tính năng mới đụng tới DB**:
1. Tạo migration file additive-first ở local (mục 4), test kỹ trên DB dev.
2. Commit + push code lên `main` (Vercel tự build/deploy).
3. **Trước hoặc ngay sau khi push**, chạy `prisma migrate deploy` nhắm vào `DATABASE_URL` production (Neon) để áp migration — xem cú pháp cụ thể ở mục 6.1 dưới.
4. **Nếu thay đổi đụng tới `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS` trong `rbac.ts`** (thêm cột, đổi `editableBy`, đổi feature permission mặc định...): còn phải chạy thêm 1 script merge cộng dồn nhắm vào `AppConfig` production — xem mục 4.8, đây là bước **rất dễ quên** vì không có gì báo lỗi ở bước build/deploy, chỉ lộ ra khi người dùng thật gặp lỗi phân quyền trên production.
5. Đăng nhập thử trên URL production, kiểm tra tính năng mới hoạt động đúng với ít nhất 1 tài khoản không phải Admin (Admin luôn full quyền nên không lộ được lỗi `editableBy`/`featurePermissions` thiếu).

### 6.1 Cách chạy `prisma migrate deploy` nhắm production

```bash
DATABASE_URL="<connection-string-pooled-tu-Neon>" npx prisma migrate deploy
```

Kiểm tra trước bằng `prisma migrate status` (cùng cú pháp, đổi `deploy` thành `status`) để xem có migration nào chưa áp dụng không. Không bao giờ dùng `prisma db push` hay các lệnh reset trên production.
