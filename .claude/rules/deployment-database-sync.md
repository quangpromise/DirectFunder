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
- `reorderColumn` (thứ tự cột) vẫn chỉ đổi cục bộ + lưu trong `AppConfig.columns` (không cần field riêng). `reorderCase` (thứ tự dòng, kéo-thả) đã đồng bộ server từ 2026-08-11 — xem `Case.sortOrder` (mục 4.13).
- Chưa có script export dữ liệu localStorage cũ (mục 3) — không cấp thiết vì dữ liệu hiện tại chỉ là seed demo, chưa có người dùng thật nào dùng bản local-only trước đó.

**Cập nhật 2026-08-10 — production ĐÃ deploy thật**: Vercel (`funder-crm-mini.vercel.app`) + Neon, remote GitHub đã có (`origin`). Dòng "chưa deploy production thật" ở các mục dưới đây đã lỗi thời — chỉ còn đúng ở lịch sử, không áp dụng nữa. Xem mục 4.8 (mới) cho một class lỗi quan trọng vừa phát hiện + đã vá liên quan tới việc này.

### 4.8 Gotcha quan trọng: bảng `AppConfig` (columns/featurePermissions) KHÔNG có cơ chế migrate

Khác với `columns`/`featurePermissions` ở Zustand persist (có `migrate()` ladder chạy tự động mỗi lần load), bảng **`AppConfig` trên server KHÔNG có bất kỳ cơ chế đồng bộ tự động nào** khi `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS` trong `src/lib/rbac.ts` thay đổi — DB chỉ nhận giá trị này **đúng 1 lần lúc `prisma db seed` chạy**, sau đó hoàn toàn độc lập với code.

**Hậu quả thực tế đã xảy ra** (phát hiện 2026-08-10): production được seed từ rất lâu, sau đó `rbac.ts` được sửa nhiều lần (thêm quyền `processor`/`agent_leader`/`processor_leader` vào các cột SSN/Phone/Zip/Order, tách cột `orderStatus` thành `orderStatusOrder8821`/`orderStatusOrderTtsWit`, đổi `caseNumber` thành ẩn + thêm `caseLabel`...) nhưng **AppConfig trên production không hề được cập nhật theo** → Processor không sửa được SSN/Phone/Zip, cột Order không dùng được, cột Case không nhận giá trị mới, cột Status (vốn chỉ dành cho tab Order) bị lộ ra bảng Hồ sơ chính — dù code đã deploy đúng, đã pass mọi test ở local.

**Cách vá đã dùng** (không mất dữ liệu, không đụng bảng `User`/`Case`): script merge CỘNG DỒN — với mỗi cột trong `DEFAULT_COLUMNS`, hợp nhất (union) `editableBy` giữa bản production hiện có và bản default (giữ mọi quyền production đang có + thêm quyền mới thiếu), giữ `options` của production nếu có (đề phòng đã tuỳ biến màu/tên qua UI), thêm cột nào production thiếu hẳn (`caseLabel`), tách `orderStatus` cũ thành 2 cột mới nếu production còn ở dạng cũ. Tương tự với `featurePermissions` — union từng danh sách role theo từng feature.

**Quy tắc rút ra — LUÔN LÀM khi sửa `DEFAULT_COLUMNS` hoặc `DEFAULT_FEATURE_PERMISSIONS` trong `rbac.ts` VÀ production đã có dữ liệu thật**: sau khi deploy code, phải chạy thêm 1 script merge cộng dồn tương tự nhắm vào `DATABASE_URL` production để đồng bộ `AppConfig` — **không được** `prisma.appConfig.update()` ghi đè thẳng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS` vào production (sẽ xoá mất mọi tuỳ biến admin đã làm qua UI, vd. đổi tên cột, thêm option mới, đổi màu badge). Luôn dry-run (in ra kết quả merge, không ghi) trước khi ghi thật.

### 4.9 [CHỜ XỬ LÝ] Đồng bộ production cho tính năng "Send mail to CPA" (thêm 2026-08-10)

Tính năng mới thêm `cpaEmailDefaults` (cột Json nullable, additive) + feature key `sendCpaEmail` vào `DEFAULT_FEATURE_PERMISSIONS` — đúng loại thay đổi mô tả ở mục 4.8, nên **sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (thêm cột `cpaEmailDefaults`, an toàn/additive).
2. Chạy script merge cộng dồn thêm `sendCpaEmail: ["manager","processor"]` vào `AppConfig.featurePermissions` production nếu key đó chưa có (nếu bỏ qua, processor trên production sẽ không thấy nút dù code đúng — xem cơ chế lỗi ở mục 4.8).
3. Thêm `GMAIL_USER`/`GMAIL_APP_PASSWORD` vào Vercel Environment Variables (Production) — thiếu sẽ gây lỗi "Thiếu GMAIL_USER/GMAIL_APP_PASSWORD" khi bấm gửi.
4. Đăng nhập bằng tài khoản **processor** thật trên production để verify nút hiện đúng (Admin luôn full quyền nên không lộ được lỗi featurePermissions thiếu).
5. Vào trang Phân quyền (Admin), mở dialog "Cấu hình email CPA mặc định", nhập To/Cc thật lần đầu (mặc định rỗng sau migration).

### 4.10 [CHỜ XỬ LÝ] Đồng bộ production cho tính năng "Send" đẩy dòng lên Google Sheet (thêm 2026-08-10)

Tính năng mới thêm `User.googleRefreshToken` + `AppConfig.googleSheetConfig` (additive) + feature key `sendToGoogleSheet` vào `DEFAULT_FEATURE_PERMISSIONS` — đúng loại thay đổi mô tả ở mục 4.8, nên **sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (thêm 2 cột trên, an toàn/additive).
2. Chạy script merge cộng dồn thêm `sendToGoogleSheet: ["processor"]` vào `AppConfig.featurePermissions` production nếu key đó chưa có.
3. Tạo OAuth Client trên Google Cloud Console (nếu chưa có từ bước dev), đăng ký thêm redirect URI production `https://<production-domain>/api/auth/google/callback`, thêm các Processor/Manager thật làm Test user trong OAuth consent screen.
4. Thêm `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` vào Vercel Environment Variables (Production).
5. Share quyền Editor Google Sheet "2026 RA-EC Client list" cho từng tài khoản Google của Processor/Manager sẽ dùng tính năng này (OAuth2 theo từng user, không phải 1 service account chung).
6. Đăng nhập bằng tài khoản **processor** thật trên production, thử bấm nút Send ở 1 hồ sơ đang "Kế toán duyệt" → xác nhận popup OAuth mở đúng, kết nối xong tự gửi tiếp.
7. Vào trang Phân quyền (Admin), mở dialog "Cấu hình Google Sheet", nhập Sheet ID + chọn cột thật lần đầu (mặc định rỗng sau migration).

### 4.11 [CHỜ XỬ LÝ] Đồng bộ production cho tính năng "Edit Hồ sơ" (First/Last Name, SSN, DOB, Phone 1/2, Zipcode, Address, Email, Refund) (thêm 2026-08-10)

Thêm `Case.phone2`/`Case.email`/`Case.dateOfBirth`/`Case.refunds` (additive) + 4 cột ẩn mới (`dateOfBirth`/`phone2`/`email`/`refunds`, `hidden: true`) vào `DEFAULT_COLUMNS`, đồng thời **đổi `editableBy` của 2 cột có sẵn `money`/`caseLabel` (Case) thành rỗng `[]`** (khoá sửa trực tiếp ngoài bảng — giờ chỉ sửa được qua popup "Edit Hồ sơ", `money` tự tính = tổng `refunds`, `caseLabel` tự tính = số năm refund > 0). Đây là 2 loại thay đổi khác nhau cùng lúc, **cả 2 đều RẤT DỄ bị bỏ sót triệu chứng giống mô tả ở mục 4.8**:
- Nếu quên đồng bộ AppConfig.columns production: 4 field mới (dateOfBirth/phone2/email/refunds) sẽ luôn hiện **disabled/khoá** trong popup Edit Hồ sơ ở MỌI role kể cả Manager (vì `canEditColumn` không tìm thấy cột trong config production nên coi như không ai có quyền) — đã tự gặp đúng lỗi này ở local lúc test, xem cách vá bên dưới.
- Nếu quên đổi `editableBy` của `money`/`caseLabel` thành `[]` trên production: 2 cột này ở production vẫn cho sửa tay trực tiếp ngoài bảng như cũ (không lỗi gì hiện ra, chỉ là tính năng khoá không có hiệu lực, user vẫn sửa tay được, dữ liệu dễ lệch với tổng refunds thật).

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (4 cột mới trên `Case`, an toàn/additive).
2. Chạy script merge cộng dồn nhắm `AppConfig.columns` production: thêm 4 cột `dateOfBirth`/`phone2`/`email`/`refunds` (copy nguyên `DEFAULT_COLUMNS` tương ứng trong `rbac.ts`) NẾU production chưa có id đó; đồng thời tìm cột `money`/`caseLabel` production hiện có, set `editableBy: []` (ghi đè đúng 2 field này, KHÔNG đụng `label`/`options`/các field khác nếu Admin đã tuỳ biến).
3. Đăng nhập bằng tài khoản **không phải Manager** (vd Processor) thật trên production, bấm nút bút chì "Edit Hồ sơ" ở 1 hồ sơ bất kỳ → xác nhận 4 field mới (Date of Birth, Phone 2, Email, Refund) hiện **enable được** (không bị khoá xám) đúng theo `editableBy` đã cấu hình — nếu vẫn khoá dù đã chạy bước 2, kiểm tra lại script merge có đúng target `AppConfig.id: "singleton"` production không.
4. Thử sửa + Lưu 1 hồ sơ test → xác nhận cột "Case"/"Money" trên bảng chính production cập nhật đúng và **không còn bấm sửa tay trực tiếp được** (click vào ô không hiện input).

### 4.12 [CHỜ XỬ LÝ] Đồng bộ production cho tính năng "Gửi email cho khách hàng" — SMTP webmail công ty, per-user (viết lại 2026-08-15, thay hẳn thiết kế Microsoft 365/Outlook OAuth2 ban đầu)

**Lịch sử quyết định (đọc trước khi làm gì với mục này)**: bản đầu tiên (2026-08-11) dùng Microsoft Graph OAuth2 (`User.microsoftRefreshToken`, App registration Azure AD) — không triển khai được vì không ai trong team có quyền admin Azure AD của tenant `directfunder.com` để tạo App registration, và tự đăng ký app dưới tài khoản Microsoft cá nhân (multitenant) cũng thất bại với lỗi `InteractionRequired` do máy đang SSO sẵn tài khoản công ty ở tầng Windows (Primary Refresh Token) — không có đường nào tiếp tục được với OAuth. Xác nhận công ty thực ra dùng webmail thường (cPanel-style) tại `mail.directfunder.com` (SMTP port 465, SSL), không phải Microsoft 365 — toàn bộ tính năng được viết lại dùng SMTP thuần qua `nodemailer`, mỗi user tự kết nối **mailbox webmail riêng của họ** (giữ đúng ý định ban đầu "gửi bằng đúng email của từng nhân viên") bằng cách nhập email + mật khẩu webmail 1 lần qua dialog trong app, thay cho popup OAuth. Xem chi tiết kiến trúc ở `.claude/skills/send-client-email/SKILL.md` (Pattern B).

Migration `20260815193221_webmail_smtp_client_email` (local) xoá `User.microsoftRefreshToken`, thêm `User.webmailUsername` + `User.webmailPasswordEncrypted` (mật khẩu mã hóa AES-256-GCM, xem `src/lib/webmail-crypto.ts` — **KHÔNG** lưu plain text như 2 refresh token OAuth khác vì đây là secret thật không thu hồi được từ xa). `AppConfig.clientEmailTemplate` + feature key `sendClientEmail` giữ nguyên không đổi từ bản trước.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-16** — `prisma migrate deploy` nhắm production đã chạy (xoá cột `microsoftRefreshToken`, thêm `webmailUsername`/`webmailPasswordEncrypted`).
2. ✅ **Đã xong 2026-08-16** — đã chạy script merge cộng dồn (dry-run rồi ghi thật), xác nhận `sendClientEmail: ["processor"]` đã có trong `AppConfig.featurePermissions` production.
3. [CHỜ VERCEL DASHBOARD — cần thao tác tay, Claude không có quyền truy cập Vercel] Sinh `WEBMAIL_CREDENTIAL_ENCRYPTION_KEY` mới bằng `openssl rand -base64 32`, thêm vào Vercel Environment Variables (Production) cùng `WEBMAIL_SMTP_HOST=mail.directfunder.com`/`WEBMAIL_SMTP_PORT=465` (2 biến sau có default trong code nên thực ra không bắt buộc, chỉ cần nếu muốn tường minh). **Không được đổi key này sau khi đã có user kết nối** — đổi key khiến mọi mật khẩu đã lưu không giải mã được nữa, phải yêu cầu toàn bộ user kết nối lại. Xoá 3 biến `MICROSOFT_*` cũ khỏi Vercel (không còn dùng).
4. Đăng nhập bằng tài khoản **processor** thật trên production, mở popup "Edit Hồ sơ" 1 hồ sơ đã có email khách hàng → bấm nút gửi mail cạnh field Email → xác nhận hiện dialog "Kết nối hộp mail công ty" → nhập đúng email + mật khẩu webmail thật của họ → xác nhận kết nối thành công và tự gửi tiếp.
5. Thử nhập sai mật khẩu ở bước kết nối → xác nhận báo lỗi rõ ràng, không lưu credential sai.
6. Vào trang Phân quyền (Admin), mở dialog cấu hình mẫu email khách hàng, nhập Subject/Body thật lần đầu nếu chưa từng lưu (mặc định rỗng → dùng DEFAULT_CLIENT_EMAIL_SUBJECT/BODY trong code cho tới khi Admin lưu).
7. Gửi thử 1 email thật tới hộp thư test, xác nhận nội dung/placeholder render đúng và mail đến từ đúng địa chỉ webmail của người bấm gửi (không phải mailbox chung).
8. Đổi mật khẩu webmail thật của 1 tài khoản (ngoài app) → thử gửi mail bằng tài khoản đó trong app → xác nhận báo lỗi xác thực + tự yêu cầu kết nối lại (không lặp lỗi âm thầm mãi).

### 4.13 [CHỜ XỬ LÝ] Đồng bộ production cho "Case.sortOrder" (lưu thứ tự kéo-thả dòng) (thêm 2026-08-11)

Bug đã sửa: kéo-thả đổi vị trí dòng trên bảng Hồ sơ chỉ đổi thứ tự trong Zustand state cục bộ, không có field nào trên `Case` lưu lại — mỗi lần reload, `GET /api/cases` trả về theo `createdAt desc` như cũ nên dòng vừa kéo "nhảy về vị trí cũ". Đã thêm `Case.sortOrder` (Float, additive) + `reorderCase` giờ tính lại giá trị bằng fractional indexing (trung bình sortOrder 2 hàng xóm mới) và PATCH lên server; `GET /api/cases` đổi `orderBy` thành `[{ sortOrder: "asc" }, { createdAt: "desc" }]`; migration có kèm backfill SQL gán `sortOrder = -epoch(createdAt)*1000` cho dữ liệu cũ để giữ nguyên thứ tự hiển thị hiện có. **Khác các mục 4.9–4.12**: đây KHÔNG đụng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS` (không phải cột bảng/feature permission, là field nội bộ của `Case`) nên **không cần** script merge `AppConfig` — chỉ cần chạy migration.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production — migration `add_case_sort_order` gồm cả câu lệnh `ALTER TABLE` lẫn `UPDATE` backfill, chạy đúng thứ tự tự động, không cần thao tác gì thêm.
2. Đăng nhập production, kéo-thả thử 1 dòng bất kỳ trên bảng Hồ sơ → reload trang → xác nhận dòng giữ đúng vị trí mới (không nhảy về chỗ cũ).
3. Thử thêm 1 hồ sơ mới → xác nhận vẫn lên đầu bảng như hành vi cũ (client/server đều gán `sortOrder = -Date.now()` cho hồ sơ mới).

### 4.14 [CHỜ XỬ LÝ] Đồng bộ production cho nút mắt "Refund theo năm" cạnh cột Case (thêm 2026-08-11)

Tính năng mới: nút mắt (icon `Eye`) cạnh số trong cột "Case" — bấm mở popup xem/sửa trạng thái xử lý riêng cho từng năm có refund > 0 (Processing/Pending/CPA Review, mỗi trạng thái 1 màu badge riêng), hover mở popup tương tự nhưng chỉ xem. Mắt nhấp nháy đỏ nếu có ít nhất 1 năm đang Pending, xanh lá đứng yên nếu không. Năm đang Pending có thêm ô nhập lý do (textarea) — **khác `refundYearStatus`, ô lý do KHÔNG giới hạn theo role, mọi user đăng nhập đều sửa được** (field `refundYearPendingReason` không map qua `FIELD_TO_COLUMN_KEY` nên không bị chặn theo `editableBy`), người khác xem lại qua hover hoặc mở popup. Đã thêm `Case.refundYearStatus` + `Case.refundYearPendingReason` (2 field Json, additive, default `"{}"`) — **giống mục 4.13, KHÔNG đụng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`** nên **không cần** script merge `AppConfig`, chỉ cần chạy migration.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (thêm cột `refundYearStatus` + `refundYearPendingReason`, an toàn/additive, default `{}` áp dụng luôn cho dữ liệu cũ, không cần backfill).
2. Đăng nhập production bằng tài khoản có quyền sửa refunds (Processor/Agent/Manager...), mở popup mắt ở 1 hồ sơ có refund > 0, đổi thử 1 năm sang Pending → xác nhận mắt chuyển đỏ nhấp nháy + hiện ô nhập lý do, gõ thử 1 lý do, reload trang xác nhận trạng thái VÀ lý do còn nguyên.
3. Đăng nhập bằng tài khoản KHÔNG có quyền sửa refunds (nếu có) → xác nhận hover/click popup chỉ hiện badge tĩnh (không có dropdown để đổi trạng thái) nhưng VẪN gõ được vào ô lý do Pending (đúng thiết kế — ô lý do mở cho mọi user).

### 4.15 [CHỜ XỬ LÝ] Đồng bộ production cho tab "Rules" (bảng tin quy định nội bộ) (thêm 2026-08-11)

Tính năng mới: tab điều hướng "Rules" (đặt sau Orders) — thêm/sửa/xoá rule dạng bảng tin (quyền theo `manageRules`, xem mục 4.16). Rule mới lên đầu, badge "New" vàng tự hết khi qua ngày (so theo giờ Phoenix, xem `ruleIsNewToday` trong `src/lib/rules.ts`). Xoá là soft-delete (`Rule.deletedAt`/`deletedBy`) — rule vẫn hiển thị, bị đẩy xuống cuối + gạch ngang chữ, KHÔNG ẩn hẳn. Nút "Rules" ở top-nav còn hiện badge đếm "N Rule mới" ở MỌI màn hình khác (ẩn khi đang ở chính trang Rules). Thêm **bảng mới hoàn toàn** `Rule` (model mới, không phải field thêm vào `Case`/`AppConfig`) — **khác các mục 4.9–4.12, GIỐNG mục 4.13/4.14: KHÔNG đụng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`** nên **không cần** script merge `AppConfig`, chỉ cần chạy migration. **Lưu ý (2026-08-11): đoạn "hard-code role manager, không đi qua FeaturePermissions" ở bản đầu tiên tính năng này đã lỗi thời** — mục 4.16 thay quyền hard-code bằng feature key `manageRules` cấu hình được qua trang Phân quyền.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (tạo bảng `rules` mới, an toàn/additive — không đụng bảng nào có sẵn).
2. Đăng nhập production bằng tài khoản **manager** thật, vào tab Rules, đăng thử 1 rule → xác nhận lên đầu danh sách kèm badge "New" vàng, và nút "Rules" ở top-nav (khi ở trang khác) hiện đúng "1 Rule mới".
3. Sửa rule vừa đăng → xác nhận nội dung cập nhật đúng, reload xác nhận còn nguyên. Xoá rule đó → xác nhận bị đẩy xuống cuối + gạch ngang (không biến mất), reload xác nhận vẫn giữ trạng thái đã xoá.
4. Đăng nhập bằng tài khoản **không phải Manager** → xác nhận tab Rules vẫn xem được danh sách nhưng KHÔNG thấy khung đăng rule mới/nút Sửa/Xoá trên từng rule.
5. Đợi qua ngày hôm sau (hoặc kiểm tra lại vào hôm sau) → xác nhận badge "New" trên rule cũ và badge đếm "N Rule mới" ở top-nav tự biến mất mà không cần thao tác gì thêm (tự tính lại theo ngày hiện tại, không có dữ liệu "đã xem" lưu riêng).

### 4.16 [CHỜ XỬ LÝ] Rich text (bold/italic/font) cho ô nhập Rules + đổi quyền thêm/sửa/xoá Rules sang `manageRules` cấu hình được (thêm 2026-08-11)

Hai thay đổi cùng lúc trên tab Rules (mục 4.15):
1. **Rich text editor** (`src/components/rich-text-editor.tsx`) cho khung đăng rule mới lẫn khung sửa — toolbar Bold/In đậm, Italic/In nghiêng, chọn font (giống Gmail compose rút gọn), dựa trên `contentEditable` + `document.execCommand` (không thêm thư viện WYSIWYG). `Rule.content` (đã có sẵn, kiểu `String`) giờ lưu **HTML** thay vì plain text — **KHÔNG đổi schema** (không cần migration) vì cột đã là String/Text sẵn từ đầu. HTML được sanitize qua whitelist tag/attribute rất hẹp (`sanitizeRuleHtml`, `src/lib/rich-text.ts` — chỉ cho `b/i/u/span/font/br`, style/face đã lọc) ở **server** (POST/PATCH `/api/rules`, nguồn xử lý chính) lẫn client (khi render, phòng hờ) — chống XSS lưu trữ giữa các nhân viên nội bộ dùng chung tab này. Rule tạo TRƯỚC thay đổi này (plain text với `\n`) vẫn hiển thị đúng nhờ `toRuleDisplayHtml` tự nhận diện + chuyển `\n` thành `<br>` nếu chưa từng qua editor mới.
2. **Quyền thêm/sửa/xoá rule đổi từ hard-code `role === "manager"` sang feature key `manageRules`** (thêm vào `ASSIGNABLE_FEATURES`/`FEATURE_LABEL` trong `src/lib/types.ts`, `DEFAULT_FEATURE_PERMISSIONS.manageRules: []` trong `src/lib/rbac.ts`) — Quản lý cấu hình role nào khác được thêm/sửa/xoá qua trang Phân quyền (bảng tự hiện thêm dòng "Thêm / sửa / xóa Rules" vì trang đó lặp `ASSIGNABLE_FEATURES` tự động, không cần sửa UI trang Phân quyền). **Đây LÀ thay đổi `DEFAULT_FEATURE_PERMISSIONS` — đúng loại mô tả ở mục 4.8**, nhưng **khác các mục 4.9–4.12 ở chỗ giá trị mặc định là mảng RỖNG (`[]`)** — do `hasFeature()`/`setFeaturePermission()` đều tự fallback về `[]`/`false` khi key `manageRules` chưa tồn tại trong `AppConfig.featurePermissions` production (dùng `?? []`/`?? false`), nên về mặt CHỨC NĂNG **không bắt buộc** phải chạy script merge như mục 4.8 mô tả — production vẫn hoạt động đúng (chỉ Quản lý thêm/sửa/xoá được, giống hệt hành vi hard-code cũ) dù chưa merge. Script merge chỉ cần thiết nếu muốn admin **thấy rõ** dòng "Thêm / sửa / xóa Rules" đã có key tường minh trong DB (không bắt buộc, chỉ để nhất quán với các `AppConfig` merge trước đó).

**Sau khi deploy code này lên production**, chỉ cần các bước sau (xoá mục này khỏi file khi đã làm xong):
1. Không cần `prisma migrate deploy` (không đổi schema) — chỉ cần deploy code.
2. (Tuỳ chọn, không bắt buộc) Chạy script merge cộng dồn thêm `manageRules: []` vào `AppConfig.featurePermissions` production nếu muốn key hiện tường minh trong DB thay vì dựa vào fallback runtime.
3. Đăng nhập production bằng tài khoản **manager** thật, vào tab Rules, dùng thử Bold/Italic/đổi font khi đăng rule mới → xác nhận rule hiển thị đúng định dạng, reload vẫn giữ nguyên.
4. Vào trang Phân quyền, tick thêm 1 role (vd Processor) vào dòng "Thêm / sửa / xóa Rules" → đăng nhập bằng tài khoản role đó → xác nhận thấy khung đăng rule mới + nút Sửa/Xoá trên từng rule (trước đó không thấy). Bỏ tick lại → xác nhận role đó quay về chỉ xem được.
5. Đăng nhập bằng tài khoản chưa từng được cấp `manageRules` (vd Agent/Support mặc định) → xác nhận vẫn xem được danh sách rule (kể cả rule có định dạng đậm/nghiêng/font hiển thị đúng) nhưng KHÔNG thấy khung đăng/nút Sửa/Xoá.

### 4.17 [CHỜ XỬ LÝ] Quản lý (Admin) thêm/sửa/xoá trạng thái trong popup "Refund by years" (thêm 2026-08-12)

Trước đây danh sách trạng thái của nút mắt cạnh cột Case (Pre-processing/Processing/Pending/CPA Review) là union type cố định trong code (`RefundYearStatus`, `src/lib/types.ts`) — không sửa/thêm/xoá được. Đổi thành danh sách `SelectOption[]` cấu hình được, lưu ở `AppConfig.refundYearStatusOptions` (cột mới, additive) — cùng dạng dữ liệu với `options` của cột kiểu select, cùng UI editor (thêm/sửa tên/màu/xoá) nhưng đặt trong popup của `CaseRefundStatusButton` (nút bánh răng, chỉ hiện với **manager**) thay vì `ColumnSettingsDialog`. Option id `"pending"` là id đặc biệt code còn tham chiếu trực tiếp (nhấp nháy đỏ + ô nhập lý do, `hasPendingRefundYear` trong `src/lib/refund-status.ts`) — **không xoá được** qua UI lẫn API (`PUT /api/config` trả 400 nếu request cố xoá), nhưng vẫn đổi tên/màu tự do được. Mặc định `DEFAULT_REFUND_YEAR_STATUS_OPTIONS` (`src/lib/rbac.ts`) giữ nguyên 4 label/màu cũ nên hành vi hiện có không đổi cho tới khi Admin chủ động sửa.

**Đây là loại thay đổi field mới trong `AppConfig` (giống mục 4.9–4.12), nhưng field mặc định là `null`** (không seed sẵn, code tự fallback `config.refundYearStatusOptions ?? DEFAULT_REFUND_YEAR_STATUS_OPTIONS` ở cả `hydrateFromServer` lẫn `GET /api/config`) — nên **không bắt buộc** phải chạy script merge như mục 4.8 mô tả để app hoạt động đúng (production vẫn hiện đủ 4 trạng thái mặc định dù cột DB còn `null`), script merge chỉ cần nếu muốn Admin thấy rõ giá trị tường minh trong DB ngay từ đầu thay vì dựa vào fallback runtime.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (thêm cột `refundYearStatusOptions`, an toàn/additive, nullable).
2. Đăng nhập production bằng tài khoản **manager** thật, mở popup mắt ở 1 hồ sơ có refund > 0, bấm nút bánh răng → xác nhận thấy đủ 4 trạng thái mặc định, thử đổi tên/màu 1 trạng thái + thêm 1 trạng thái mới → xác nhận lưu đúng, reload vẫn giữ nguyên.
3. Thử xoá trạng thái "Pending" → xác nhận nút xoá bị khoá (disabled) không cho xoá; xoá 1 trạng thái khác (vd trạng thái vừa thêm) → xác nhận xoá được bình thường.
4. Đăng nhập bằng tài khoản KHÔNG phải manager → mở popup mắt → xác nhận KHÔNG thấy nút bánh răng quản lý (chỉ chọn được trạng thái nếu có quyền sửa cột refunds, như hành vi cũ).

### 4.18 [CHỜ XỬ LÝ] Tab "Collecting" mới — bảng thu hồi công nợ độc lập với bảng Hồ sơ (thêm 2026-08-12)

Thêm hẳn 1 tab điều hướng mới "Collecting" (`/dashboard/collecting`, đặt sau Orders, trước Rules — Cases -> Orders -> Collecting -> Rules) — bảng dữ liệu kiểu Excel dựng cùng kiểu grid/sticky-header/freeze-cột-đầu như bảng Hồ sơ nhưng **hoàn toàn độc lập**, không liên kết Case nào. 33 cột theo đúng danh sách Excel gốc user cung cấp (Date, Confirmed By, Name, Phone, Program, Tax Offset, Acct, Agent 1/2, Collector, Year (x2), Qual./Approved/Upfront/Total Collected/Instal. Amount, Pmt method, Note, Tips, VAR, Total Actual/Service/CPA filling fee, Receipt/Check #/Amt., Cont. 1-3, IC, Check Uploaded, Checker) — xem `DEFAULT_COLLECTING_COLUMNS` trong `rbac.ts`. **Đây CHỈ là khung bảng + cột (thêm/sửa/xoá cột, inline edit, kéo-thả dòng/cột) — chưa gắn bất kỳ logic nghiệp vụ riêng nào** (không SSN/order/assign/refund status...), đúng yêu cầu "tính năng sẽ thông báo sau" của user lúc tạo.

Thay đổi gồm ĐỦ 3 loại mô tả ở mục 4.8/4.9-4.12/4.15 cộng lại, cần xử lý riêng từng phần:
1. **Bảng mới hoàn toàn** `CollectingRecord` (giống mục 4.15/Rule) — id/custom (Json)/sortOrder/createdAt/updatedAt, KHÔNG cần script merge `AppConfig`, chỉ cần migration.
2. **Field mới trong `AppConfig`**: `collectingColumns Json?` (giống mục 4.17, mặc định `null` — code tự fallback `DEFAULT_COLLECTING_COLUMNS` ở `hydrateFromServer`/`GET /api/config`) — **không bắt buộc** script merge để app chạy đúng.
3. **4 feature key mới trong `DEFAULT_FEATURE_PERMISSIONS`** (giống mục 4.16 — `addCollectingColumn`/`editCollectingColumn`/`addCollectingRow`/`deleteCollectingRow`, mặc định mảng RỖNG `[]`, chỉ Quản lý dùng được cho tới khi Admin cấp thêm qua trang Phân quyền) — do `hasFeature()` tự fallback `?? []` khi key chưa tồn tại trong `AppConfig.featurePermissions` production, **không bắt buộc** script merge để app hoạt động đúng (chỉ Quản lý thêm/sửa/xoá cột/dòng được, đúng mặc định).

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (tạo bảng `collecting_records` mới + thêm cột `collectingColumns` trên `app_config`, cả 2 đều an toàn/additive).
2. Đăng nhập production bằng tài khoản **manager** thật, vào tab "Collecting" (đặt sau Orders) → xác nhận thấy đủ 33 cột mặc định đúng thứ tự, sticky header + freeze cột "Date" đầu tiên khi cuộn ngang hoạt động đúng.
3. Bấm "Thêm dòng" → gõ thử vài ô (đặc biệt cột tiền `currency` và cột ngày `date`) → reload trang xác nhận dữ liệu còn nguyên.
4. Thử kéo-thả đổi thứ tự 1 dòng và 1 cột → reload xác nhận giữ đúng vị trí mới (cùng cơ chế `sortOrder`/`reorderColumn` đã có ở bảng Hồ sơ).
5. Mở nút cài đặt (⚙) trên 1 cột → thử đổi tên, đổi quyền sửa (`editableBy`) cho thêm 1 role khác (vd Accounting) → đăng nhập bằng tài khoản role đó → xác nhận sửa được đúng ô cột đã cấp quyền, các cột khác vẫn khoá.
6. Đăng nhập bằng tài khoản KHÔNG phải manager/accounting → xác nhận KHÔNG thấy tab "Collecting" ở nav (đã giới hạn `roles: ["manager","accounting"]` trong `top-nav.tsx` — thu hẹp/mở rộng khi có yêu cầu cụ thể hơn từ user).

### 4.19 [CHỜ XỬ LÝ] Thêm slot Agent 2 / Processor 2 ở bảng Hồ sơ (thêm 2026-08-12)

Cột "Agent" và "Processor" ở bảng Hồ sơ giờ có thêm 1 slot giao việc thứ 2 mỗi cột ("Agent 2"/"Processor 2", đặt ngay cạnh cột gốc — thứ tự Agent → Agent 2 → Processor → Processor 2) — **cùng chức năng/quyền hệt cột gốc** (cùng dùng `AssignMenu`, cùng danh sách user, cùng tạo notification khi giao việc, cùng tính vào `canViewCase`/`canEditCase` cho Agent/Processor/Agent Leader/Processor Leader, cùng tính vào bộ lọc Agent/Processor và báo cáo theo thành viên). Thêm 2 cột mới `Case.assignedTo2`/`Case.assignedProcessor2` (String?, additive) — **KHÔNG đụng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`/`AppConfig`** (giống mục 4.13/4.14/4.15/4.18-phần-1) nên **không cần** script merge, chỉ cần migration. Slot 2 KHÔNG tự động gán cho người tạo hồ sơ như slot 1 (`addRow` chỉ tự gán Agent/Processor gốc) — luôn bắt đầu trống.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (thêm 2 cột `assignedTo2`/`assignedProcessor2` trên `cases`, an toàn/additive).
2. Đăng nhập production bằng tài khoản **manager** thật, mở bảng Hồ sơ → xác nhận thấy đủ 4 cột Agent/Agent 2/Processor/Processor 2 theo đúng thứ tự, giao thử 1 hồ sơ cho 1 Agent ở slot "Agent 2" → xác nhận Agent đó nhận được notification, reload vẫn giữ đúng.
3. Đăng nhập bằng tài khoản **Agent** vừa được giao ở "Agent 2" → xác nhận hồ sơ đó xuất hiện trong bảng của họ (canViewCase đã tính slot 2) dù KHÔNG được gán ở slot "Agent" gốc.
4. Thử bộ lọc Agent (với tài khoản Processor)/Processor (với tài khoản Agent) → chọn đúng người vừa gán ở slot 2 → xác nhận hồ sơ hiện đúng trong kết quả lọc.
5. Kiểm tra báo cáo theo thành viên (view "Báo cáo") → xác nhận hồ sơ vừa giao ở slot 2 được tính vào số liệu của đúng Agent/Processor đó.

### 4.20 [CHỜ XỬ LÝ] Realtime qua Pusher — chuông thông báo + bảng Hồ sơ/Order tự cập nhật (thêm 2026-08-13)

Thêm realtime thật cho 2 việc: (1) **chuông thông báo** — trước đây hoàn toàn giả (tạo trong `set()` ở client, không có bảng DB, không có API, người được giao việc KHÔNG BAO GIỜ thực sự nhận được thông báo trên máy họ), giờ tạo server-side + lưu bảng `Notification` mới + đẩy qua Pusher tới đúng kênh riêng của người nhận; (2) **bảng Hồ sơ/Order** — khi ai đó sửa 1 case, mọi trình duyệt khác đang mở tự refetch lại (qua `GET /api/cases`, vẫn lọc RBAC như cũ) mà không cần F5. Đúng công nghệ đã đề xuất sẵn ở mục 2 (bảng "Realtime notification"). Gồm ĐỦ 3 loại thay đổi:
1. **Bảng mới hoàn toàn** `Notification` (giống mục 4.15/4.18-phần-1) — KHÔNG cần script merge `AppConfig`, chỉ cần migration.
2. **Dependency ngoài mới**: `pusher` (server) + `pusher-js` (client) trong `package.json`.
3. **6 biến môi trường mới** (`PUSHER_APP_ID`/`PUSHER_KEY`/`PUSHER_SECRET`/`PUSHER_CLUSTER` server + `NEXT_PUBLIC_PUSHER_KEY`/`NEXT_PUBLIC_PUSHER_CLUSTER` client, xem `.env.example`) — thiếu bất kỳ biến nào trong 4 biến server thì `src/lib/pusher-server.ts` tự no-op + `console.warn` (không throw), thiếu 2 biến client thì `src/lib/pusher-client.ts` tự trả `null` — app vẫn chạy đúng như trước, chỉ mất phần realtime, KHÔNG bắt buộc phải có ngay để deploy code này an toàn, nhưng cần làm sớm để tính năng thực sự hoạt động.

Thiết kế bảo mật quan trọng (đọc trước khi verify): kênh `private-cases` (mọi user đều subscribe) chỉ bắn tín hiệu RỖNG `{caseId}`, KHÔNG kèm dữ liệu case thật — client nhận tín hiệu rồi tự gọi lại `GET /api/cases` (đã lọc RBAC theo `canViewCase` như cũ) chứ không tin trực tiếp payload Pusher. Ngược lại, thông báo (`private-notifications-{userId}`) gửi thẳng dữ liệu thật vì đã "địa chỉ hoá" đúng 1 người nhận, và endpoint `/api/pusher/auth` chặn không cho user A subscribe kênh thông báo của user B.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (tạo bảng `notifications` mới, an toàn/additive).
2. Tạo tài khoản + app mới trên [dashboard.pusher.com](https://dashboard.pusher.com) (Channels, không phải Beams) → copy `app_id`/`key`/`secret`/`cluster`.
3. Thêm đủ 6 biến môi trường ở trên vào Vercel Environment Variables (Production).
4. Đăng nhập bằng **2 tài khoản thật khác nhau** ở 2 trình duyệt/profile khác nhau trên production. Ở trình duyệt A, giao 1 hồ sơ cho tài khoản B (cột Agent hoặc Processor) → xác nhận trình duyệt B thấy chuông thông báo hiện lên + phát âm thanh/toast (như cơ chế cũ của `notification-bell.tsx`) trong vài giây, KHÔNG cần B tự reload trang.
5. Vẫn 2 trình duyệt đó, ở A sửa 1 ô bất kỳ (status, description...) của 1 hồ sơ B đang nhìn thấy trên bảng → xác nhận bảng của B tự cập nhật giá trị mới trong vài giây, không cần reload.
6. Đặt Order cho 1 hồ sơ ở trình duyệt A (role Processor/Agent), sang trình duyệt Support giao Order đó cho 1 tài khoản Support khác → xác nhận tài khoản Support đó nhận thông báo. Đổi status Order đó thành "Done" → xác nhận người đã đặt order (không phải Support) nhận thông báo "đã hoàn tất".
7. Đăng nhập bằng 1 tài khoản **Agent thường** (chỉ xem được hồ sơ của mình) ở trình duyệt thứ 3 → cho 1 tài khoản khác sửa 1 hồ sơ mà Agent này KHÔNG có quyền xem → xác nhận hồ sơ đó KHÔNG xuất hiện trên bảng của Agent sau khi tự refetch (đúng thiết kế "chỉ tín hiệu, dữ liệu vẫn qua RBAC filter sẵn có" — nếu hồ sơ lạ xuất hiện thì có lỗ hổng, cần dừng lại kiểm tra ngay).
8. Xác nhận trình duyệt A (người vừa thao tác ở bước 5) KHÔNG bị nháy/tự refetch lại chính thao tác của mình (loại trừ qua `socket_id`, xem `src/lib/pusher-client.ts`/`pusher-server.ts`).

### 4.21 [CHỜ XỬ LÝ] Đăng nhập bằng Họ tên, phân quyền xem tab Collecting (`viewCollecting`), nút Send to Google/CPA đổi sang denylist theo status, lịch sử chỉnh sửa/xoá chuyển lên server (thêm 2026-08-13, sửa lại cùng ngày)

4 thay đổi độc lập gộp chung 1 đợt deploy:

1. **`User.username`** (cột mới, `String? @unique`, additive) — đăng nhập giờ chấp nhận CẢ email lẫn Họ tên trong cùng 1 ô (`POST /api/auth/login` nhận `identifier`, tự tìm theo `email` HOẶC `username`, có giữ alias field `email` cho request cũ). **Sửa lại so với thiết kế ban đầu cùng ngày**: username KHÔNG phải ô Admin tự gõ nữa (đã bỏ hẳn UI đó) — server tự lấy NGUYÊN Họ tên (lowercase) làm username mỗi khi tạo tài khoản mới (`POST /api/users`), bỏ qua (giữ `null`) nếu trùng tên với tài khoản khác thay vì chặn tạo mới. Tài khoản tạo TRƯỚC thay đổi này cần chạy 1 lần script backfill (xem bước 1 bên dưới) để có username. Đây LÀ thay đổi schema (giống mục 4.9–4.12) — cần `prisma migrate deploy`.
2. **Feature key `viewCollecting`** (mới, `DEFAULT_FEATURE_PERMISSIONS.viewCollecting: ["accounting"]`) — thay cho hard-code `roles: ["manager","accounting"]` ở `top-nav.tsx` trước đây; Admin giờ cấp/thu quyền xem tab Collecting cho role bất kỳ qua trang Phân quyền. **Giá trị mặc định KHÔNG rỗng** (`["accounting"]`) — đúng loại mô tả ở mục 4.8 (khác mục 4.16/4.17/4.18-phần-3 vốn mặc định `[]`) nên **BẮT BUỘC** chạy script merge cộng dồn thêm `viewCollecting: ["accounting"]` vào `AppConfig.featurePermissions` production, nếu không Kế toán trên production sẽ mất quyền xem tab Collecting dù trước đó luôn xem được (do `hasFeature()` fallback `?? []` khi key chưa tồn tại, không phải `["accounting"]`). Trang `/dashboard/collecting` cũng tự chặn truy cập thẳng qua URL nếu thiếu quyền này (trước đây chỉ ẩn khỏi nav, ai biết URL vẫn vào được).
3. **Nút "Send to Google Sheet"/"Send mail to CPA" đổi từ allowlist sang denylist theo tên status** (`src/app/dashboard/cases/page.tsx`, `EXCLUDED_SEND_BUTTONS_STATUS_LABELS`) — trước đây chỉ hiện với 5 status liệt kê cứng, giờ hiện với MỌI status trừ nhóm loại trừ (Pre-processing/Processing/Missing Doc/Cancelled/Onhold/Disqualified/Duplicate, so khớp không phân biệt hoa/thường/dấu gạch ngang/số nhiều). Đây CHỈ là thay đổi logic front-end thuần (không đụng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`/schema) — **không cần** migration hay script merge, chỉ cần deploy code.
4. **Lịch sử chỉnh sửa/xoá hồ sơ (màn hình History) chuyển từ Zustand-only (chỉ tồn tại trong trình duyệt của người thao tác) sang server thật** — 2 bảng mới hoàn toàn `EditHistoryEntry`/`DeletedRowEntry` (giống mục 4.15/4.18-phần-1/4.20-phần-1: bảng mới, KHÔNG đụng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`, **không cần** script merge `AppConfig`, chỉ cần migration). Trước đây mỗi user chỉ thấy lịch sử do CHÍNH mình thao tác (dữ liệu client-side riêng từng trình duyệt) — giờ `GET /api/history/edits|deletions` KHÔNG lọc theo người xem, mọi user đăng nhập đều xem được TOÀN BỘ lịch sử của mọi người (đúng yêu cầu, không còn giới hạn). `hydrateFromServer` nạp lại cả 2 danh sách này mỗi lần vào dashboard giống users/cases/notifications; mỗi lần sửa ô/xoá hồ sơ vẫn ghi optimistic cục bộ NGAY (phản hồi tức thì) đồng thời gửi lên server nền (`syncInBackground`) — server tự set `editedByUserId`/`deletedByUserId`/thời gian thật, không tin giá trị client gửi.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-13** — `prisma migrate deploy` nhắm production (thêm cột `username` unique nullable trên `users` + 2 bảng `edit_history_entries`/`deleted_row_entries` mới, tất cả an toàn/additive) + chạy script backfill username cho 26 tài khoản đã có sẵn trên production (set `username = lower(name)`, không trùng tên nào nên không tài khoản nào bị bỏ qua).
2. ✅ **Đã xong 2026-08-13** — chạy script merge cộng dồn thêm `viewCollecting: ["accounting"]` vào `AppConfig.featurePermissions` production (key chưa có trước đó, đã merge — **bắt buộc**, khác các mục 4.16-4.18, xem giải thích ở trên).
3. [CHỜ XÁC NHẬN QUA UI] Đăng nhập production bằng tài khoản **Kế toán** thật → xác nhận vẫn thấy tab "Collecting" như trước (không bị mất quyền do quên bước 2).
4. Tạo thử 1 tài khoản mới (Admin, trang Quản lý tài khoản) → đăng xuất, đăng nhập lại bằng ĐÚNG Họ tên vừa nhập (không dùng email) → xác nhận đăng nhập thành công. Thử với 1 tài khoản CŨ đã backfill ở bước 1 tương tự.
5. Vào trang Phân quyền, tick thêm 1 role khác (vd Agent) vào dòng "Xem tab Collecting" → đăng nhập tài khoản role đó → xác nhận thấy tab Collecting (trước đó không thấy). Bỏ tick lại → xác nhận mất quyền xem, kể cả gõ thẳng URL `/dashboard/collecting`.
6. Trên bảng Hồ sơ, đổi thử 1 hồ sơ sang 1 status KHÔNG nằm trong 7 status loại trừ (vd 1 status tuỳ chỉnh Admin tự thêm, hoặc "Approved") → xác nhận thấy nút Send to Google/Send mail to CPA hiện ra cạnh badge Status (trước đây chỉ 5 status cố định mới thấy).
7. Đăng nhập bằng **2 tài khoản khác nhau** ở 2 trình duyệt. Ở trình duyệt A, sửa 1 ô bất kỳ (vd Status) của 1 hồ sơ → mở màn hình History → xác nhận thấy đúng thay đổi vừa làm. Sang trình duyệt B (tài khoản khác, KHÔNG phải người vừa sửa) → mở màn hình History → xác nhận **CŨNG thấy đúng thay đổi đó** (trước đây B sẽ không thấy gì vì lịch sử chỉ ở local A). Thử tương tự với xoá 1 hồ sơ.

### 4.22 [CHỜ XỬ LÝ] Tab "CPA Review" — bảng độc lập đồng bộ 2 chiều với Google Sheet theo tháng (thêm 2026-08-13, đổi kiến trúc 2026-08-14)

**Lịch sử quyết định (đọc trước khi làm gì với mục này)**: bản đầu tiên gắn 5 cột (`intakeDate`/`crmSource`/`fcDate`/`processingDate`/`elDate`) thẳng vào bảng Hồ sơ (Case), đồng bộ theo SSN của Case. User sau đó yêu cầu **"đây là tab riêng biệt không liên quan gì đến màn hình hồ sơ, vui lòng không liên kết bất cứ gì"** — toàn bộ thiết kế đã viết lại thành **1 bảng độc lập hoàn toàn**, đúng cùng nguyên tắc với tab "Collecting" (không phải Case, không phải "view" của Case). Phần dưới đây mô tả đúng kiến trúc CUỐI CÙNG đã triển khai — không còn field nào trên `Case` liên quan tính năng này (`refundYearEfileDate` được giữ lại vì là 1 cải tiến độc lập cho popup "Refund by years" trên bảng Hồ sơ, không phải một phần của tính năng CPA Review).

**Tổng quan**: Admin dán link 1 Google Sheet tháng thật (đã khảo sát cấu trúc cột A-AH qua export CSV — Sheet riêng tư nên KHÔNG đọc được công thức, chỉ đọc được giá trị đã tính) trên trang Phân quyền (`CpaReviewSheetConfigDialog`). Lúc kết nối, app **NHẬP TOÀN BỘ dòng có SSN trong Sheet thành bản ghi mới** trong bảng riêng `CpaReviewRecord` (Prisma model mới, giống hệt `CollectingRecord`: chỉ có `custom` Json + `sortOrder`, không có field cố định nào khác, không liên kết bảng nào khác). Sau đó đồng bộ 2 chiều liên tục: sửa ở tab "CPA Review" trong app tự đẩy sang đúng cột/dòng Sheet (khớp theo SSN cột D); sửa trực tiếp trong Sheet (qua Apps Script `onEdit` cài 1 lần, POST về webhook) tự kéo ngược vào app gần thời gian thực. SSN lạ chưa từng thấy (dòng mới thêm trực tiếp trong Sheet) → webhook **TỰ TẠO bản ghi mới** (khác thiết kế Case cũ — ở đây an toàn vì không có ràng buộc caseNumber/RBAC phức tạp, đúng tinh thần "bảng độc lập tự do thêm dòng" như Collecting). Xung đột: **App luôn thắng** (webhook bỏ qua thay đổi từ Sheet nếu record vừa được app cập nhật trong vòng 5 giây trước đó).

Đẩy App→Sheet dùng **Service Account** (tài khoản Google "robot" dùng chung, KHÔNG phụ thuộc ai đã kết nối Google cá nhân — bắt buộc vì phải tự ghi khi BẤT KỲ ai trong Agent/Agent Leader/Processor/Processor Leader sửa dữ liệu) + mapping cột **CỐ ĐỊNH** (`src/lib/cpa-review-columns.ts`, khớp đúng cấu trúc Sheet thật đã khảo sát, không cấu hình qua UI như Collecting vì phải giữ nguyên đúng cấu trúc Sheet).

**Tab điều hướng "CPA Review"** (`/dashboard/cpa-review`, sau tab "Collecting") — bảng khớp đúng thứ tự cột A-AH (Intake Date/Name/Phone/SSN/DOB/Zip/4 khối năm (Ngày E-file/Status/Số tiền — TẤT CẢ sửa trực tiếp được, không khoá như "money" ở bảng Hồ sơ vì không có ràng buộc gì với Case)/Note/Processor/Agent/CRM Source/FC Date/Processing Date/EL Date). Có nút "Thêm"/xoá dòng (giống Collecting). Feature key `viewCpaReview` (mặc định KHÔNG rỗng: `["agent","agent_leader","processor","processor_leader"]`, theo đúng yêu cầu ban đầu) gate cả xem lẫn sửa (không có RBAC theo từng cột như Case — đơn giản hoá vì cột cố định, không admin cấu hình). `addCpaReviewRow`/`deleteCpaReviewRow` cùng mặc định 4 role đó.

Gồm ĐỦ các loại thay đổi mô tả ở mục 4.8/4.9-4.12/4.15:
1. **Bảng mới hoàn toàn** `CpaReviewRecord` (giống mục 4.15/4.18-phần-1/4.20-phần-1 — bảng mới, KHÔNG đụng `DEFAULT_COLUMNS`/`Case`, **không cần** script merge `AppConfig`, chỉ cần migration).
2. **Field mới trên `AppConfig`**: `cpaReviewSheetConfig` (Json?, null = chưa kết nối) — cần migration (an toàn/additive).
3. **3 feature key mới**: `manageCpaReviewSheet` (mặc định `[]`, chỉ Quản lý dùng qua `hasFeature()` bypass — **không bắt buộc** script merge, giống mục 4.16), `viewCpaReview` VÀ `addCpaReviewRow`/`deleteCpaReviewRow` (mặc định `["agent","agent_leader","processor","processor_leader"]`, KHÔNG rỗng) — **giống mục 4.21 (`viewCollecting`)**: giá trị mặc định không rỗng nên **BẮT BUỘC** chạy script merge `AppConfig.featurePermissions` production cho cả 3 key này, nếu không 4 role trên sẽ KHÔNG thấy/thêm/xoá được dòng ở tab dù code đã đúng (fallback runtime là `?? []`, không phải mảng mặc định mong muốn).
4. **Dependency đã có sẵn** (`googleapis`) — không cần thêm mới, chỉ cần bổ sung cách xác thực Service Account (`google.auth.JWT`) thay vì `google.auth.OAuth2`.
5. **2 biến môi trường mới**: `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — thiếu 1 trong 2 thì mọi hàm liên quan tự no-op/trả lỗi rõ ràng (`ServiceAccountNotConfiguredError`), KHÔNG crash app, chỉ ẩn/tắt phần ĐẨY lên Sheet (tab "CPA Review" vẫn xem/sửa/thêm/xoá dòng bình thường vì đó là bảng độc lập, chỉ riêng đồng bộ 2 chiều mới cần Service Account).

**Đã tự kiểm tra kỹ ở local (2026-08-14)** trước khi giao — không chỉ code xong mà đã chạy thật với 1 Google Sheet thật (test sheet user cung cấp): kết nối → nhập đúng 109/109 dòng có SSN từ Sheet thành `CpaReviewRecord` mới, dữ liệu parse đúng (tên/SSN/DOB/note/ngày tháng/số tiền/status/CRM Source khớp chính xác với Sheet gốc); giả lập webhook sửa 1 ô từ Sheet → cập nhật đúng field trong app; chạy "Đồng bộ lại toàn bộ" → đẩy lại 109/109 dòng lên Sheet thành công. `tsc`/`eslint` sạch.

**Bổ sung 2026-08-14 (cùng ngày, chưa deploy) — đồng bộ 2 chiều Ghi chú (Note)**: ghi chú (icon 📌) cạnh ô "Ngày" mỗi năm (`custom.dateNote_{year}`, trước đó CHỈ lưu trong app) giờ đồng bộ 2 chiều với Note THẬT của Google Sheets (chuột phải ô "Ngày" tương ứng → Insert note) — xác nhận với user đây CHỈ là 1 tính năng (không có Comment threaded riêng biệt nào khác cần làm). **Khác mọi chiều đồng bộ khác ở mục này**: App→Sheet vẫn tức thời (qua `syncRecordToCpaReviewSheet` có sẵn, thêm bước ghi Note bằng `writeCellNotes`/`batchUpdate updateCells fields:"note"` — `spreadsheets.values.update` không ghi được Note), nhưng Sheet→App **KHÔNG THỂ tức thời** vì Apps Script `onEdit` không bắn sự kiện khi thêm/sửa Note (chỉ bắt được sửa GIÁ TRỊ ô) — đã xác nhận với user chấp nhận đánh đổi, chuyển sang **quét định kỳ mỗi 1 phút** (giảm từ 5 phút ban đầu — 2026-08-16, theo yêu cầu user, đây là mức tối thiểu Apps Script time-driven trigger cho phép) qua 1 trigger hẹn giờ MỚI (`syncCpaReviewNotes`, cùng Apps Script với `onEdit`, POST batch `{secret, notes: [{ssn, year, note}]}` về CHÍNH webhook cũ — route tự nhận diện qua `Array.isArray(body.notes)`). Đoạn Apps Script sinh ra lúc kết nối (`buildAppsScript`) giờ có thêm hàm `installCpaReviewTriggers` — Admin cần chọn đúng hàm này ở dropdown Apps Script rồi bấm Run (thay vì chạy `onEdit` như hướng dẫn cũ) để vừa cấp quyền vừa cài trigger 1 phút. **Không đổi schema** (Note vẫn nằm trong `CpaReviewRecord.custom` Json có sẵn) — không cần migration, không cần script merge `AppConfig`.

**Bổ sung 2026-08-14 (cùng ngày, chưa deploy) — MỖI THÁNG 1 bảng/1 Sheet riêng + cấu hình dời sang chính tab CPA Review**: theo yêu cầu "khi chọn tháng nào sẽ ra bảng của tháng đó, có chỗ insert link cho Google Sheet tháng mới được chọn" — kiến trúc trước đó (1 `CpaReviewSheetConfig` singleton + tất cả record chung 1 bảng, dù tên tính năng đã ghi "theo tháng" nhưng chưa thực sự tách) nay đổi thành:
- **`CpaReviewRecord.month`** (cột mới, `String` NOT NULL, giá trị `"YYYY-MM"`) — SSN (`custom.ssn`) giờ chỉ duy nhất TRONG CÙNG 1 tháng, không còn duy nhất toàn bảng (khách quay lại tháng sau = 1 dòng mới). Migration additive-first đúng chuẩn: thêm cột nullable → backfill dữ liệu cũ (lúc viết migration, toàn bộ dữ liệu test hiện có được gán `month = '2026-08'`, tháng đang là "hiện tại" lúc xây tính năng) → mới khoá NOT NULL + thêm index. **Production chưa có dữ liệu CPA Review thật nào** (tính năng còn ở mục [CHỜ XỬ LÝ], chưa qua bước 1-13 gốc ở trên) nên bước backfill này không áp dụng cho production — chỉ cần chạy migration bình thường.
- **`AppConfig.cpaReviewSheetConfig` đổi hình dạng** từ 1 object singleton thành `Record<"YYYY-MM", CpaReviewSheetConfig>` — vẫn cột `Json?` cũ, KHÔNG cần migration schema thêm, chỉ là quy ước đọc/ghi khác ở tầng ứng dụng (`getCpaReviewSheetConfigMap`/`saveCpaReviewSheetConfigMap` trong `cpa-review-sheet-sync.ts`). Vì production đang `null` (chưa từng kết nối), không có dữ liệu cũ nào cần reshape.
- **Webhook (`/api/cpa-review-sheet/webhook`) đổi cách xác thực**: trước đây so khớp trực tiếp `sheetConfig.webhookSecret`, giờ phải DÒ xem `secret` gửi lên khớp THÁNG nào trong map (`findCpaReviewConfigBySecret`) — mỗi tháng 1 secret riêng (sinh mới mỗi lần "Kết nối Sheet" cho tháng đó), Apps Script của tháng nào chỉ biết secret của đúng tháng đó nên không cần gửi kèm `month` trong payload.
- **UI cấu hình dời hẳn từ trang Phân quyền SANG chính tab CPA Review** (yêu cầu "tạo 1 ô cấu hình ở màn hình này") — `CpaReviewSheetConfigDialog` (nút "Kết nối Sheet"/"Đã kết nối Sheet") giờ nhận prop `month`, đặt cạnh bộ chọn tháng mới (`CpaReviewMonthPicker`, mũi tên trái/phải + nút "Hôm nay") ngay trên tab CPA Review, KHÔNG còn ở trang Phân quyền. Cả 2 vẫn gate bằng feature `manageCpaReviewSheet` sẵn có (không thêm feature key mới).
- **Nút "Hướng dẫn" mới** (`CpaReviewSyncGuideDialog`) — popup 5 bước cụ thể (share quyền Editor cho email Service Account, dán link vào "Kết nối Sheet", dán Apps Script vào Extensions → Apps Script, chạy `installCpaReviewTriggers`, thử sửa 1 ô để kiểm tra), đọc email Service Account qua **route GET mới** `GET /api/config/cpa-review-sheet` (trả `{serviceAccountConfigured, serviceAccountEmail}`, gate cùng quyền `manageCpaReviewSheet`, không phải bí mật).

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-15** — `prisma migrate deploy` nhắm production đã chạy, áp đủ 6 migration còn thiếu (bao gồm `cpa_review_records` + `cpaReviewSheetConfig`). Đây chính là nguyên nhân gây lỗi "login" trên production tối 2026-08-14 (Prisma Client đã deploy đọc cột/bảng chưa tồn tại trên DB → mọi API `hydrateFromServer()` gọi 500 → `login()` bắt lỗi, báo sai thành "sai mật khẩu" — xem `.claude/skills/google-sheet-sync/SKILL.md`). Các bước 2-16 dưới đây (feature permissions merge, Service Account env vars, kết nối Sheet thật, verify UI) **VẪN CHƯA LÀM**.
2. Chạy script merge cộng dồn thêm `viewCpaReview`, `addCpaReviewRow`, `deleteCpaReviewRow` (đều `["agent","agent_leader","processor","processor_leader"]`) vào `AppConfig.featurePermissions` production — **bắt buộc**, xem giải thích ở trên.
3. Tạo Service Account trên Google Cloud Console (project đã dùng cho OAuth Send-to-Sheet có thể dùng chung), bật Google Sheets API, tạo key JSON, lấy `client_email`/`private_key`.
4. Thêm `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` vào Vercel Environment Variables (Production) — `private_key` dán nguyên khối kèm `\n` literal (code tự thay lại thành newline thật, xem `google-service-account.ts`).
5. Đăng nhập production bằng tài khoản **manager** thật, vào tab **CPA Review** (KHÔNG phải trang Phân quyền nữa), dùng bộ chọn tháng để tới đúng tháng thật cần kết nối, bấm nút "Hướng dẫn" đọc qua, copy email Service Account hiện ra.
6. Bấm nút "Kết nối Sheet", dán link Sheet của đúng tháng đó (đã mở đúng tab, URL có `#gid=...`) → xác nhận báo đúng số dòng đã nhập, copy đoạn Apps Script hiện ra.
7. Vào chính Google Sheet đó, share quyền **Editor** cho email Service Account (bước 3/5), rồi Extensions → Apps Script, dán đoạn script từ bước 6, Save, chọn hàm **`installCpaReviewTriggers`** ở dropdown rồi bấm Run 1 lần — vừa cấp quyền (`UrlFetchApp`/`PropertiesService`/`ScriptApp`, popup xin quyền, Admin bấm đồng ý) vừa cài CẢ 2 trigger: `onCpaReviewEdit` (installable, sửa ô tức thời) và trigger hẹn giờ quét Ghi chú (Note) mỗi 1 phút. **Câu "onEdit là simple trigger nên tự chạy, không cần cài riêng" ở bản trước đây SAI** — xem mục bổ sung 2026-08-15 ngay dưới đây.
8. Đăng nhập bằng tài khoản **Agent hoặc Processor** thật → xác nhận thấy tab "CPA Review" ở nav (sau "Collecting"), bộ chọn tháng mặc định đúng tháng hiện tại, bảng hiện đúng dữ liệu vừa nhập từ Sheet. Sửa 1 ô (vd Note/FC Date/Số tiền 1 năm) → xác nhận Sheet cập nhật đúng ô trong vài giây.
9. Trực tiếp sửa 1 ô trong Sheet (vd đổi FC Date) → xác nhận app cập nhật gần như ngay lập tức (không cần F5, qua Pusher `broadcastCaseChanged` đã có).
10. Thêm 1 dòng hoàn toàn mới trực tiếp trong Sheet (SSN chưa từng có) → gõ vài ô → xác nhận app tự tạo dòng mới tương ứng trong tab "CPA Review", đúng THÁNG đang kết nối (không lẫn sang tháng khác).
11. Bấm mũi tên chuyển sang tháng KHÁC (chưa kết nối) → xác nhận bảng trống + hiện gợi ý "Chưa có dữ liệu/kết nối Sheet cho [tháng]" + nút "Kết nối Sheet" vẫn bấm được (để kết nối Sheet riêng cho tháng đó). Bấm "Hôm nay" → xác nhận quay đúng về tháng hiện tại.
12. Trên tab CPA Review (tháng đã kết nối), mở lại "Kết nối Sheet", ánh xạ tên Processor/Agent phát hiện được (vd "Toan") sang đúng tài khoản app tương ứng → gán Processor/Agent cho 1 dòng qua tab "CPA Review" → xác nhận Sheet ghi đúng tên đã ánh xạ (không phải tên đầy đủ mặc định).
13. Thử sửa gần như đồng thời cùng 1 ô ở cả app lẫn Sheet → xác nhận giá trị app thắng.
14. Bấm "Thêm"/xoá dòng ngay trong tab "CPA Review" → xác nhận hoạt động, dòng xoá bị xoá giá trị tương ứng trong Sheet (không dịch hàng), dòng thêm mới gắn đúng tháng đang chọn. Đăng nhập tài khoản KHÔNG có `viewCpaReview` (vd Support mặc định) → xác nhận KHÔNG thấy tab, kể cả gõ thẳng URL `/dashboard/cpa-review`.
15. Bấm icon 📌 cạnh ô "Ngày" 1 năm bất kỳ trong app, gõ 1 ghi chú → mở đúng ô "Ngày" tương ứng trên Sheet, hover vào góc đỏ ô → xác nhận thấy đúng Note vừa gõ trong vài giây (App→Sheet tức thời). Ngược lại: chuột phải 1 ô "Ngày" khác trên Sheet → Insert note → gõ thử → đợi tối đa ~1 phút (không cần F5) → xác nhận app hiện đúng ghi chú đó (Sheet→App quét định kỳ, có độ trễ đã xác nhận với user).
16. Kết nối thêm 1 Sheet KHÁC cho 1 tháng KHÁC (vd tháng kế tiếp) → xác nhận secret/rowIndex 2 tháng độc lập nhau hoàn toàn — sửa 1 ô ở tháng A không ảnh hưởng gì tới Sheet/dữ liệu tháng B, kể cả khi 2 tháng có chung SSN nào đó (khách quay lại).

**Bổ sung 2026-08-14 (cùng ngày, chưa deploy) — cột "CRM Source" đổi sang lấy options ĐỘNG từ cột "Status" của Case**: trước đó `CPA_REVIEW_CRM_SOURCE_OPTIONS` là 3 lựa chọn cố định (Client/Referral/Installment) viết chết trong code — theo yêu cầu "lấy theo dropbox của Status ngoài màn hình hồ sơ, khi nào màn hình hồ sơ có thêm trường gì thì CRM đều có thêm trường đó", đã xoá hẳn danh sách cố định này, thay bằng `caseStatusOptionsForCrmSource(columns)` (`cpa-review-columns.ts`) — đọc thẳng `AppConfig.columns` (cột `id: "status"`).`options` mỗi lần cần (UI lẫn cả 2 chiều đồng bộ Sheet: `buildCpaReviewSheetCells`/`sheetChangeToPatch` giờ nhận thêm tham số `crmSourceOptions` truyền từ `getCrmSourceOptions()` mới trong `cpa-review-sheet-sync.ts`). Mặc định KHÔNG có giá trị nào được chọn sẵn (dropdown hiện "—" cho tới khi người dùng tự chọn, không đổi hành vi này). **Hệ quả cần biết**: dữ liệu `custom.crmSource` cũ đã lưu bằng id thuộc bộ 3 lựa chọn cũ (`client`/`referral`/`installment`) sẽ KHÔNG còn khớp id nào trong danh sách Status mới → hiển thị trống ("—") sau khi deploy, không tự động map lại — đây là hệ quả tất yếu của việc đổi hẳn nguồn dữ liệu, không phải lỗi. **Không đổi schema** (vẫn cùng field `custom.crmSource` cũ) — không cần migration, không cần script merge `AppConfig` (đọc `columns` đã có sẵn, không thêm field mới nào).

**Sau khi deploy code này lên production**: đăng nhập production, vào tab CPA Review, mở dropdown "CRM Source" ở 1 dòng bất kỳ → xác nhận danh sách options hiện ra khớp CHÍNH XÁC (đúng số lượng, đúng nhãn, đúng thứ tự) với dropdown "Status" trên bảng Hồ sơ chính. Vào trang cấu hình cột (Cases → Thêm cột/Sửa cột "Status") thêm thử 1 status mới → quay lại tab CPA Review, mở lại dropdown "CRM Source" → xác nhận status vừa thêm xuất hiện ngay, không cần deploy lại code.

**Bổ sung 2026-08-15 — 2 lỗi thật gặp khi kết nối Sheet thật lần đầu trên production, đã vá**:

1. **"Range (...) exceeds grid limits. Max rows: 1000, max columns: 26"** — Sheet/tab MỚI tạo (chưa từng resize) mặc định chỉ 1000 dòng x 26 cột (Z), trong khi mọi range quét/ghi của tính năng này dùng tới cột AH (34) và dòng 3003 — Google Sheets API **từ chối thẳng** bất kỳ range nào vượt quá kích thước grid khai báo của tab (khác range nằm trong grid nhưng trống, vẫn trả rỗng bình thường). Đã vá bằng `ensureSheetGridSize()` (`cpa-review-sheet-sync.ts`) — tự phóng to tab (CHỈ tăng, không bao giờ giảm, không đụng dữ liệu có sẵn) trước khi quét/ghi, gọi ở cả nhánh connect lẫn resync trong `POST /api/config/cpa-review-sheet`. Đã tái hiện đúng lỗi bằng cách tạo 1 tab test tạm (default 1000x26) trên chính Sheet thật, xác nhận fix giải quyết đúng, rồi xoá tab test.
2. **"Specified permissions are not sufficient to call UrlFetchApp.fetch"** khi Apps Script `onEdit` chạy — nguyên nhân: Apps Script tự chạy BẤT KỲ hàm nào tên đúng `"onEdit"` dưới dạng **simple trigger**, mà simple trigger LUÔN chạy ở chế độ **hạn chế (restricted authorization)** bất kể đã `Run installCpaReviewTriggers` cấp quyền cho cả project hay chưa — simple trigger không bao giờ được phép gọi các dịch vụ cần uỷ quyền như `UrlFetchApp`. Đây là giới hạn CỐ Ý của Google (chống lạm dụng trigger tự động chạy không cần xác nhận), không phải bug tạm thời. **Cách vá triệt để**: đổi tên hàm xử lý sửa ô từ `onEdit` thành `onCpaReviewEdit`, rồi đăng ký nó làm **installable trigger** tường minh trong `installCpaReviewTriggers()` (`ScriptApp.newTrigger("onCpaReviewEdit").forSpreadsheet(...).onEdit().create()`) — installable trigger chạy full authorization (do chính user Run + Allow), gọi `UrlFetchApp` được. Sửa trong `buildAppsScript()` (`src/app/api/config/cpa-review-sheet/route.ts`).

**Hệ quả cho các Sheet ĐÃ kết nối trước bản vá này**: script cũ đã dán vào Sheet đó vẫn còn hàm `onEdit` bị hạn chế → phải dán lại script MỚI. Vì script text (kèm secret) trước đây chỉ trả về ĐÚNG 1 LẦN lúc bấm "Kết nối Sheet" (không lưu lại), đã thêm `GET /api/config/cpa-review-sheet?month=YYYY-MM` (trả kèm `appsScript` build lại từ secret/tabName ĐÃ LƯU của tháng đó nếu đã kết nối) + nút "Copy script" ngay trong popup "Hướng dẫn" (`CpaReviewSyncGuideDialog`) — cho phép lấy lại script mới bất kỳ lúc nào mà **không cần ngắt kết nối rồi kết nối lại** (ngắt/kết nối lại sẽ đổi `webhookSecret`, mất `rowIndex` cache đã quét, phải nhập lại từ đầu).

**Nếu Sheet nào đã kết nối trước 2026-08-15 mà Sheet→App không đồng bộ (App→Sheet vẫn bình thường)**: mở tab CPA Review → "Hướng dẫn" → bấm "Copy script" ở bước 3 → dán ĐÈ lên code cũ trong Apps Script editor của Sheet đó → Save → chọn lại `installCpaReviewTriggers` → Run → Allow lại (kể cả đã Run trước đó, vì hàm/trigger đã đổi tên) → thử sửa 1 ô kiểm tra lại.

### 4.23 [CHỜ XỬ LÝ] 3 ô "FC Date"/"Processing Date"/"EL Date" trong popup "Edit Hồ sơ" (thêm 2026-08-14)

Thêm `Case.fcDate`/`Case.processingDate`/`Case.elDate` (3 cột mới, `String?`, additive, KHÔNG liên quan gì tới các field cùng tên bên tab CPA Review — đây là field RIÊNG trên `Case`, 2 tính năng độc lập hoàn toàn dù trùng tên) + 3 cột ẩn mới (`fcDate`/`processingDate`/`elDate`, `hidden: true`, type "date", cùng nhóm quyền với `refunds`) vào `DEFAULT_COLUMNS` — đúng loại thay đổi mô tả ở mục 4.8 (thêm cột ẩn mới cho popup "Edit Hồ sơ", giống mục 4.11 dateOfBirth/phone2/email/refunds). Hiện 3 ô này thành 1 hàng ngang ngay dưới khối "Refund" trong `ClientProfileDialog`, dùng `type="date"` native (nhất quán với ô Date of Birth có sẵn trong cùng dialog).

**Đã tự gặp đúng lỗi mô tả ở mục 4.8 khi test ở local**: sau khi thêm cột vào `DEFAULT_COLUMNS`, `AppConfig.columns` trên DB dev (đã seed từ trước) KHÔNG tự có 3 cột mới này → 3 ô hiện disabled/khoá xám dù đăng nhập bằng manager. Đã vá bằng script merge cộng dồn (thêm đúng 3 object cột mới vào mảng `columns` hiện có, không đụng cột nào khác) — **PHẢI làm lại y hệt trên production**.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-15** — `prisma migrate deploy` nhắm production đã chạy (xem mục 4.22 bước 1). Bước 2-4 dưới đây **VẪN CHƯA LÀM**.
2. Chạy script merge cộng dồn nhắm `AppConfig.columns` production: thêm 3 cột `fcDate`/`processingDate`/`elDate` (copy nguyên định nghĩa tương ứng trong `rbac.ts`) NẾU production chưa có id đó — **bắt buộc**, xem lỗi đã gặp ở local phía trên.
3. Đăng nhập production bằng tài khoản **không phải Manager** (vd Processor/Agent), mở popup "Edit Hồ sơ" 1 hồ sơ bất kỳ → xác nhận 3 ô mới (FC Date/Processing Date/EL Date) hiện ngay dưới khối Refund, **enable được** (không khoá xám) đúng theo quyền đã cấu hình.
4. Nhập thử cả 3 ô, bấm Lưu → reload trang, mở lại popup → xác nhận cả 3 giá trị còn nguyên.

### 4.24 [CHỜ XỬ LÝ] Nút "Test Sheet" cạnh Status — gửi hồ sơ sang tab "CPA Review" (thêm 2026-08-14)

Nút mới (icon bình thí nghiệm) đặt ngay dưới "Send mail to CPA" cạnh badge Status trên bảng Hồ sơ — cùng điều kiện hiện/quyền với 2 nút Send hiện có (`sendButtonsStatusIds` + `canSendToSheetFeature || canSendCpaEmailFeature`), nhưng bấm vào mở popup chọn năm (giống hệt "Send row to Google Sheet") rồi tạo 1 dòng MỚI trong tab "CPA Review" (tháng hiện tại) từ dữ liệu hồ sơ — xem `src/lib/case-to-cpa-review.ts` (`buildCpaReviewCustomFromCase`, chạy ở SERVER trong route mới) cho quy tắc map từng cột. Thêm `Case.cpaReviewTestSentAt` (cột mới, `DateTime?`, additive) — **cùng cơ chế hệt `sheetSentAt`/`cpaEmailSentAt`** (mục đã có từ trước, không phải thay đổi mới): giữ đúng trạng thái "đã gửi" (icon xanh) qua reload, có nút phụ "Đánh dấu đã gửi" (không tạo dòng CPA Review thật) và popup xác nhận riêng khi bấm lại lúc đang xanh ("muốn gửi lại?"). Route mới `POST /api/cases/[id]/test-cpa-review-sheet` (3 nhánh `clear`/`manual`/gửi thật, gate bằng feature `addCpaReviewRow` đã có sẵn — **không thêm feature key mới**). Đây CHỈ là 1 cột `DateTime?` mới trên `Case` — **KHÔNG đụng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`/`AppConfig`** (giống mục 4.13/4.14/4.19) nên **không cần** script merge `AppConfig`, chỉ cần migration.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-15** — `prisma migrate deploy` nhắm production đã chạy (xem mục 4.22 bước 1). Bước 2-4 dưới đây **VẪN CHƯA LÀM**.
2. Đăng nhập production bằng tài khoản có quyền `addCpaReviewRow` (mặc định Agent/Agent Leader/Processor/Processor Leader) hoặc Manager, mở 1 hồ sơ đang hiện nút Send → bấm "Test Sheet" → chọn 1-2 năm → xác nhận gửi → icon chuyển xanh (đã gửi), reload trang xác nhận vẫn giữ màu xanh.
3. Vào tab "CPA Review" tháng hiện tại → xác nhận dòng mới xuất hiện, đúng dữ liệu (Name ghép Taxpayer & Spouse, Phone/SSN/DOB xuống dòng nếu có 2 số, Processor/Agent đúng, chỉ đúng (các) năm đã chọn có số tiền, FC/Processing/EL Date lấy từ Edit Hồ sơ hoặc "NA" nếu trống, CRM Source để trống).
4. Bấm icon xanh (đã gửi) lần nữa → xác nhận hiện popup "muốn gửi lại?" riêng biệt, bấm "Có" → icon quay về trạng thái mặc định (chưa gửi), bấm lại mở đúng popup chọn năm từ đầu.
5. Trong popup chọn năm, bấm "Đánh dấu đã gửi" (không chọn năm nào trước) → xác nhận icon chuyển xanh ngay, KHÔNG có dòng mới nào được tạo trong tab CPA Review (chỉ đánh dấu UI).

### 4.25 [CHỜ XỬ LÝ] Email "Thông báo hoàn thuế" gửi khách hàng — thay hẳn mẫu Subject/Body tự do, thêm 3 ô ngân hàng + Tax INT theo năm (thêm 2026-08-16)

Viết lại hoàn toàn nút gửi mail cạnh ô Email (popup Edit Hồ sơ) — trước đây bấm là gửi ngay 1 mẫu Subject/Body Admin tự soạn tự do (xem mục 4.12); giờ bấm mở popup chọn năm (giống hệt "Test Sheet"/"Send row to Google Sheet") + chọn ngôn ngữ VI/EN + ô nhập "Additional tax on 1099-INT" riêng cho mỗi năm đã chọn, rồi gửi 1 lá thư CỐ ĐỊNH (không phải template Admin sửa câu chữ nữa) tính từ dữ liệu hồ sơ — subject dạng `[25 TAX REFUND] Taxpayer & Spouse - Phone` (nhiều năm: `[23-24-25 TAX REFUND]...`), body liệt kê Tax credit/Additional tax on 1099-INT/Estimated refund amount từng năm, kèm chữ ký cố định (banner `public/logo-chuky.png` + avatar user qua cid attachment, xem `src/lib/refund-notification-email.ts`).

Gồm ĐỦ 3 loại thay đổi:
1. **4 cột mới trên `Case`** (`bankName`/`routingNumber`/`accountNumber` String?, `taxIntByYear` Json? default `{}`) — additive, migration `20260815202859_refund_notification_email`. 3 ô ngân hàng chỉ sửa qua popup Edit Hồ sơ (giống fcDate/processingDate/elDate ở mục 4.23) — **KHÔNG** phải bank account thật của công ty, chỉ dùng để điền vào nội dung mail.
2. **3 cột ẩn mới trong `DEFAULT_COLUMNS`** (`bankName`/`routingNumber`/`accountNumber`, cùng nhóm quyền `refunds`) — đúng loại thay đổi mô tả ở mục 4.8, **BẮT BUỘC** script merge `AppConfig.columns` production như mục 4.23 đã làm, nếu không 3 ô này sẽ hiện khoá xám ở mọi role kể cả Manager.
3. **`AppConfig.clientEmailTemplate` đổi hình dạng** (không đổi schema, cùng cột Json cũ) — bỏ hẳn `subjectTemplate`/`bodyTemplate`/`signatureTemplate` tự do, thay bằng `signatureJobTitle`/`signaturePhone`/`signatureAddress`/`supportPhone` (4 field text cấu hình 1 lần, dùng chung mọi user) + giữ nguyên `cc`. Config cũ (nếu Admin đã từng lưu subjectTemplate/bodyTemplate) sẽ bị bỏ qua hoàn toàn (route mới không đọc 2 field đó nữa) — không cần dọn dữ liệu cũ, chỉ là dead data trong JSON.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-16** — `prisma migrate deploy` nhắm production đã chạy (4 cột mới trên `cases`).
2. ✅ **Đã xong 2026-08-16** — script merge đã chạy (dry-run rồi ghi thật), xác nhận 3 cột `bankName`/`routingNumber`/`accountNumber` đã có trong `AppConfig.columns` production.
3. ✅ **Đã xong 2026-08-16** — `public/logo-chuky.png` đã commit vào git và có mặt trong build production (kiểm tra `https://<production-domain>/logo-chuky.png` load được) — route đọc file này từ `process.cwd()/public` lúc gửi mail, thiếu file thì mail vẫn gửi được nhưng mất ảnh banner cuối chữ ký (không crash, có try/catch).
4. Đăng nhập production bằng tài khoản **không phải Manager** (vd Processor), mở popup Edit Hồ sơ 1 hồ sơ có email khách → xác nhận 3 ô Bank Name/Routing Number/Account Number hiện **enable được** (không khoá xám) → điền thử + Lưu → reload xác nhận còn nguyên.
5. Bấm nút gửi mail cạnh ô Email → xác nhận popup chọn năm hiện đúng số refund từng năm, chọn 2-3 năm → xác nhận hiện ô nhập Tax INT cho đúng từng năm đã chọn → gõ thử số → bấm gửi (nếu chưa kết nối webmail sẽ hiện dialog kết nối trước, xem mục 4.12) → xác nhận gửi thành công.
6. Mở lại popup gửi mail cho ĐÚNG hồ sơ đó lần 2 → chọn lại đúng những năm vừa gửi → xác nhận ô Tax INT tự điền lại đúng số đã nhập lần trước (đã lưu vào `Case.taxIntByYear`), không phải gõ lại.
7. Kiểm tra email nhận được: subject đúng định dạng `[XX-YY TAX REFUND] Tên - Phone`, nội dung đúng ngôn ngữ đã chọn, số tiền từng năm = refund năm đó trừ Tax INT đã nhập, có ảnh đại diện người gửi (nếu tài khoản đó có avatar) và banner Tax Credit Funder ở cuối chữ ký, tên/email/chức danh/phone/địa chỉ đúng.
8. Vào trang Phân quyền → "Cấu hình email khách hàng" → xác nhận dialog giờ chỉ còn Cc + 4 ô (Chức danh/Phone/Địa chỉ chữ ký/Số Customer Service), không còn ô Subject/Body/Signature tự do → sửa thử Chức danh → gửi lại thư ở bước 5 → xác nhận chữ ký cập nhật đúng chức danh mới.

### 4.26 [CHỜ XỬ LÝ] Ô "Note" trong popup "Edit Hồ sơ" — ghi chú tự do đặt dưới khối Taxpayer/Spouse (thêm 2026-08-16)

Bố cục popup "Edit Hồ sơ" (`ClientProfileDialog`) từng để trống 1 khoảng dưới 2 khối Taxpayer/Spouse (chỉ có 4 field mỗi khối, ngắn hơn cột bên phải) — thêm `Case.note` (cột mới, `String?`, additive) + 1 cột ẩn mới `note` vào `DEFAULT_COLUMNS` (cùng nhóm quyền với `bankName`/`refunds`: `manager`, `accounting`, `agent`, `processor`, `agent_leader`, `processor_leader`) để lấp đúng khoảng trống đó bằng 1 `<textarea>` span 2 cột. **Không liên quan cột "description" (Mô tả, có reply threading) đã có sẵn ngoài bảng chính** — đây là ghi chú tự do riêng, chỉ sửa qua popup này. Đúng loại thay đổi mô tả ở mục 4.8 (thêm cột ẩn mới cho popup "Edit Hồ sơ", giống mục 4.11/4.23/4.25).

**Đã tự gặp đúng lỗi mô tả ở mục 4.8 khi test ở local**: sau khi thêm cột vào `DEFAULT_COLUMNS`, `AppConfig.columns` trên DB dev (đã seed từ trước) KHÔNG tự có cột `note` mới này → ô Note hiện disabled/khoá xám dù đăng nhập bằng manager. Đã vá bằng script merge cộng dồn (thêm đúng 1 object cột `note` vào mảng `columns` hiện có, không đụng cột nào khác) — **PHẢI làm lại y hệt trên production**. Cũng đã tự gặp lại đúng gotcha "Prisma Client staleness" mô tả ở đầu file (`npx prisma migrate dev` không tự in log "Generated Prisma Client" lần này) — phải chạy thêm `npx prisma generate` + restart hẳn dev server (kill process cũ đang giữ Prisma Client cũ trong bộ nhớ, `rm -rf .next`) thì API mới hết lỗi 500 khi lưu field `note`.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-16** — `prisma migrate deploy` nhắm production đã chạy (1 cột mới `note` trên `cases`).
2. ✅ **Đã xong 2026-08-16** — script merge đã chạy, xác nhận cột `note` đã có trong `AppConfig.columns` production.
3. [CHỜ XÁC NHẬN QUA UI] Đăng nhập production bằng tài khoản **không phải Manager** (vd Processor/Agent), mở popup "Edit Hồ sơ" 1 hồ sơ bất kỳ → xác nhận ô "Note" hiện ngay dưới khối Taxpayer/Spouse, **enable được** (không khoá xám) đúng theo quyền đã cấu hình.
4. Gõ thử nội dung ghi chú, bấm Lưu → reload trang, mở lại popup → xác nhận nội dung còn nguyên.

### 4.27 [CHỜ XỬ LÝ] Nút "Send email to client" — dựng lại thành preview→soạn mail→gửi + trạng thái "đã gửi" bền vững (thêm 2026-08-16)

Viết lại luồng gửi email "Thông báo hoàn thuế": trước đây bấm "Send" ở popup chọn năm là gửi ngay, không có trạng thái "đã gửi" bền vững (chỉ tick xanh tạm 5s). Giờ:
1. Popup chọn năm: ô Tax INT hiện NGAY DƯỚI năm vừa chọn (bôi vàng nổi bật), thêm nút phụ "Đánh dấu đã gửi" (giống TestSheetButton).
2. Nút "Send" đổi thành "Xác nhận"/"Confirm" — gọi `POST /api/cases/[id]/refund-email-preview` (route MỚI, không lưu/gửi gì) dựng sẵn Subject + nội dung, mở màn hình "soạn mail" (Subject input + `MailBodyEditor` rich text) cho sửa tự do trước khi gửi thật (quyết định sản phẩm rõ ràng — không phải preview chỉ xem).
3. Nút "Send" ở màn hình soạn mail mới thật sự gọi `POST /api/cases/[id]/send-client-email` (route đổi payload — nhận thẳng `subject`/`bodyHtml` đã sửa thay vì tự build lại từ template).
4. Gửi thật/"Đánh dấu đã gửi" đều lưu `Case.clientEmailSentAt` (cột mới, additive, cùng cơ chế `sheetSentAt`/`cpaEmailSentAt`/`cpaReviewTestSentAt`) — icon chuyển xanh bền vững qua reload, bấm lại lúc xanh hỏi "muốn gửi lại?" giống 3 nút kia.

**Đây CHỈ là 1 cột `DateTime?` mới trên `Case`** (giống mục 4.13/4.14/4.19/4.24) — **KHÔNG đụng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`/`AppConfig`** nên **không cần** script merge `AppConfig`, chỉ cần migration. Route mới `refund-email-preview` dùng lại đúng feature `sendClientEmail` đã có (không thêm feature key nào).

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-16** — `prisma migrate deploy` nhắm production đã chạy (1 cột mới `clientEmailSentAt` trên `cases`).
2. [CHỜ XÁC NHẬN QUA UI, cần đã kết nối webmail trước — xem mục 4.12 bước 3] Đăng nhập production bằng tài khoản có quyền `sendClientEmail` (mặc định Processor), mở 1 hồ sơ có email khách → bấm icon mail (đã chuyển ra bảng Hồ sơ chính, dưới icon Test Sheet — xem mục trước đó về việc dời nút này) → chọn 1-2 năm, gõ thử Tax INT → xác nhận ô Tax INT hiện đúng ngay dưới năm vừa chọn, bôi vàng.
3. Bấm "Xác nhận" → xác nhận mở màn hình soạn mail với Subject/Nội dung điền sẵn đúng dữ liệu hồ sơ → sửa thử 1 chỗ trong nội dung → bấm "Gửi" (nếu chưa kết nối webmail sẽ hiện dialog kết nối trước) → xác nhận gửi thành công, icon chuyển xanh.
4. Reload trang → xác nhận icon vẫn xanh (không mất trạng thái). Bấm lại icon xanh → xác nhận hiện popup "muốn gửi lại?" riêng, bấm "Có" → icon quay về mặc định.
5. Mở lại popup chọn năm, bấm "Đánh dấu đã gửi" (không qua màn hình soạn mail) → xác nhận icon chuyển xanh ngay, không có email nào thật sự được gửi.

### 4.28 [CHỜ XỬ LÝ] Tab "For Processor" — báo cáo công việc hằng ngày (Processor) + tổng hợp theo tháng (Processor Leader) + sync 2 chiều Google Sheet (thêm 2026-08-16)

Nút mới "For Processor" (icon `ClipboardList`) đặt cạnh EC Qualification trên bảng Hồ sơ, gate bằng feature `viewForProcessor` (mặc định `["processor","processor_leader"]`, KHÔNG rỗng). Bấm vào mở popup 2 tab: **Report** (đã triển khai) và **Document** (placeholder "sắp ra mắt", chưa có logic gì — quyết định của user 2026-08-16, sẽ làm sau khi có yêu cầu cụ thể).

Tab Report hiển thị khác nhau theo role: **Processor** thấy bảng nhập liệu CÁ NHÂN (hàng = task cố định theo mẫu Excel gốc, 6 nhóm ~25 task; cột = từng ngày trong tháng + cột tổng tuần W1/W2...), nhập số lượng trực tiếp. **Processor Leader/Quản lý** thấy bảng TỔNG HỢP (cùng hàng task, cột = từng Processor + cột TOTAL) — đây là số liệu TÍNH RA (sum), không gõ tay.

**Kiến trúc dữ liệu** — 2 tầng, giống cách CPA Review tách "record thật" khỏi "cache đẩy Sheet":
1. `ProcessorReportEntry` (Prisma mới) — số liệu thật Processor tự gõ: `(userId, taskId, date, value)`.
2. `ProcessorReportMonthlySummary` (Prisma mới) — cache tổng theo `(month, taskId, userId)`, tính lại đúng 1 ô mỗi khi 1 entry đổi (`recomputeAndPushProcessorReportSummary`, `src/lib/processor-report-sheet-sync.ts`), đồng thời đẩy đúng ô đó lên Sheet nếu tháng đã kết nối. Đây là thứ Leader nhìn thấy VÀ đồng bộ 2 chiều — **lưu ý ngữ nghĩa**: sửa tay 1 ô trên Sheet có hiệu lực ngay nhưng sẽ bị TÍNH LẠI đè lên ngay khi chính Processor đó sửa thêm entry của đúng task/tháng đó (khác CPA Review, nơi Sheet giữ đúng bản ghi gốc) — đã xác nhận đây là đánh đổi hợp lý cho dữ liệu tổng hợp.
3. `AppConfig.processorReportTasks` (Json?, additive) — danh sách task (hàng), Leader/Quản lý tự thêm/sửa/xoá qua UI (feature `manageProcessorReportTasks`, mặc định `[]`). null → fallback `DEFAULT_PROCESSOR_REPORT_TASKS` (rbac.ts).
4. `AppConfig.processorReportSheetConfig` (Json?, additive) — `Record<"YYYY-MM", ProcessorReportSheetConfig>`, mỗi tháng 1 Sheet riêng (cùng tinh thần `cpaReviewSheetConfig`). Khác CPA Review: hàng (task)/cột (processor) đều biết trước từ config app — connect/resync GHI layout (section header dùng công thức `=SUM(...)` Sheets tự tính, không phải app tự tính rồi ghi đè) rồi lưu `taskRowMap`/`userColumnMap`, không cần quét-tìm-dòng theo business key như SSN.

Sync 2 chiều dùng lại đúng Service Account đã cấu hình cho CPA Review (`GOOGLE_SERVICE_ACCOUNT_EMAIL`/`_PRIVATE_KEY`, KHÔNG cần env var mới) — xem `.claude/skills/google-sheet-sync/SKILL.md` cho kiến trúc chung, `src/lib/processor-report-sheet-sync.ts` cho phần riêng tính năng này.

**3 feature key mới**: `viewForProcessor` (`["processor","processor_leader"]`, KHÔNG rỗng — **bắt buộc** script merge production, xem mục 4.8), `manageProcessorReportTasks` + `manageProcessorReportSheet` (đều `[]`, **không bắt buộc** merge — Manager luôn bypass qua `hasFeature()`).

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-16** — `prisma migrate deploy` nhắm production đã chạy (2 bảng mới + 2 cột `AppConfig`).
2. ✅ **Đã xong 2026-08-16** — script merge đã chạy, xác nhận `viewForProcessor: ["processor","processor_leader"]`, `manageProcessorReportTasks: []`, `manageProcessorReportSheet: []` đã có trong `AppConfig.featurePermissions` production.
3. [CHỜ XÁC NHẬN QUA UI] Đăng nhập production bằng tài khoản **Processor** thật → xác nhận thấy nút "For Processor" cạnh EC Qualification, mở popup thấy đúng danh sách task 6 nhóm, nhập vài ô → reload xác nhận còn nguyên.
4. Đăng nhập bằng tài khoản **Processor Leader hoặc Manager** → xác nhận thấy bảng tổng hợp đúng cột theo từng Processor + TOTAL, số liệu khớp với bước 3. Thử thêm/sửa/xoá 1 task qua "Quản lý task" → xác nhận cả 2 bảng (Processor/Leader) cùng cập nhật.
5. Kết nối 1 Google Sheet test cho tháng hiện tại (nút "Kết nối Sheet" trong bảng Leader), dán Apps Script vào Extensions → Apps Script, chọn hàm `installProcessorReportTriggers` rồi Run → xác nhận cấp quyền + cài trigger thành công.
6. Sửa 1 ô trong app (từ phía Processor) → xác nhận Sheet cập nhật trong vài giây. Sửa trực tiếp 1 ô số trên Sheet (đúng dòng task/cột processor) → mở lại (hoặc đóng/mở lại) popup "For Processor" phía Leader → xác nhận số đã cập nhật (KHÁC CPA Review — popup này CHƯA wire Pusher realtime, phải tự mở lại/F5 mới thấy thay đổi từ Sheet, không tự động như tab CPA Review).
7. Đăng nhập bằng tài khoản KHÔNG có `viewForProcessor` (vd Support/Agent mặc định) → xác nhận KHÔNG thấy nút "For Processor".

### 4.29 [CHỜ XỬ LÝ] Nút "Send Collecting Report" trước mỗi năm trong popup "Refund by years" (thêm 2026-08-16, mở rộng cùng ngày)

Nút mới (icon `Send`) đặt ngay trước nhãn năm trong popup "Refund by years" (nút mắt cạnh cột Case, `CaseRefundStatusButton`) — bấm vào mở 1 popup nhập tay (`SendCollectingReportDialog`) gồm Program (EC/1099), Tax Offset (Yes/No — Yes lưu thẳng chuỗi "X" vào cột `taxOffset`, cột kiểu text nên hiển thị đúng dấu X trên bảng Collecting không cần đổi type/logic render), Approved amt, Upfront fee, Total Collected, Payment method (Zelle/Check/Venmo/Cash/Credit), Note, Tip, Receipt/Check #, Receipt/Check Amt. — bấm "Xác nhận" tạo 1 dòng MỚI trong tab "Collecting" từ dữ liệu hồ sơ hiện có + các trường vừa nhập (`buildCollectingCustomFromCase`, `src/lib/case-to-collecting.ts`, chạy ở SERVER trong route `POST /api/cases/[id]/send-collecting-report`). Các trường suy ra được trực tiếp từ Case (không có trong popup): Date, Name, Phone, Agent 1/2 (tên hiển thị resolve từ `assignedTo`/`assignedTo2`), ACCT (lấy từ `Case.accountantSupport`), Year, Qual. Amount (= refund đúng năm đó).

**2 ô mới "Accountant"/"Accountant Support"** thêm vào popup "Edit Hồ sơ" (`ClientProfileDialog`, cạnh khối 3 ô ngân hàng) — `Case.accountant`/`Case.accountantSupport` (2 cột mới, additive, migration `20260816065929_add_case_accountant_fields`) + 2 cột ẩn mới cùng nhóm quyền với `bankName`/`note` trong `DEFAULT_COLUMNS` — đúng loại thay đổi mô tả ở mục 4.8/4.23/4.25/4.26, **BẮT BUỘC** script merge `AppConfig.columns` production (đã tự gặp lại đúng lỗi "khoá xám dù đăng nhập Manager" ở local khi test, vá bằng script merge cộng dồn 2 cột này). `accountantSupport` là cột DUY NHẤT trong 2 cột này được dùng ở nơi khác (tự đổ vào ACCT khi gửi Collecting Report) — `accountant` hiện chỉ lưu lại.

Dùng lại đúng feature `addCollectingRow` đã có sẵn cho quyền bấm nút Send — không thêm feature key mới, không đổi `DEFAULT_FEATURE_PERMISSIONS`. Không có trạng thái "đã gửi" bền vững — mỗi lần bấm luôn tạo 1 dòng Collecting mới (khác Test Sheet/Send to Sheet), có thể bấm cho nhiều năm khác nhau của cùng 1 hồ sơ, mỗi lần được nhập tay riêng.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-16** — `prisma migrate deploy` nhắm production đã chạy (2 cột mới `accountant`/`accountantSupport` trên `cases`).
2. ✅ **Đã xong 2026-08-16** — script merge đã chạy, xác nhận 2 cột `accountant`/`accountantSupport` đã có trong `AppConfig.columns` production.
3. [CHỜ XÁC NHẬN QUA UI] Đăng nhập production bằng tài khoản không phải Manager, mở popup "Edit Hồ sơ" 1 hồ sơ bất kỳ → xác nhận 2 ô "Accountant"/"Accountant Support" hiện enable được (không khoá xám) → điền thử + Lưu → reload xác nhận còn nguyên.
4. Đăng nhập bằng tài khoản có quyền `addCollectingRow` (mặc định chỉ Manager) hoặc cấp thêm cho role khác qua trang Phân quyền → mở popup "Refund by years" (nút mắt) ở hồ sơ vừa điền Accountant Support → bấm icon Send ở 1 năm → điền thử vài trường (Program, Tax Offset = Yes, Approved amt...) → Xác nhận → vào tab "Collecting" → xác nhận dòng mới có ACCT đúng = Accountant Support vừa điền, cột Tax Offset hiện dấu "X", các trường khác khớp đã nhập.
5. Đăng nhập bằng tài khoản KHÔNG có `addCollectingRow` (vd Processor mặc định) → mở popup "Refund by years" → xác nhận KHÔNG thấy icon gửi trước mỗi năm.

### 4.30 [CHỜ XỬ LÝ] Nhắn/nhận tin nhắn SMS theo hồ sơ (RingCentral) (thêm 2026-08-17)

Icon tin nhắn (`MessageCircle`, `CaseSmsButton`) đặt NGAY DƯỚI icon "Send Data" cạnh Status trên bảng Hồ sơ — bấm mở popup dạng chat đơn giản (danh sách bong bóng tin nhắn + ô nhập gửi) theo ĐÚNG số điện thoại chính (`Case.phone`) của hồ sơ đó. Icon nhấp nháy đỏ (`hasUnreadSms`, class `.sms-unread-pulse` — dùng lại animation `refund-eye-pending` có sẵn) khi có tin nhắn "in" (khách nhắn tới) CHƯA đọc khớp `phone`/`phone2` hồ sơ này.

**Kiến trúc**: dùng CHUNG 1 số điện thoại công ty (RingCentral, JWT server-to-server — KHÔNG phải OAuth2 theo từng user như webmail/Google) cho MỌI user gửi đi, xem `src/lib/ringcentral.ts`. Bảng mới hoàn toàn `SmsMessage` (giống mục 4.15/4.18-phần-1 — KHÔNG liên kết Case bằng foreign key, khớp theo `counterpartNumber` E.164 với `phone`/`phone2` mỗi lần đọc, xem `src/lib/phone.ts` cho hàm chuẩn hoá). `CaseRecord.hasUnreadSms` là field **tính toán** ở `GET /api/cases` (KHÔNG lưu cột riêng trên `Case`), nên **không cần** script merge `AppConfig`.

**Nhận tin nhắn đến real-time**: RingCentral subscription webhook (`POST /api/ringcentral/webhook`) — nhưng payload push CHỈ báo "có thay đổi" (KHÔNG kèm nội dung SMS thật), route tự gọi lại `GET /message-store` lấy tin nhắn mới (`fetchRecentInboundSms`), lưu (bỏ qua nếu trùng `ringcentralMessageId`), rồi bắn lại tín hiệu Pusher `case:changed` CÓ SẴN (không tạo kênh mới) để bảng Hồ sơ ở mọi trình duyệt tự refetch. Subscription RingCentral chỉ sống tối đa ~7 ngày, cần tự gia hạn định kỳ qua `POST /api/config/ringcentral` (manager-only, tạo/gia hạn subscription trỏ vào đúng webhook URL — origin tự build từ chính request, KHÔNG hard-code domain).

Gồm ĐỦ 3 loại thay đổi mô tả ở mục 4.8/4.9-4.12/4.15:
1. **Bảng mới hoàn toàn** `SmsMessage` (giống mục 4.15/4.18-phần-1/4.20-phần-1) + 2 field mới trên `AppConfig` (`ringcentralSubscriptionId`/`ringcentralSubscriptionExpiresAt`, lưu trạng thái subscription) — **không cần** script merge `AppConfig.columns`/`featurePermissions`, chỉ cần migration.
2. **Feature key mới `sendSms`** (mặc định KHÔNG rỗng: `["agent","processor","agent_leader","processor_leader"]`, giống mục 4.21 `viewCollecting`) — **BẮT BUỘC** chạy script merge cộng dồn thêm `sendSms` vào `AppConfig.featurePermissions` production, nếu không 4 role trên sẽ KHÔNG thấy icon SMS trên production dù code đã đúng (fallback runtime là `?? []`, không phải mảng mặc định mong muốn).
3. **6 biến môi trường mới**: `RINGCENTRAL_CLIENT_ID`/`RINGCENTRAL_CLIENT_SECRET`/`RINGCENTRAL_JWT`/`RINGCENTRAL_SMS_FROM_NUMBER`/`RINGCENTRAL_SERVER_URL` — thiếu bất kỳ biến bắt buộc nào (4 biến đầu, `SERVER_URL` có default) thì `isRingCentralConfigured()` trả `false`, các route liên quan tự trả lỗi rõ ràng (501 "Chưa cấu hình RingCentral") thay vì crash.

**Đã tự kiểm tra ở local (2026-08-17)** trước khi giao: xác thực JWT thật (token exchange trả 200, access token hợp lệ) + xác nhận số điện thoại `RINGCENTRAL_SMS_FROM_NUMBER` có bật tính năng `SmsSender` trên tài khoản RingCentral thật của công ty. Gửi thử 1 SMS thật (từ số công ty tới CHÍNH số công ty, an toàn — không phiền ai) qua UI, xác nhận tin nhắn xuất hiện đúng trong khung chat, lưu lại đúng sau reload.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-17** — `prisma migrate deploy` nhắm production đã chạy (tạo bảng `sms_messages` mới + 2 cột `ringcentralSubscriptionId`/`ringcentralSubscriptionExpiresAt` trên `app_config`).
2. ✅ **Đã xong 2026-08-17** — script merge đã chạy (dry-run rồi ghi thật, xác nhận lại lần 2 idempotent), `sendSms: ["agent","processor","agent_leader","processor_leader"]` đã có trong `AppConfig.featurePermissions` production.
3. ✅ **Đã xong 2026-08-17** — đã thêm đủ 5 biến `RINGCENTRAL_*` vào Vercel Environment Variables (Production) + redeploy. **Gotcha thật đã gặp**: JWT credential đầu tiên tạo trên Developer Console bị lỗi **OAU-473 "The client [...] is not allowed to use this personal API Key"** khi test trên production (dù test local trước đó pass) — nguyên nhân là lúc tạo JWT đã "Restrict to app" nhầm sang app khác, không phải app "DirectFunder" (Client ID `91MM0Pc3yhwfwPzIp8Ce2c`). Cách vá: tạo lại JWT mới, chọn ĐÚNG app "DirectFunder" ở bước restrict — nếu sau này JWT hết hạn/cần tạo lại, nhớ kiểm tra kỹ bước chọn app này.
4. ✅ **Đã xong 2026-08-17** — đăng nhập production bằng tài khoản **manager** thật, gọi `POST /api/config/ringcentral` qua DevTools Console → trả về `{ok:true, subscriptionId:"85cd25ed-7ad8-4dc2-aaa7-def8a87b84d3", subscriptionExpiresAt:"2026-08-24T07:14:07.341Z"}` — webhook nhận SMS đến đã kích hoạt, hết hạn 2026-08-24 (cần gia hạn trước ngày đó, xem mục 7).
5. [CHỜ XÁC NHẬN QUA UI] Đăng nhập production bằng tài khoản có quyền `sendSms` (vd Processor), mở 1 hồ sơ có số điện thoại → xác nhận thấy icon tin nhắn dưới icon Send Data, bấm mở → gửi thử 1 tin nhắn TỚI CHÍNH SỐ CÔNG TY (không gửi cho khách thật lúc test) → xác nhận gửi thành công, hiện đúng trong khung chat.
6. [CHỜ XÁC NHẬN QUA UI] Nhắn 1 tin nhắn SMS THẬT tới đúng số RingCentral công ty (từ điện thoại cá nhân bất kỳ) → đợi vài giây → xác nhận icon tin nhắn ở hồ sơ có `phone` khớp đúng số vừa nhắn (nếu có) tự nhấp nháy đỏ KHÔNG cần F5 (dựa vào tín hiệu Pusher `case:changed` có sẵn) — nếu hồ sơ chưa tồn tại/không khớp số nào, tin nhắn vẫn được lưu vào `SmsMessage` (không mất), chỉ chưa hiện icon đỏ ở đâu cho tới khi có hồ sơ khớp số đó.
7. ✅ **Code đã xong 2026-08-17** — thêm `vercel.json` (Vercel Cron, chạy mỗi ngày 00:00 UTC) gọi `GET /api/cron/ringcentral-renew` tự gia hạn subscription (xác thực bằng `CRON_SECRET`, không bao giờ để gần tới ngưỡng hết hạn 7 ngày nữa). Đã test local: chặn đúng 401 khi thiếu/sai `CRON_SECRET`, gọi đúng RingCentral API khi đúng secret (chỉ fail vì "WebHook is not reachable" do localhost không public — đúng dự kiến). **[CHỜ LÀM TRÊN VERCEL]**: (a) thêm biến `CRON_SECRET` vào Environment Variables (Production) — sinh bằng `openssl rand -hex 24`, (b) redeploy để `vercel.json` có hiệu lực (Vercel Cron chỉ đăng ký khi có trong bản deploy), (c) vào tab **Cron Jobs** trong project Vercel kiểm tra thấy job `/api/cron/ringcentral-renew` đã liệt kê, (d) sau lần chạy đầu tiên (00:00 UTC hoặc bấm "Run" thủ công trong tab đó nếu Vercel hỗ trợ), kiểm tra lại `subscriptionExpiresAt` qua `GET /api/config/ringcentral` (Console, đăng nhập Manager) đã tự đẩy lùi thêm ~7 ngày.

### 4.31 [CHỜ XỬ LÝ] Tab "Notice Splitter" trong popup "For Processor" — tách 1 file PDF gộp nhiều thư IRS thành 1 file/khách hàng (thêm 2026-08-18, dời vào popup cùng ngày)

Tính năng mới, độc lập hoàn toàn với bảng Hồ sơ (không đọc/ghi `Case` nào) — port từ 1 package Node độc lập (`irs-notice-splitter/`, người dùng cung cấp làm tài liệu tham khảo, ĐÃ XOÁ khỏi repo sau khi port xong) vào `src/lib/irs-splitter/`. **Bản đầu tiên (cùng ngày) là 1 tab riêng trên top-nav (`/dashboard/notice-splitter`) — đã dời vào làm tab thứ 3 ("Notice Splitter", cạnh "Report"/"Document") trong popup "For Processor" (`for-processor-dialog.tsx`, mở qua nút cạnh EC Qualification trên bảng Hồ sơ) theo yêu cầu, không còn route/nav riêng nữa.** Nội dung UI (chọn file, bảng soát/sửa, nút tách & tải) nằm trong `src/components/notice-splitter-panel.tsx` (`NoticeSplitterPanel`), tách riêng khỏi `for-processor-dialog.tsx` để file đó đỡ phình to.

**[ĐÃ GỠ BỎ 2026-08-19] "Nén PDF"** — từng có 1 tab con nhỏ THỨ 2 bên trong `NoticeSplitterPanel` (cạnh "Tách thư", thêm 2026-08-18), nén 1 file PDF xuống dưới ngưỡng byte cố định (1MB rồi 3MB) bằng cách rasterize từng trang thành ảnh JPEG. Toàn bộ đoạn mô tả bên dưới (kiến trúc chunk theo trang, cắt riêng từng trang gửi trực tiếp, cron dọn Blob liên quan tới nó...) **CHỈ CÒN GIÁ TRỊ LỊCH SỬ** — đã xoá hẳn `pdf-compress-panel.tsx`, `src/lib/pdf-compress/`, route `compress-chunk`, route `blob-delete`, dependency `@napi-rs/canvas`, và mọi i18n key `compressPdf.*`/`irsSplitter.subTab*` liên quan sau khi thử nhiều vòng vá (chunk theo khoảng trang → 1 trang/lần gọi → cắt trang gửi trực tiếp thay vì tải lại từ Blob) vẫn không đủ tin cậy trên gói Hobby (lần lượt gặp timeout 55s, 504 FUNCTION_INVOCATION_TIMEOUT, rồi 403 khi tải Blob), và ngay cả khi chạy được, file nhiều trang vẫn thường không đạt ngưỡng dưới 3MB ở chất lượng đọc được.

**[ĐỔI KIẾN TRÚC HOÀN TOÀN 2026-08-19, cùng ngày, sau khi gỡ "Nén PDF"] Tab "Tách thư" (phần còn lại của Notice Splitter) chuyển sang xử lý 100% TRÊN TRÌNH DUYỆT — không còn server route/Vercel Blob nào nữa cho tính năng này.** Trước đây: client upload file gốc lên Vercel Blob → route `analyze`/`split` tải lại bytes, dùng `pdfjs-dist` bản Node (`legacy/build/pdf.js`) trích text + `pdf-lib`/`jszip` tách/đóng gói ở server. Giờ: TOÀN BỘ pipeline (trích text, nhận diện ranh giới thư, tách trang, đóng gói zip) chạy ngay trong trình duyệt người dùng — file PDF scan gốc (có thể chứa SSN) **không bao giờ rời khỏi máy người dùng nữa**. Lý do đổi: loại bỏ hẳn lớp rủi ro timeout/504 của gói Hobby (không còn `maxDuration` nào áp dụng vì không có server round-trip), và tăng tính riêng tư (không upload dữ liệu nhạy cảm lên đâu cả).

- **Đã xoá hẳn**: route `POST /api/irs-splitter/analyze`, `POST /api/irs-splitter/split`, `POST /api/irs-splitter/blob-upload` (toàn bộ `src/app/api/irs-splitter/`); lib phía server `extract-text.ts` (bản Node của pdfjs-dist), `fetch-blob-pdf.ts`, `with-timeout.ts`, `client-pdf-upload.ts`, `index.ts` (wrapper orchestration cũ). Còn giữ nguyên (pure logic, isomorphic, giờ chỉ chạy client-side): `detect-records.ts`, `split-pdf.ts`, `care-of-eligibility.ts`, `types.ts`.
- **Mới thêm**: `src/lib/irs-splitter/extract-text-browser.ts` (bản trình duyệt của trích text — dùng `pdfjs-dist/build/pdf` KHÔNG PHẢI `legacy/build/pdf.js`, lazy-import + Web Worker qua pattern `new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url)` để Turbopack tự đóng gói file worker thành asset tĩnh).
- **Gotcha gặp lại (giống hệt lỗi `require("canvas")` đã gặp với bản Node trước đây, NHƯNG lần này ở bản browser)**: `pdfjs-dist/build/pdf.js` (không chỉ bản `legacy`) vẫn có 1 nhánh nội bộ `NodeCanvasFactory._createCanvas()` gọi `require("canvas")` — chỉ dùng khi RENDER bitmap (`page.render()`), tính năng này chỉ trích text (`getTextContent()`) nên không bao giờ chạm nhánh đó, nhưng Turbopack vẫn cố resolve tĩnh package "canvas" (native, không cài) lúc bundle CLIENT và lỗi cứng `Module not found: Can't resolve 'canvas'`. Cách vá: `turbopack.resolveAlias` trong `next.config.ts` alias `"canvas"` sang stub rỗng `src/lib/irs-splitter/canvas-stub.ts` — khác `serverExternalPackages` (dùng cho bundle SERVER, đã bỏ hẳn vì không còn route server nào import pdfjs-dist).
- **Type declaration bổ sung**: `pdfjs-dist` không kèm sẵn `.d.ts` cạnh `build/pdf.js` (chỉ có ở `legacy/build/pdf.d.ts`, nội dung `export * from "pdfjs-dist";`) — thêm `src/lib/irs-splitter/pdfjs-build.d.ts` khai báo lại y hệt cho subpath `build/pdf` để `tsc` resolve đúng type (không ảnh hưởng bundler resolve file JS thật lúc build).
- **Đã tự kiểm tra đầy đủ (2026-08-19)** qua Playwright thật (không phải chỉ type-check): dựng 1 trang test tạm `src/app/test-notice-splitter/` (đã XOÁ trước khi commit) render thẳng `NoticeSplitterPanel` không qua đăng nhập, upload 1 file PDF 3 trang giả lập 2 thư IRS (CP504 2 trang có care-of, CP521 1 trang không) — xác nhận: nhận diện đúng "3 trang" + đúng 2 dòng record đúng khoảng trang/loại thư, bấm "Tách & tải xuống" tải về đúng 1 file `.zip`, KHÔNG có lỗi console nào liên quan Worker (chỉ 1 warning vô hại "fetchStandardFontData... standardFontDataUrl" — không chặn chức năng, do không cấu hình font chuẩn nhưng tính năng chỉ trích text nên không cần). Đã chạy thêm `next build` thật (production build, không chỉ `next dev`) xác nhận build sạch hoàn toàn, không lỗi resolve "canvas". `tsc --noEmit`/`eslint` sạch.
- **Gotcha ngoài lề gặp khi test (không liên quan code)**: giữa lúc test, OneDrive (thư mục dự án nằm trong `OneDrive\Máy tính\...`) bị user tạm dừng đồng bộ đúng lúc file đang dở dang tải/dehydrate, khiến toàn bộ file gốc (`package.json`, `.git/HEAD`...) tạm thời "biến mất" khỏi ổ đĩa dù `.git/objects` vẫn còn nguyên — khôi phục bằng cách resume/restart OneDrive, không mất dữ liệu gì (git log local vẫn khớp `origin/main`). Nếu gặp lại triệu chứng "file dự án tự nhiên biến mất" tương tự, kiểm tra trạng thái đồng bộ OneDrive TRƯỚC KHI nghi ngờ git/filesystem bị hỏng.
- **Feature permission `useIrsNoticeSplitter` giữ nguyên không đổi** (đã merge vào production từ trước, xem checklist cũ bên dưới) — vẫn gate hiển thị tab ở UI như cũ, chỉ khác là giờ đây là enforcement DUY NHẤT (không còn kiểm tra lại ở server vì không còn route server nào) — chấp nhận được vì không có dữ liệu nào rời khỏi trình duyệt người dùng nữa (khác các tính năng gửi mail/sync Sheet, nơi server luôn phải enforce vì dữ liệu thật sự đi qua server).
- **Không cần bước production nào cho lần đổi kiến trúc này** — không đổi schema, không đổi feature-permission, không cần env var mới. Chỉ cần deploy code. **Các bước checklist production cũ bên dưới (đánh số 1-10, nhắc tới Vercel Blob/route `analyze`/`split`) đã LỖI THỜI cho phần "Tách thư"** — bỏ qua các bước liên quan tới Blob/413/504 khi verify lại trên production, chỉ cần xác nhận: đăng nhập, mở tab Notice Splitter, upload 1 file PDF thật, xác nhận bảng soát hiện đúng + tải zip được, không cần quan tâm gì tới Vercel Blob Dashboard nữa cho tính năng này (Blob dashboard giờ chỉ còn liên quan tới "Send mail to CPA", xem mục 4.32).

- Render dùng `pdfjs-dist` (cùng bản `3.11.174` đã ghim cho Notice Splitter) qua 1 `canvasFactory` tự viết dựng trên `@napi-rs/canvas` (`src/lib/pdf-compress/node-canvas-factory.ts` — binary dựng sẵn theo platform, KHÔNG cần compile Cairo như package `canvas` gốc pdfjs mặc định đòi hỏi). Encode JPEG dùng thẳng API built-in của `@napi-rs/canvas` (`canvas.toBuffer("image/jpeg", quality)`, quality thang 0-100 đã tự đo bằng script) — **KHÔNG cần thêm `sharp`** (đã cài rồi gỡ lại sau khi phát hiện không cần).
- `next.config.ts`: thêm `@napi-rs/canvas` vào `serverExternalPackages` (cùng lý do `pdfjs-dist` — binary native, không để Turbopack cố bundle tĩnh).

**Gotcha thật gặp trên production (2026-08-18, cùng ngày) — kiến trúc CHUNKED, thay hẳn bản đầu (route `/api/irs-splitter/compress` xử lý trọn file trong 1 lần gọi, ĐÃ XOÁ)**: với file 15 trang/48MB (~3.2MB/trang, scan độ phân giải cao), riêng bước GIẢI MÃ ảnh gốc của các trang cộng dồn vượt quá 60s — xác nhận qua log Vercel `Runtime Timeout Error: Task timed out after...` (Vercel **tự cắt cứng** ở `maxDuration`, không phải bug code). Đã thử 2 lượt tối ưu tốc độ thuật toán (chọn DPI bắt đầu theo dung lượng/trang + dừng sớm giữa 1 lượt DPI) nhưng KHÔNG đủ — bản chất chi phí giải mã ảnh gốc độ phân giải cao là CỐ ĐỊNH theo từng trang, không giảm được bằng cách hạ DPI đích (DPI đích chỉ ảnh hưởng bước RASTERIZE/ENCODE, không ảnh hưởng bước DECODE nguồn).

**Giải pháp cuối cùng — xử lý theo KHOẢNG TRANG qua nhiều lần gọi server**, thay vì 1 lần gọi xử lý trọn file:
- `src/lib/pdf-compress/compress-pdf.ts` chỉ còn 1 hàm `renderPageRangeToJpegs(pdfData, startPage, endPage, dpi, perPageBudgetBytes)` — render + encode ĐÚNG 1 khoảng trang (không phải cả file), trả về mảng `{pageIndex, jpegBase64}`. Đây là đơn vị xử lý nhỏ nhất, luôn nằm trong 1 lần gọi server.
- Route `src/app/api/irs-splitter/compress-chunk/route.ts` (thay cho route `compress` cũ đã xoá) — nhận `{blobUrl, startPage, endPage, dpi, perPageBudgetBytes}`, gọi `renderPageRangeToJpegs`, trả JSON. Vẫn `maxDuration=60` + `withTimeout` nội bộ 50s (an toàn cho từng khoảng trang, gần như không bao giờ chạm mốc này nữa vì mỗi lần gọi giờ chỉ xử lý 2-8 trang).
- **Toàn bộ điều phối (chia khoảng trang, thử giảm dần DPI, RÁP LẠI PDF CUỐI CÙNG) chuyển sang CLIENT** (`src/components/pdf-compress-panel.tsx`) — dùng `pdf-lib` NGAY TRÊN TRÌNH DUYỆT (pure JS, chạy được cả 2 phía, không cần thêm gì): đọc file gốc lấy `pageCount` + kích thước point từng trang TRƯỚC KHI upload (không cần hỏi server), gọi `/compress-chunk` nhiều lần (chạy song song giới hạn 3 lần cùng lúc — `CHUNK_CONCURRENCY`, giảm thời gian chờ thực tế), dừng sớm 1 lượt DPI ngay khi biết chắc vượt 1MB (bỏ qua các khoảng trang CHƯA bắt đầu, khoảng đang chạy dở vẫn cho hoàn thành), rồi tự `embedJpg`+`addPage`+`drawImage` ráp PDF cuối cùng và tải xuống — KHÔNG còn cần 1 route server "ráp file cuối" nữa.
- Số trang/lần gọi (`pickChunkPageCount`) và mức DPI bắt đầu (`pickStartDpiIndex`) đều thích ứng theo dung lượng trung bình/trang của file GỐC (file càng nặng/trang càng chia nhỏ hơn) — cùng heuristic đã dùng ở bản trước, chỉ chuyển từ server sang client.
- Route mới `src/app/api/irs-splitter/blob-delete/route.ts` — xoá blob sau khi client ráp xong (best-effort, gọi từ `finally` phía client) — cần route riêng vì giờ không còn 1 route server "cuối cùng" nào để tiện xoá kèm theo như route `split`.

**Gotcha #2 -- Vercel Blob KHÔNG có TTL/tự xoá (phát hiện qua quan sát thật: dung lượng Blob store tăng dần không giảm)**: mọi lần `del()` best-effort trong code (`split`, `blob-delete`) chỉ chạy khi thao tác HOÀN TẤT trọn vẹn -- nếu người dùng đóng tab/mất mạng/gặp lỗi giữa chừng (đã xảy ra nhiều lần thật trong lúc debug các mục ở trên), blob đó mồ côi VĨNH VIỄN, không có cơ chế nào tự dọn. Đã thêm cron dọn rác `src/app/api/cron/blob-cleanup/route.ts` (đăng ký trong `vercel.json`, chạy MỖI GIỜ, cùng cơ chế xác thực `CRON_SECRET` với `cron/ringcentral-renew` có sẵn -- KHÔNG cần thêm biến môi trường mới) -- `list()` toàn bộ blob trong store (phân trang qua `cursor`/`hasMore`), xoá hàng loạt (`del()` nhận mảng URL) mọi blob có `uploadedAt` cũ hơn 2 giờ (đủ rộng rãi so với thời gian xử lý thật, chỉ bắt đúng file mồ côi thật sự).
- **Đã tự kiểm tra lại (2026-08-18)** bằng script `tsx` mô phỏng ĐÚNG kịch bản đã gây lỗi thật: PDF 15 trang worst-case (nhiễu ngẫu nhiên, nặng HƠN cả file thật đã lỗi — nguồn 56.58MB, ~3.77MB/trang) → chia thành 8 khoảng (2 trang/khoảng) → mỗi khoảng render xong trong **1.5-6 giây** (so với timeout thật ở 60s trước đó) → ráp lại đúng 15 trang, mở lại file xác nhận không hỏng. Route `compress-chunk`/`blob-delete` gọi thật qua dev server (Turbopack) xác nhận build sạch, trả lỗi JSON đúng thiết kế với `blobUrl` không tồn tại. `tsc --noEmit`/`eslint` sạch. **Chưa test được qua UI trình duyệt thật** (đọc file bằng `pdf-lib` phía client, tải xuống cuối cùng) — chỉ test được phần lõi + route qua script/curl.
- Helper client dùng chung giữa 2 tab con được tách ra `src/lib/irs-splitter/client-pdf-upload.ts` (`uploadPdfToBlob`/`fetchWithTimeout`/`readErrorMessage`/`MAX_UPLOAD_BYTES`) — trước đó những hàm này định nghĩa riêng trong `notice-splitter-panel.tsx`, giờ dùng chung với `pdf-compress-panel.tsx` (component mới cho tab con "Nén PDF").
- **Không có bảng Prisma mới, không đổi feature-permission** — chỉ cần deploy code + `next.config.ts`, KHÔNG cần bước production nào khác (không cần merge `AppConfig`, không cần `prisma migrate deploy`).

**Đã tự kiểm tra ở local (2026-08-18)**: (1) script `tsx` độc lập dựng 1 PDF "nặng" giả lập (3 trang, mỗi trang 1 ảnh nhiễu ngẫu nhiên độ phân giải cao nhúng qua `pdf-lib` — nhiễu ngẫu nhiên là trường hợp KHÓ nén nhất, khó hơn nhiều so với thư scan thật) — nguồn 11.32MB nén xuống còn 899KB (`hitFloor: false`, dừng ở DPI 96), ~10.3s cho 3 trang nhiễu (tài liệu scan thật sẽ nhanh hơn nhiều vì nén tốt hơn); reload lại file output xác nhận đúng 3 trang, không hỏng. (2) Gọi thật qua route `/api/irs-splitter/compress` (dev server thật, Turbopack) với `blobUrl` không tồn tại → xác nhận route BUILD ĐƯỢC (không lặp lại lỗi `Module not found: Can't resolve 'canvas'` như đã gặp với `pdfjs-dist`/Notice Splitter) và trả lỗi JSON sạch đúng như thiết kế. **Chưa test được luồng upload Blob thật ở local** (thiếu `BLOB_READ_WRITE_TOKEN` cho môi trường dev) — dựa vào việc route dùng CHUNG cơ chế Blob đã verify hoạt động đúng trên production cho `analyze`/`split`. `tsc --noEmit`/`eslint` sạch trên toàn bộ file mới/sửa.

Cho upload 1 file PDF scan gộp nhiều thư IRS của nhiều khách hàng (từ máy scan văn phòng) — server đọc text từng trang (`pdfjs-dist` bản "legacy" CJS `3.11.174`, ghim cứng version thay vì dùng bản `6.x` ESM-only mới nhất vì bản mới yêu cầu Node ≥22.13 và không có build CJS tương thích chắc chắn với Vercel serverless), tự nhận diện ranh giới từng thư bằng 3 tín hiệu kết hợp (dòng "Page 1 of N", mã số sau địa chỉ văn phòng, mã số trong dòng metadata mã vạch thư — xem comment đầu `detect-records.ts`), đoán tên khách hàng/loại thư (CP504, CP521...)/tax year/cờ "gửi qua văn phòng thay vì thẳng khách hàng" (hasCareOf, quyết định hậu tố " Not Update CRM" trong tên file) cho mỗi thư.

**Gotcha về gate hiển thị nút mở popup**: nút "For Processor" (`ForProcessorButton`) trước đây CHỈ gate bằng `viewForProcessor` (mặc định `["processor","processor_leader"]`) — nhưng `useIrsNoticeSplitter` có nhóm role mặc định KHÁC (`["manager","accounting","processor"]`, có Kế toán nhưng KHÔNG có `viewForProcessor`). Đã sửa `ForProcessorButton` thành hiện nút nếu có **1 trong 2** quyền (OR, không phải AND) — nếu chỉ gate bằng `viewForProcessor` như cũ, Kế toán sẽ không bao giờ mở được popup dù có quyền dùng tab Notice Splitter bên trong. Bên trong popup, mỗi tab (Report/Document vs Notice Splitter) vẫn tự ẩn/hiện theo đúng quyền riêng của nó — 1 user chỉ có `useIrsNoticeSplitter` sẽ mở popup và chỉ thấy đúng 1 tab "Notice Splitter" (không thấy Report/Document), tab mặc định lúc mở cũng tự chọn đúng tab họ có quyền xem.

**Gotcha thật đã gặp trên production (2026-08-18, vá cùng ngày, sau khi vá xong bug Blob 413 ở trên)**: với file 48MB, sau khi Blob upload thành công, bước "Analyzing..." đứng yên MÃI không tự dừng/báo lỗi. Nguyên nhân: gói Vercel **Hobby** giới hạn CỨNG `maxDuration` ở 60 giây (không nâng được bằng code) — khi hàm bị Vercel cắt ngang ở mốc đó, trình duyệt KHÔNG nhận được response lỗi sạch (kết nối bị treo/reset), mà `fetch()` phía client lại KHÔNG có timeout mặc định → đứng chờ vô thời hạn. **Cách vá**: (1) cả 2 route `analyze`/`split` giờ tự đua xử lý với 1 timer nội bộ `PROCESSING_TIMEOUT_MS = 50_000` (`src/lib/irs-splitter/with-timeout.ts`, `withTimeout()`) — chủ động trả JSON lỗi 408 rõ ràng ở ~50s, SỚM HƠN mốc 60s Vercel tự cắt; (2) client (`notice-splitter-panel.tsx`) bọc mọi `fetch()` bằng `fetchWithTimeout()` (AbortController, 55s) làm lưới an toàn cuối cùng cho trường hợp kết nối bị treo/reset hoàn toàn không có response nào. **Giới hạn thật vẫn còn đó** (gói Hobby không nâng `maxDuration` được) — file quá lớn/quá nhiều trang (như file 48MB đã gặp) có khả năng vẫn timeout thật sự, chỉ khác là giờ báo lỗi rõ ràng ("Xử lý quá lâu... hãy thử chia nhỏ file trước khi tải lên") thay vì treo vô thời hạn. Nếu người dùng cần xử lý file cỡ này thường xuyên, cân nhắc nâng gói Vercel lên Pro (nâng `maxDuration` lên tới vài trăm giây) — đây là quyết định business/chi phí, không tự làm được.

**Thay đổi nghiệp vụ (2026-08-18, cùng ngày)**: hậu tố " Not Update CRM" (`hasCareOf`) trước đây tự động bật cho BẤT KỲ loại thư nào miễn có tín hiệu "%"/"C/O" trước địa chỉ văn phòng RA Solutions Corporation — giờ CHỈ áp dụng cho đúng 1 nhóm loại thư cụ thể: `CP89`, `CP289`, `CP521`, `CP523`, `CP01E`, `Letter 2273C`, `Letter 2840C`, `4458C` (danh sách whitelist `CARE_OF_ELIGIBLE_NOTICE_TYPES` trong `src/lib/irs-splitter/care-of-eligibility.ts`, file thuần logic không import pdfjs-dist/pdf-lib nên dùng an toàn cả ở client component). Loại thư khác dù có tín hiệu care-of vẫn bị ép về `false` — thực thi ở CẢ 2 lớp: (1) `detectRecords()` lúc quét tự động, (2) route `split` lúc nhận record đã soát/sửa từ client (không tin thẳng giá trị `hasCareOf` client gửi lên — phòng gọi API trực tiếp qua mặt UI). Client (`notice-splitter-panel.tsx`) khoá checkbox "Not Update CRM" (disabled + tooltip giải thích) cho loại thư ngoài whitelist, và tự bỏ tick nếu người dùng sửa notice type sang loại không nằm trong danh sách. Đồng thời bổ sung nhận diện dòng thư "Letter 2273C"/"Letter 2840C"/"4458C" (có hoặc không có chữ "Letter" đứng trước) vào `extractNoticeType()` — trước đó CHƯA nhận diện được nhóm này (chỉ nhận "LTR ###" kiểu số, không nhận "Letter" viết đầy đủ). Không đổi schema/feature-permission — chỉ cần deploy code, không cần bước production nào thêm. Đã tự test qua `tsx` với 4 case tổng hợp (CP504 không whitelist -> ép false; CP521/Letter 2273C/4458C có whitelist -> giữ true đúng theo tín hiệu care-of phát hiện được) — cả 4 khớp kỳ vọng.

**Gotcha #2 cùng ngày — hoá ra KHÔNG PHẢI server bị treo**: sau khi vá timeout ở trên, người dùng test lại vẫn thấy đứng hơn 50s KHÔNG hiện lỗi timeout. Nguyên nhân thật: cờ `analyzing` gộp chung 2 pha khác nhau — (a) UPLOAD file lên Vercel Blob (client-side, KHÔNG bị ràng buộc bởi `maxDuration` của route xử lý vì route đó chưa hề chạy) và (b) server phân tích PDF. Với file 48MB trên mạng không nhanh, RIÊNG bước upload đã có thể ngốn 50s+ — người dùng tưởng nhầm là server bị treo (vì UI chỉ hiện chung 1 dòng "Analyzing...") trong khi thực ra vẫn đang tải lên bình thường, chưa hề chạm tới route có `PROCESSING_TIMEOUT_MS`. **Cách vá**: tách riêng state `uploadProgress` (dùng `onUploadProgress` của `upload()` trong `@vercel/blob/client`) hiện % tiến trình THẬT + progress bar trong lúc upload, tách bạch rõ với trạng thái "Đang phân tích..." chỉ hiện SAU KHI upload xong — người dùng giờ thấy % tăng dần thay vì 1 spinner mù mờ không rõ đang ở bước nào. Đồng thời thêm `abortSignal` + timeout riêng 5 phút cho bước upload (`UPLOAD_TIMEOUT_MS`) làm lưới an toàn cuối, KHÁC với `CLIENT_FETCH_TIMEOUT_MS` (55s) chỉ áp cho 2 route xử lý phía sau.

**Luồng 2 bước, hoàn toàn không lưu trạng thái ở server** (không có model Prisma nào cho tính năng này — khác mọi tính năng trước đó trong file này): (1) `POST /api/irs-splitter/analyze` nhận `{blobUrl}` (xem gotcha Vercel Blob bên dưới), trả về danh sách "record" (khoảng trang + tên/loại thư/tax year/cờ care-of đoán được) để hiện bảng soát/sửa ở client — OCR/scan xấu có thể đọc sai tên hoặc bỏ sót tax year, người dùng tự sửa trực tiếp trong bảng trước khi tách; (2) `POST /api/irs-splitter/split` nhận `{blobUrl, fileName, records}` (client tự giữ `blobUrl` từ lúc upload, không upload lại lần 2) + danh sách record đã sửa, tách thành 1 file PDF/record rồi đóng gói vào 1 file `.zip` trả thẳng về cho trình duyệt tải xuống (dùng `jszip`, không dùng thư viện nén nào khác đã có sẵn trong repo), rồi xoá blob khỏi Vercel Blob. Cả 2 route `runtime = "nodejs"` (không chạy Edge — `pdfjs-dist`/`pdf-lib` cần Buffer/API Node đầy đủ) + `maxDuration = 60` (file nhiều trang xử lý lâu hơn mặc định 10s).

**Gotcha thật đã gặp trên production (2026-08-18, vá cùng ngày)**: file PDF nặng gây lỗi `413` kèm crash JSON parse phía client (`Unexpected token 'R', "Request En"...`). Nguyên nhân: Vercel áp giới hạn CỨNG ~4.5MB cho thân request của Serverless Function, chặn ở tầng edge/proxy TRƯỚC KHI request chạm route handler — không có cách nào nới từ code Next.js. **Cách vá triệt để** (không phải chỉ hiện lỗi rõ hơn): đổi sang **client upload PDF THẲNG lên Vercel Blob** (route mới `src/app/api/irs-splitter/blob-upload/route.ts`, dùng `handleUpload()` từ `@vercel/blob/client` — chỉ sinh token, thân request rất nhỏ nên không dính giới hạn 4.5MB; `upload()` từ cùng package chạy ở client, gửi file thẳng lên Blob, không qua route handler nào của app) — server chỉ nhận lại 1 URL nhỏ, `analyze`/`split` tự `fetch(blobUrl)` lấy bytes (server-to-server fetch không bị giới hạn thân request kiểu này, chỉ giới hạn bởi `maxDuration`). `split` xoá blob (`del()` từ `@vercel/blob`) ngay sau khi tách xong — best-effort, không chặn response nếu xoá lỗi. **Cập nhật (cùng ngày, sau khi quan sát dung lượng Blob tăng thật trên production)**: quyết định ban đầu "không cần TTL/cron dọn rác" đã SAI trong thực tế -- nhiều phiên upload bị bỏ dở lúc debug (lỗi/timeout/đóng tab) không bao giờ chạm tới bước `del()`, blob mồ côi cộng dồn. Đã thêm cron dọn rác `cron/blob-cleanup` (xem chi tiết ở mục 4.31 phần "Nén PDF" bên dưới, phần thêm sau) chạy mỗi giờ, xoá mọi blob cũ hơn 2 giờ trong TOÀN BỘ store (áp dụng chung cho cả Notice Splitter lẫn Nén PDF, không cần phân biệt tính năng nào tạo ra blob đó). Blob **KHÔNG** làm phình database Postgres/Neon — dịch vụ lưu trữ hoàn toàn tách biệt, tính phí riêng theo GB, và vì xoá ngay sau khi dùng nên dung lượng lưu ổn định gần 0 về lâu dài. Đã lưu pattern chung này thành skill `.claude/skills/vercel-blob-large-upload/SKILL.md` để tái dùng cho tính năng upload file lớn khác sau này. Lưu ý: `onUploadCompleted` (webhook Vercel gọi ngược lại sau khi client upload xong) KHÔNG hoạt động ở localhost (cần domain public) — không đặt logic quan trọng ở đó, cleanup thật đặt ở route `/split`.

Gồm ĐÚNG 1 loại thay đổi mô tả ở mục 4.8 (không có bảng Prisma mới, không có field `AppConfig` mới — **không cần `prisma migrate deploy`** cho tính năng này, khác hầu hết các mục trước):
- **Feature key mới `useIrsNoticeSplitter`** (mặc định KHÔNG rỗng: `["manager","accounting","processor"]`) — **BẮT BUỘC** chạy script merge cộng dồn thêm key này vào `AppConfig.featurePermissions` production, nếu không Kế toán/Processor trên production sẽ KHÔNG thấy tab dù code đã đúng (fallback runtime là `?? []`).

**Gotcha thật đã gặp lúc test**: chạy `analyzeIrsPdf()` trực tiếp qua Node (`tsx`) hoạt động bình thường, nhưng gọi qua route handler thật (Turbopack bundle) báo lỗi build cứng `Module not found: Can't resolve 'canvas'` — `pdfjs-dist` có 1 nhánh `NodeCanvasFactory._createCanvas()` gọi `require("canvas")` (chỉ dùng khi RENDER bitmap, không dùng tới khi chỉ trích text bằng `getTextContent()`), nhưng Turbopack/webpack vẫn cố resolve tĩnh nhánh đó lúc bundle dù không bao giờ thật sự chạy. Cách vá: thêm `serverExternalPackages: ["pdfjs-dist"]` vào `next.config.ts` (đánh dấu package này KHÔNG bundle, Node tự `require()` thẳng lúc chạy) — đây là cách khắc phục chuẩn theo tài liệu `pdfjs-dist` cho bundler, không phải hack riêng của repo này.

**Đã tự kiểm tra đầy đủ ở local (2026-08-18)** trước khi giao — SAU KHI vá gotcha `canvas` ở trên: khởi động lại Postgres (Docker) + merge `useIrsNoticeSplitter` vào `AppConfig.featurePermissions` DEV + chạy `npm run dev` thật, đăng nhập qua `POST /api/auth/login` (tài khoản Processor), gọi thật `POST /api/irs-splitter/analyze` với 1 file PDF mẫu 3 trang (dựng bằng `pdf-lib`) → nhận đúng 2 record/đúng khoảng trang/đúng notice type + tax year + tên khách hàng + cờ care-of; gọi thật `POST /api/irs-splitter/split` với record đó → tải về đúng 1 file `.zip` chứa đúng 2 file PDF, tên file đúng định dạng kèm hậu tố " Not Update CRM" cho record có `hasCareOf`, mở lại từng file PDF xác nhận đúng số trang. Đã xác nhận thêm: tài khoản role KHÔNG có `useIrsNoticeSplitter` (Support) gọi `analyze` bị chặn đúng 403. `tsc --noEmit` và `eslint` trên toàn bộ file mới/sửa đều sạch. **Chưa tự bấm qua giao diện trình duyệt thật** (chỉ test qua API trực tiếp bằng curl) — soát lại UI (bảng soát/sửa, nút tải zip) qua trình duyệt vẫn nên làm trước khi giao cho người dùng thật.

Thư mục gốc `irs-notice-splitter/` (do người dùng cung cấp làm tài liệu tham khảo, có `package.json`+`node_modules` riêng) đã được **XOÁ** khỏi repo (2026-08-18, người dùng xác nhận) sau khi logic được port đầy đủ vào `src/lib/irs-splitter/` — dòng ignore tạm thời thêm cho `irs-notice-splitter/node_modules` trong `.gitignore` cũng đã dọn lại cùng lúc.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. Chạy script merge cộng dồn thêm `useIrsNoticeSplitter: ["manager","accounting","processor"]` vào `AppConfig.featurePermissions` production — **bắt buộc**, xem giải thích ở trên. Không cần `prisma migrate deploy` (không đổi schema).
2. Trước khi test qua UI local, chạy local DB (Docker) + merge tương tự vào `AppConfig.featurePermissions` DEV (bảng seed cũ không tự có key mới, đúng gotcha mục 4.8 — sẽ thấy popup/tab bị ẩn kể cả với tài khoản Processor/Kế toán cho tới khi merge).
3. [CHỜ THAO TÁC TRÊN VERCEL DASHBOARD] Bật **Vercel Blob** cho project: Dashboard → Storage → Create Blob Store → Connect Project (chọn đúng project) — Vercel tự bơm biến `BLOB_READ_WRITE_TOKEN` vào Environment Variables production, KHÔNG cần tự thêm tay. Xác nhận biến đã xuất hiện trong Settings → Environment Variables sau khi connect + redeploy 1 lần để chắc chắn deployment mới nhất đọc được biến.
4. (Tuỳ chọn, chỉ cần nếu muốn test local) Local dev cần `BLOB_READ_WRITE_TOKEN` riêng trong `.env.local` — lấy qua `vercel link` rồi `vercel env pull .env.local`, hoặc copy tay từ Dashboard → Storage → Blob Store → tab ".env.local".
5. Đăng nhập bằng tài khoản **Kế toán** (có `useIrsNoticeSplitter` nhưng KHÔNG có `viewForProcessor`) → xác nhận vẫn thấy nút "For Processor" cạnh EC Qualification (nhờ gate OR mới) → mở popup → xác nhận CHỈ thấy đúng 1 tab "Notice Splitter" (không thấy Report/Document) và tab đó tự mở sẵn.
6. Đăng nhập bằng tài khoản **Processor** (có cả 2 quyền) → mở popup → xác nhận thấy đủ 3 tab Report/Document/Notice Splitter, tab Notice Splitter hoạt động: chọn 1 file PDF scan thật **NẶNG HƠN 4.5MB** (đúng trường hợp gây lỗi 413 trước đây) gộp nhiều thư IRS → xác nhận upload không lỗi, bảng soát hiện đúng số record gần đúng số thư thật trong file (ranh giới trang là phần đáng tin nhất theo README gốc), sửa thử 1-2 chỗ tên/tax year OCR đọc sai → bấm "Tách & tải xuống" → xác nhận file `.zip` tải về đúng số file PDF, mở thử 1-2 file xác nhận đúng trang/đúng nội dung thư.
7. Vào Vercel Dashboard → Storage → Blob Store → xác nhận file vừa test KHÔNG còn nằm trong danh sách (đã bị `del()` xoá ngay sau bước tách ở trên) — nếu vẫn còn, kiểm tra log route `/split` xem `del()` có lỗi gì không (không chặn response nên user không thấy lỗi này, chỉ lộ ra qua log).
8. Đăng nhập bằng tài khoản KHÔNG có cả 2 quyền `viewForProcessor`/`useIrsNoticeSplitter` (vd Agent/Support mặc định) → xác nhận KHÔNG thấy nút "For Processor" ở bảng Hồ sơ (khác trước đây nút này có thể vẫn ẩn/hiện đúng do chỉ có 1 quyền — giờ phải test đúng trường hợp thiếu CẢ 2).
9. Thử 1 file PDF không phải scan IRS notice (vd file bất kỳ) → xác nhận không crash, chỉ trả về 0 record hoặc record không có ý nghĩa (đã có thông báo "Không nhận diện được thư nào" khi 0 record).
10. Sau khi deploy code cron `blob-cleanup` (đã có `CRON_SECRET` sẵn từ mục 4.30, không cần thêm biến mới) → vào Vercel Dashboard → project → Cron Jobs → xác nhận thấy job `/api/cron/blob-cleanup` đã đăng ký, lịch **"At 12:00 PM" (1 lần/ngày — đổi từ mỗi giờ ngày 2026-08-19 sau khi phát hiện lịch mỗi giờ bị gói Hobby chặn NGAY Ở BƯỚC DEPLOY, xem mục 4.32)**. Bấm "Run" thử 1 lần → View Logs → xác nhận response `{"ok":true,"scannedCount":N,"deletedCount":M}` (không phải `Unauthorized`).

### 4.32 Đính kèm file "Send mail to CPA" đổi sang Vercel Blob — nâng giới hạn 4MB lên 20MB (thêm 2026-08-19)

File đính kèm popup "Gửi email cho CPA" (`SendCpaEmailDialog`) trước đây gửi base64 thẳng trong JSON body tới `POST /api/cases/[id]/send-cpa-email`, giới hạn tổng 4MB do kẹt giới hạn cứng ~4.5MB thân request Serverless Function (base64 phình ~33%). Đổi sang cùng pattern Vercel Blob đã dùng cho Notice Splitter (xem `.claude/skills/vercel-blob-large-upload/SKILL.md`): client upload từng file THẲNG lên Blob qua route token mới `POST /api/cpa-email/blob-upload` (gate bằng feature `sendCpaEmail` có sẵn, không thêm feature key mới, `allowedContentTypes` để trống vì file CPA có thể là loại bất kỳ), gửi `blobUrl` thay vì `contentBase64` — server route `send-cpa-email` tự `fetch(blobUrl)` lấy bytes, gọi `sendCpaEmail()` (nay nhận `Buffer` trực tiếp thay vì base64, `src/lib/mailer.ts`), rồi **xoá blob ngay trong cùng route** (`finally`, best-effort) — khác Notice Splitter, ở đây gửi mail LUÔN LÀ bước cuối cùng của luồng nên không cần route xoá riêng. Giới hạn tổng đính kèm nâng lên **20MB** (margin an toàn dưới giới hạn thật ~25MB của Gmail).

**Gotcha đã phát hiện VÀ VÁ khi làm mục 4.31/cron `blob-cleanup`, áp dụng lại ở đây**: gói Vercel **Hobby** chỉ cho phép Cron Job chạy tối đa **1 lần/ngày** — nếu sau này thêm cron mới, luôn đặt lịch dạng `"0 H * * *"` (1 giờ cố định/ngày), KHÔNG BAO GIỜ dùng lịch kiểu `"0 * * * *"` (mỗi giờ)/`"*/N * * * *"` (mỗi N phút) — vi phạm khiến **MỌI deployment sau đó bị Vercel chặn ngay ở bước validate**, không hiện trong danh sách Deployments như build lỗi thông thường (nhìn như push không có tác dụng gì), chỉ báo qua email "Deployment failed... Hobby accounts are limited to daily cron jobs". Đã từng mất nhiều vòng chẩn đoán sai hướng (nghi ngờ webhook GitHub-Vercel, disconnect/reconnect Git integration) trước khi tìm đúng nguyên nhân qua email báo lỗi.

**Không cần bước production nào thêm** (không đổi schema, không đổi feature-permission, `BLOB_READ_WRITE_TOKEN` đã có sẵn từ lúc setup Notice Splitter — mục 4.31) — chỉ cần deploy code. Sau khi deploy: đăng nhập tài khoản có quyền `sendCpaEmail`, mở popup gửi mail CPA ở 1 hồ sơ, đính kèm 1 file >4MB (trước đây sẽ báo lỗi ngay) → xác nhận thấy "Đang tải tệp đính kèm lên..." rồi gửi thành công, CPA nhận được đúng file đính kèm.

**Bổ sung cùng ngày (2026-08-19) — hybrid base64/Blob theo ngưỡng, không phải Blob thuần**: sau khi trao đổi với user về rủi ro Vercel Blob free tier (Hobby: hết hạn mức storage/data-transfer/operations thì bị KHOÁ HẲN 30 ngày, không phải trả phí thêm — xem https://vercel.com/docs/vercel-blob/usage-and-pricing), đổi thiết kế: file đính kèm **≤4MB tổng** (`SMALL_ATTACHMENT_THRESHOLD_BYTES`, `send-cpa-email-dialog.tsx`) gửi thẳng `contentBase64` trong JSON body như bản GỐC trước khi có Blob (không qua Blob luôn) — chỉ file **>4MB** mới upload qua Blob. Route `send-cpa-email` chấp nhận CẢ 2 hình dạng payload cùng lúc (`AttachmentInput.blobUrl?`/`contentBase64?`, ít nhất 1 trong 2 phải có). Lý do: đa số email CPA thật có đính kèm nhỏ, nhánh base64 giúp phần lớn lượt gửi **hoàn toàn không phụ thuộc Blob** — nếu Blob gặp sự cố/bị khoá do chạm hạn mức free, email đính kèm nhỏ vẫn gửi được bình thường, chỉ file thật sự lớn (vốn LUÔN cần Blob mới gửi được, không có lựa chọn khác) mới bị ảnh hưởng.

**Gotcha thật đã gặp cùng ngày (trước khi đổi sang hybrid) — không phải bug, mà nghi vấn cache**: user báo lỗi "Tệp đính kèm không hợp lệ" trên production dù deployment đã "Ready". Debug qua Vercel Logs (filter theo từ khoá "attachments") lộ ra `body.attachments` nhận được vẫn ở hình dạng `contentBase64` CŨ dù code client/server trong git đã đổi hoàn toàn sang `blobUrl` — tức trình duyệt của user vẫn đang chạy JS cũ dù đã hard refresh + tab ẩn danh (loại trừ được cache trình duyệt thường, nghi vấn còn lại là CDN/edge cache của Vercel giữ HTML cũ trỏ tới chunk JS cũ, CHƯA xác nhận được nguyên nhân gốc). Đã vá tạm bằng cách chấp nhận cả 2 hình dạng ở server (không chặn cứng người dùng chờ tìm nguyên nhân) — thiết kế hybrid theo ngưỡng ở trên đã thay thế bản vá tạm này thành thiết kế chính thức, không cần rollback gì thêm.

### 4.33 [CHỜ XỬ LÝ] Danh sách loại thư "Not Update CRM" trong tab Notice Splitter đổi thành cấu hình được qua UI (thêm 2026-08-20)

Trước đây danh sách loại thư IRS được tính là "gửi qua văn phòng" (checkbox "Not Update CRM" trong bảng soát/sửa của tab Notice Splitter) là hằng số cứng trong code (`CARE_OF_ELIGIBLE_NOTICE_TYPES`, `src/lib/irs-splitter/care-of-eligibility.ts`) — Quản lý không tự thêm/xoá được. Đổi thành danh sách cấu hình qua UI: nút bánh răng cạnh nút "Chọn file PDF" (chỉ hiện với **manager**, `NoticeSplitterCareOfManager` trong `notice-splitter-panel.tsx`) mở popup thêm/xoá tự do (chuỗi thuần, không có id/màu như các danh sách SelectOption khác trong app). Lưu ở `AppConfig.careOfEligibleNoticeTypes` (cột mới, `Json?`, additive) — cùng cơ chế `refundYearStatusOptions`/`processorReportTasks` (mục 4.17/4.28): null/thiếu = dùng `DEFAULT_CARE_OF_ELIGIBLE_NOTICE_TYPES` (vẫn giữ nguyên 10 loại cũ: CP89/CP289/CP521/CP523/CP01E/CP14/CP14D/2273C/2840C/4458C) làm mặc định.

`isCareOfEligibleNoticeType()` đổi chữ ký — bỏ hẳn default ngầm, giờ **bắt buộc truyền tường minh** danh sách hiện tại làm tham số thứ 2 (tránh 1 nơi gọi âm thầm dùng danh sách cũ trong khi nơi khác đã theo danh sách Admin vừa sửa) — mọi lời gọi (`detectRecords()` qua `DetectOptions.careOfEligibleNoticeTypes`, và 3 chỗ trong `notice-splitter-panel.tsx`) đều đã cập nhật đọc từ `useAppStore((s) => s.careOfEligibleNoticeTypes)`.

Vì tính năng Notice Splitter xử lý 100% trên trình duyệt (không còn route server nào, xem mục 4.31), thay đổi này **CHỈ đụng tới `AppConfig.careOfEligibleNoticeTypes`** (đọc/ghi qua `GET|PUT /api/config` có sẵn, cùng field độc lập "chỉ manager" như `refundYearStatusOptions`) — không đụng gì tới pipeline tách file.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (thêm cột `careOfEligibleNoticeTypes` trên `app_config`, an toàn/additive/nullable — không cần script merge `AppConfig` vì fallback runtime `config.careOfEligibleNoticeTypes ?? DEFAULT_CARE_OF_ELIGIBLE_NOTICE_TYPES` giữ đúng hành vi 10 loại thư cũ cho tới khi Admin chủ động sửa).
2. Đăng nhập production bằng tài khoản **manager** thật, mở popup "For Processor" → tab "Notice Splitter" → xác nhận thấy nút bánh răng cạnh nút "Chọn file PDF" → mở popup, xác nhận thấy đủ 10 loại thư mặc định.
3. Thêm thử 1 loại thư mới (vd "CP504") → xử lý 1 file PDF test có chứa thư CP504 với tín hiệu "%"/"C/O" → xác nhận checkbox "Not Update CRM" giờ tick được (trước đó bị khoá). Xoá loại thư đó → xử lý lại → xác nhận checkbox quay lại bị khoá.
4. Đăng nhập bằng tài khoản KHÔNG phải manager (vd Processor/Kế toán) → mở tab Notice Splitter → xác nhận KHÔNG thấy nút bánh răng (chỉ xem/dùng danh sách hiện có, không sửa được).
5. Reload trang (F5) sau khi đổi danh sách ở bước 3 → xác nhận danh sách vẫn giữ đúng thay đổi (đã lưu server, không chỉ local state).

### 4.34 [CHỜ XỬ LÝ] Icon đồng hồ "lịch nhắc kiểm tra TTS & WIT" trong popup "Refund by years" (thêm 2026-08-21)

Icon đồng hồ mới (`AlarmClockButton`, `lucide-react` `AlarmClock`) đặt ngay trước dropdown Status của mỗi năm trong popup "Refund by years" (`CaseRefundStatusButton`) — bấm mở 1 ô `<input type="date">` inline để đặt/xoá lịch nhắc riêng cho năm đó. Đến đúng ngày đã chọn (giờ Phoenix), Notification tự tạo cho đúng người đã đặt lịch: "Hồ sơ {Tên (SSN: ...)} đã đến hạn kiểm tra TTS & WIT cho năm {năm}" — bắn qua Pusher như mọi Notification khác (chuông kêu/hiện ngay nếu người đó đang mở app). Không giới hạn theo `editable`/quyền cột "refunds" — giống `refundYearPendingReason`, mọi user mở popup bằng click đều đặt được, đây chỉ là tiện ích nhắc việc cá nhân.

Thêm `Case.refundYearAlarm` (cột mới, `Json @default("{}")`, additive, migration `20260821033146_add_case_refund_year_alarm`) — Record<năm, `{date, userId, notifiedAt}` | null>. **KHÔNG đụng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`/`AppConfig`** (giống mục 4.13/4.14/4.19/4.24) nên **không cần** script merge `AppConfig`, chỉ cần migration.

**Cơ chế cron đáng chú ý**: KHÔNG đăng ký thêm 1 Cron Job riêng trong `vercel.json` — gói Vercel Hobby giới hạn số Cron Job (đã gặp thật ở mục 4.31/4.32 khi thêm `blob-cleanup`, phải đổi lịch từ mỗi giờ xuống 1 lần/ngày; nếu vượt SỐ LƯỢNG job cho phép nhiều khả năng cũng bị chặn tương tự lúc deploy). Việc quét lịch nhắc (`checkAndFireRefundYearAlarms`, `src/lib/refund-alarm.ts`) được gọi "piggyback" ở CUỐI route `cron/ringcentral-renew` (đã có sẵn, chạy hằng ngày) — lỗi ở phần nào không chặn phần kia. Lịch cron ở `0 7 * * *` (07:00 UTC = 00:00 — đúng lúc bắt đầu ngày mới — giờ Phoenix, theo yêu cầu 2026-08-21, đổi lại từ phương án 6h sáng ban đầu cùng ngày — Phoenix không đổi giờ DST nên offset UTC-7 cố định quanh năm) — xem `vercel.json`. Route riêng `GET /api/cron/refund-alarm-check` (cùng xác thực `CRON_SECRET`) vẫn tồn tại để test tay qua curl nhưng CỐ Ý không có trong `vercel.json`.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (thêm cột `refundYearAlarm` trên `cases`, an toàn/additive).
2. Đăng nhập production bằng tài khoản bất kỳ (không cần manager), mở popup "Refund by years" (nút mắt cạnh cột Case) ở 1 hồ sơ có refund > 0 → bấm icon đồng hồ trước Status 1 năm → chọn 1 ngày TRONG QUÁ KHỨ (để test không phải chờ) → xác nhận icon chuyển màu xanh dương (đã đặt lịch).
3. Gọi tay `GET /api/cron/refund-alarm-check` kèm header `Authorization: Bearer $CRON_SECRET` (hoặc đợi cron `ringcentral-renew` chạy tự nhiên lúc 07:00 UTC = 00:00 giờ Phoenix, xem `vercel.json`) → xác nhận tài khoản vừa đặt lịch nhận được Notification đúng nội dung "đã đến hạn kiểm tra TTS & WIT cho năm ...", bấm vào nhảy đúng tới hồ sơ đó.
4. Gọi lại route quét lần 2 ngay sau đó → xác nhận KHÔNG có Notification thứ 2 nào được tạo (đã set `notifiedAt`, không lặp lại cho tới khi đổi lại ngày).
5. Mở lại popup, đổi lại ngày hẹn (bất kỳ, kể cả cùng ngày cũ) → xác nhận `notifiedAt` reset (kiểm tra bằng cách gọi lại route quét, thấy bắn Notification lần nữa nếu ngày mới <= hôm nay). Bấm nút X trong ô đặt lịch để xoá hẳn → xác nhận icon quay về màu xám mặc định.

### 4.35 [CHỜ XỬ LÝ] Nút "Nhập từ CRM" — đọc hồ sơ khách hàng từ CRM ngoài tax.agentc3.com (thêm 2026-08-21)

Nút mới trên toolbar bảng Hồ sơ (cạnh "Nhập Excel", gate cùng feature `addRow` có sẵn — KHÔNG
thêm feature key mới) — dán link 1 hồ sơ khách hàng trên CRM cũ `tax.agentc3.com` (PHP/
CodeIgniter, tách biệt hoàn toàn khỏi DB Direct Funder), app tự đăng nhập (1 tài khoản CHUNG,
`AGENTC3_USERNAME`/`AGENTC3_PASSWORD`) + đọc HTML server-rendered (KHÔNG cần headless
browser — xem `.claude/skills/agentc3-crm-import/SKILL.md` cho chi tiết đầy đủ: bảng field-id
CRM, cơ chế đăng nhập, kiến trúc 3 lớp) → hiện form xem trước (mọi ô sửa được) → **tạo hồ sơ
mới** nếu SSN chưa có, hoặc **chỉ điền vào ô đang trống** của hồ sơ đã trùng SSN (không bao
giờ ghi đè dữ liệu có sẵn). Đã tự kiểm tra đầy đủ qua `curl` + Playwright thật (tài khoản CRM
thật do người dùng cung cấp) — cả 2 nhánh tạo mới/điền-ô-trống đều hoạt động đúng, xác nhận
qua ảnh chụp UI và truy vấn lại DB.

**Đây CHỈ là thêm code (2 route mới, 1 dialog mới, 1 store action mới) — KHÔNG đổi schema,
KHÔNG đổi `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`/`AppConfig`** (dùng lại đúng feature
`addRow` sẵn có) nên **không cần** `prisma migrate deploy`, **không cần** script merge
`AppConfig`.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. Thêm `AGENTC3_USERNAME`/`AGENTC3_PASSWORD` vào Vercel Environment Variables (Production) — xem `.env.example`. Thiếu 1 trong 2 thì route tự trả lỗi rõ ràng 501, không crash app, nhưng nút sẽ luôn báo lỗi khi bấm "Lấy dữ liệu".
2. Đăng nhập production bằng tài khoản có quyền `addRow`, bấm nút "Nhập từ CRM" trên toolbar bảng Hồ sơ → dán 1 link hồ sơ thật trên `tax.agentc3.com` → xác nhận form xem trước hiện đúng dữ liệu (tên/SSN/DOB/địa chỉ/refund/bank/FC-EL date), Status/Agent tự khớp đúng nếu tên trùng khớp.
3. Bấm "Tạo hồ sơ" (SSN chưa có trong Direct Funder) → xác nhận hồ sơ mới lên đầu bảng, mở "Edit Hồ sơ" kiểm tra đủ field, cột Money = tổng đúng refund các năm.
4. Dán lại ĐÚNG link đó lần 2 → xác nhận preview hiện banner "Đã tìm thấy hồ sơ có sẵn", các ô đã có dữ liệu bị khoá xám, bấm "Cập nhật hồ sơ" (nếu còn ô trống) hoặc thấy báo "không có gì để cập nhật" (nếu mọi field CRM tương ứng đã đầy đủ) — không tạo hồ sơ trùng.
5. Đăng nhập bằng tài khoản KHÔNG có quyền `addRow` → xác nhận không thấy nút "Nhập từ CRM" trên toolbar.

### 4.36 [CHỜ XỬ LÝ] Nút "Update to CRM" — ghi ngược Status/CPA Review/Conversation Log/tài liệu 1040X LÊN CRM agentc3 (thêm 2026-08-21)

Chiều NGƯỢC LẠI của mục 4.35 (nhập TỪ CRM) — nút icon `RefreshCw` trong popup "Gửi dữ liệu"
(`SendActionsMenuButton`, cạnh Send to Sheet/CPA Email/Test Sheet/Client Email), chỉ hiện nếu
hồ sơ đã có `clientLink` trỏ về `tax.agentc3.com`. Popup chọn năm → set CPA Review = ngày hệ
thống cho từng năm đã chọn, đổi Status theo đúng danh sách Status CỦA CRM (không phải Status
Direct Funder), tự soạn 1 dòng Conversation Log theo refund/Tax on INT từng năm (sửa tay được
trước khi gửi), và/hoặc upload file vào đúng ô "{năm} 1040X - Submitted" trong tab Documentation
của CRM. Cơ chế ghi: đọc lại TOÀN BỘ field ẩn của form Lead CRM ngay trước khi gửi (tránh dùng
snapshot cũ), CHỈ đổi field người dùng chọn, resubmit — có bẫy quan trọng đã tự phát hiện+vá:
bỏ qua mọi `<input>/<select>` có thuộc tính `disabled` khi đọc snapshot (trình duyệt thật
không submit field disabled — đọc nhầm sẽ ghi đè mất dữ liệu thật, xem comment trong
`src/lib/agentc3-client.ts`).

**Đây CHỈ là thêm code (2 route mới `crm-context`/`update-to-crm`, 1 dialog mới) — KHÔNG đổi
schema, KHÔNG đổi `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`/`AppConfig`** (dùng lại đúng
`canViewCase`/`canEditCase` sẵn có, không có feature key riêng) nên **không cần**
`prisma migrate deploy`, **không cần** script merge `AppConfig`. Dùng CHUNG
`AGENTC3_USERNAME`/`AGENTC3_PASSWORD` đã cấu hình từ mục 4.35 — không cần thêm biến môi
trường nào khác.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. Đăng nhập production bằng tài khoản có quyền xem/sửa hồ sơ, mở 1 hồ sơ đã liên kết
   `tax.agentc3.com` → bấm nút "Gửi dữ liệu" → xác nhận thấy dòng "Update to CRM" trong popup,
   bấm vào mở đúng dialog chọn năm, Status/Performed By đọc đúng danh sách hiện có trên CRM.
2. Chọn 1 năm, để CPA Review mặc định (ngày hệ thống), gõ thử Conversation Log → bấm gửi →
   xác nhận trên CRM thật: CPA Review năm đó = hôm nay, Conversation Log có dòng mới đúng nội
   dung, KHÔNG có field nào khác bị đổi ngoài dự kiến (so sánh trước/sau nếu nghi ngờ).
3. Thử xoá Processing Date trong popup rồi gửi → xác nhận Processing Date trên CRM cũng bị
   xoá theo (không chỉ ở local).
4. Thử upload 1 file vào ô "{năm} 1040X - Submitted" → xác nhận file xuất hiện đúng slot trong
   tab Documentation của CRM.

### 4.37 Tối ưu tải trang Hồ sơ + tự xoá lịch sử sửa/xoá quá 30 ngày (thêm 2026-08-21)

Rà soát hiệu năng phát hiện qua `next build` thật: bundle của `/dashboard/cases` cõng theo
toàn bộ thư viện `xlsx` (SheetJS) + `pdf-lib` dù 2 thư viện này chỉ dùng cho hành động bấm
thỉnh thoảng (Nhập/Tải Excel mẫu; tab "Notice Splitter" trong popup "For Processor") — xác
nhận qua `page_client-reference-manifest.js`: trước khi sửa, 1 chunk 680 KB raw/~226 KB gzip
chỉ bị `/dashboard/cases` tham chiếu (không trang dashboard nào khác đụng tới). Đã sửa:
- `src/lib/excel.ts`: `xlsx` đổi từ `import * as XLSX from "xlsx"` (top-level) sang lazy-import
  qua `loadXlsx()` (cache module promise), gọi bên trong `downloadCaseTemplate`/
  `downloadOrderCaseTemplate`/`parseCaseExcelFile` — cả 3 hàm đổi thành `async`.
- `src/components/for-processor-dialog.tsx`: `NoticeSplitterPanel` đổi từ import tĩnh sang
  `next/dynamic(..., { ssr: false })` — component đầu tiên trong repo dùng `next/dynamic` (chưa
  có tiền lệ trước đó), chỉ tải chunk chứa `pdf-lib` khi tab "Notice Splitter" thực sự được mở.
- `send-actions-menu-button.tsx`/`test-sheet-button.tsx`: đổi 2 chỗ `<img>` thô sang
  `next/image` (ESLint `@next/next/no-img-element` đã cảnh báo sẵn từ trước, giờ mới sửa).

Đã tự kiểm tra: `next build` thật sau khi sửa xác nhận chunk chứa chuỗi `"SheetJS"` (472 KB) và
chunk chứa `PDFDocument` (388 KB) KHÔNG còn nằm trong danh sách chunk mà
`page_client-reference-manifest.js` của `/dashboard/cases` tham chiếu nữa (trước đó có). Test
qua Playwright thật: bấm "Tải Excel mẫu" vẫn tải đúng file `.xlsx`; mở popup "For Processor" →
tab "Notice Splitter" vẫn hiển thị đúng (thấy Turbopack tự "Compiling..." chunk riêng lúc mở
tab lần đầu — đúng hành vi lazy); không có lỗi console nào. `tsc --noEmit`/`eslint` sạch.

**Thêm `src/lib/history-cleanup.ts`** (`cleanupOldHistory()`) — xoá mọi dòng
`EditHistoryEntry`/`DeletedRowEntry` cũ hơn 30 ngày (`RETENTION_DAYS`), piggyback trên cron
`blob-cleanup` có sẵn (chạy 1 lần/ngày, xem comment trong route đó — cùng lý do các piggyback
khác trong repo, không đăng ký thêm Cron Job vì giới hạn gói Hobby). Lý do: `GET
/api/history/edits` KHÔNG phân trang, tải TOÀN BỘ bảng mỗi lần BẤT KỲ ai vào dashboard (xem
`hydrateFromServer` trong `app-store.ts`) — bảng này trước đây chỉ tăng, không bao giờ xoá.
Đã tự test bằng script trực tiếp trên DB dev: chèn 1 dòng `EditHistoryEntry` giả với
`editedAt` cách đây 40 ngày, chạy `deleteMany({ editedAt: { lt: cutoff } })` → xác nhận đúng
1 dòng đó bị xoá, các dòng gần đây (trong 180 dòng thật của DB dev) vẫn còn nguyên.

**Không đổi schema** (chỉ xoá dữ liệu qua `deleteMany`, không đổi cột nào) — **không cần**
`prisma migrate deploy`, không cần script merge `AppConfig`. Chỉ cần deploy code — cron
`blob-cleanup` đã chạy sẵn hằng ngày trên production nên KHÔNG cần thao tác gì thêm, nhưng
**cần biết trước**: sau khi deploy, lần chạy cron kế tiếp (12:00 UTC) sẽ **xoá vĩnh viễn** mọi
dòng lịch sử sửa/xoá cũ hơn 30 ngày hiện có trên production — nếu cần giữ lại lịch sử cũ hơn để
tra cứu/audit lâu dài, hãy tự export trước khi deploy (chưa có sẵn tính năng export lịch sử).

### 4.38 Popup chọn năm gửi ở "Send mail to CPA" — Subject "[EC {năm}]" + điền số row CPA Review vào nội dung mail (thêm 2026-08-22)

Nút "Gửi mail CPA" (`SendCpaEmailDialog`) trước đây mở thẳng popup soạn mail với Subject/Body
dựng sẵn từ mẫu Admin cấu hình (không có khái niệm năm) — giờ bấm vào mở **popup chọn năm gửi
trước** (cùng UI grid chọn năm với `TestSheetButton`), rồi mới mở popup soạn mail:
- **Subject đổi hẳn** thành `[EC {các năm viết tắt 2 số nối bằng "-"}]` (vd chọn 25 -> `[EC 25]`,
  chọn 23/24/25 -> `[EC 23-24-25]`) — **không dùng `subjectTemplate` Admin cấu hình nữa** (field
  này giữ lại trong `CpaEmailDefaults`/DB cho tương thích ngược nhưng không còn ô nào ghi đè, đã
  bỏ luôn field "Mẫu tiêu đề mặc định" khỏi dialog `CpaEmailDefaultsDialog` ở trang Phân quyền).
- **Body** vẫn dùng `bodyTemplate` Admin cấu hình như cũ, nhưng có thêm 1 biến mới `{cpaReviewRow}`
  — server tra số thứ tự dòng (row) của hồ sơ này trên tab CPA Review theo SSN (route mới
  `GET /api/cpa-review/case-row`, khớp đúng số hiển thị ở cột gutter ngoài cùng trên tab CPA
  Review, `i + 4`) và điền vào. 1 hồ sơ có thể có nhiều dòng trên CPA Review (mỗi lần "Test
  Sheet" tạo dòng mới) — lấy dòng có `updatedAt` gần nhất khớp SSN. Nếu hồ sơ CHƯA từng gửi sang
  CPA Review, `{cpaReviewRow}` để rỗng (không chặn gửi mail). `DEFAULT_BODY_TEMPLATE` trong code
  (`src/lib/cpa-email-template.ts`) đã cập nhật dùng biến này, nhưng **nếu Admin đã tự tuỳ biến
  `bodyTemplate` từ trước** (như trên production thật, câu "Please see line [để trống]...") thì
  template cũ đó KHÔNG tự có `{cpaReviewRow}` — Admin cần tự vào "Cấu hình email CPA mặc định"
  (trang Phân quyền) sửa lại câu chữ, chèn thêm `{cpaReviewRow}` vào chỗ muốn hiện số row.

**Đây CHỈ là thêm code (1 route mới đọc-chỉ, sửa 1 dialog + 1 store action) — KHÔNG đổi
schema, KHÔNG đổi `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`/`AppConfig`** (dùng lại đúng
feature `sendCpaEmail` có sẵn) nên **không cần** `prisma migrate deploy`, **không cần** script
merge `AppConfig`. Chỉ cần deploy code.

**Đã tự kiểm tra bằng Playwright thật trên DB dev (2026-08-22)**: gửi 1 hồ sơ test sang tab CPA
Review qua "Test Sheet" (tạo dòng thật, row hiển thị = 123) → bấm "Gửi mail CPA", chọn năm 2025
→ xác nhận Subject hiện đúng `[EC 25]` → gọi trực tiếp `GET /api/cpa-review/case-row?ssn=...`
qua session thật, xác nhận trả về `{found:true, rowNumber:123}` khớp CHÍNH XÁC với số hiển thị
trên tab CPA Review. Dữ liệu test đã xoá sau khi kiểm tra xong. `tsc --noEmit`/`eslint` sạch.

**Sửa lại cùng ngày (2026-08-22) — TỰ ĐỘNG điền số row, không bắt Admin sửa template**: bản đầu
chỉ hỗ trợ qua token `{cpaReviewRow}` — Admin phải tự vào Phân quyền chèn token này vào
`bodyTemplate` mới thấy số row, nhưng template thật đang dùng (viết tay "Please see line [ô
trống bôi vàng]...") không có token này nên không hoạt động ngay ("vẫn chưa lấy được row chính
xác"). Đã thêm `injectCpaReviewRowAfterSeeLine()` (`src/lib/cpa-email-template.ts`) — chạy SAU
`renderCpaEmailTemplate`, tự tìm cụm "see line" (không phân biệt hoa/thường) và điền số row
NGAY SAU đó: ưu tiên điền vào bên trong `<span>` rỗng/bôi vàng theo sau nếu có (giữ nguyên style
— đúng mẫu production hiện tại), không có thì chèn thẳng số row dạng text sau chữ "line". Hoạt
động ngay với template hiện có, KHÔNG cần Admin sửa gì. Token `{cpaReviewRow}` vẫn giữ lại (dùng
được nếu Admin viết template mới có nhắc rõ token này) — 2 cơ chế không đụng nhau vì nếu token
đã điền số vào rồi thì cụm "see line" + span rỗng sẽ không còn khớp mẫu để chèn trùng.
Cũng đã tiện tay sửa 1 bug run-time không liên quan phát hiện qua trang Phân quyền
(`src/app/dashboard/permissions/page.tsx`): `checked = isManager || permissions[feature]?.includes(role)`
có thể ra `undefined` (feature key chưa có trong `AppConfig.featurePermissions`) khiến React báo
lỗi input checkbox controlled/uncontrolled — đã bọc `Boolean(...)` để luôn là `true`/`false`.

**Sau khi deploy code này lên production**: đăng nhập bằng tài khoản có quyền `sendCpaEmail`
(mặc định Processor), mở 1 hồ sơ status CPA Review đã từng gửi sang tab CPA Review (qua "Test
Sheet") → bấm "Gửi mail CPA" → chọn 1-2 năm → xác nhận Subject hiện đúng `[EC ...] {tên} - {sđt}`
VÀ nội dung mail hiện đúng số row ngay sau cụm "Please see line" (không cần sửa gì ở Phân
quyền) → đối chiếu số row đó với số hiển thị thật trên tab CPA Review.

### 4.39 [CHỜ XỬ LÝ] Nút "My Notes" — ghi chú cá nhân rich text cho mọi user (thêm 2026-08-23)

Nút mới trên toolbar bảng Hồ sơ (cạnh "Ẩn cột"/"Lịch sử", cả desktop lẫn menu "Thêm" trên
mobile) — mở popup ghi chú tự do (đậm/nghiêng/gạch ngang/màu chữ/màu nền, `MyNotesEditor`,
`src/components/my-notes-editor.tsx`), CHO MỌI ROLE (không cần feature permission nào), CHỈ
chính chủ tài khoản đọc/sửa được ghi chú của mình — không có khái niệm chia sẻ/xem chung.

Thêm `User.myNotesHtml String?` (cột mới, additive) + route riêng `GET|PATCH /api/me/notes`
(`src/app/api/me/notes/route.ts`) — **CỐ Ý KHÔNG gộp vào `GET /api/users`/`PATCH
/api/users/[id]`**: danh sách `/api/users` trả về cho MỌI user xem (để gán việc/hiển thị dropdown
Agent-Processor), nếu nhét `myNotesHtml` vào đó sẽ lộ ghi chú riêng tư của người khác. Route mới
luôn thao tác trên `me.id` lấy từ session, không nhận `id` từ client nên không có đường nào
đọc/sửa ghi chú của tài khoản khác. Nội dung nạp LƯỜI (lazy) lần đầu mở popup (`fetchMyNotes`
trong `app-store.ts`) — KHÔNG nạp cùng `hydrateFromServer()` như users/cases/columns, tránh
round-trip thừa mỗi lần vào dashboard cho 1 tính năng không phải ai cũng dùng thường xuyên. Lưu
tay qua nút "Lưu" (không auto-save mỗi keystroke) — dialog KHÔNG tự đóng sau khi lưu (khác đa
số dialog cấu hình khác trong app) vì đây là notepad, người dùng có thể ghi tiếp trong cùng 1
lần mở.

Sanitize qua `sanitizeNotesHtml` MỚI (`src/lib/rich-text.ts`) — tách riêng khỏi `sanitizeRuleHtml`
(dùng cho tab Rules) vì cần whitelist rộng hơn (`<s>`/`<strike>` cho gạch ngang, style
`color`/`background-color` cho màu chữ/màu nền, `<font color="...">`) mà Rules chưa cần tới;
refactor phần lõi thành `sanitizeHtml(html, allowedTags, allowedStyleProps)` dùng chung, không
đụng hành vi sẵn có của `sanitizeRuleHtml`. Chạy ở SERVER (route `PATCH /api/me/notes`, nguồn xử
lý chính) — client không tự sanitize trước khi gửi vì nội dung chỉ chính chủ đọc lại (không có
người dùng thứ 2 nào bị ảnh hưởng nếu client gửi HTML thô, nhưng server vẫn luôn sanitize trước
khi lưu để phòng hờ).

**Đã tự kiểm tra đầy đủ (2026-08-23)**: gọi thật `GET`/`PATCH /api/me/notes` qua curl (session
thật) — sanitize giữ đúng `<b>`/`<s>`/`<span style="color:...">`, PATCH rồi GET lại khớp nguyên
văn. Xác nhận `GET /api/users` (12 user thật) KHÔNG có field `myNotesHtml` ở bất kỳ user nào
(không lộ ghi chú riêng tư). Xác nhận DB: user khác (`thi@`, `lamgiang@`, `thinh@`) vẫn
`myNotesHtml: null`, không bị ảnh hưởng bởi thao tác của user đang test. Test qua Playwright
thật: mở popup → nội dung cũ tự nạp đúng → gõ thêm text → chọn tất cả → bấm In đậm + Gạch ngang
→ Lưu → hiện "Đã lưu lúc HH:MM" → đọc lại `innerHTML` của editor khớp đúng định dạng vừa áp
dụng. `tsc --noEmit`/`eslint` sạch. Dữ liệu test đã xoá sau khi kiểm tra xong.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (thêm cột `myNotesHtml` trên `users`, an toàn/additive/nullable).
2. Đăng nhập production bằng BẤT KỲ tài khoản nào (không cần manager) → xác nhận thấy nút "My
   Notes" trên toolbar bảng Hồ sơ → mở popup, gõ thử vài dòng, dùng thử cả 5 định dạng (đậm/
   nghiêng/gạch ngang/màu chữ/màu nền) → bấm "Lưu" → xác nhận hiện "Đã lưu lúc..." → reload
   trang, mở lại popup → xác nhận nội dung + định dạng còn nguyên.
3. Đăng nhập bằng tài khoản KHÁC → mở "My Notes" → xác nhận thấy popup TRỐNG (không thấy ghi
   chú của tài khoản ở bước 2) — nếu thấy nội dung của người khác thì có lỗ hổng, cần dừng lại
   kiểm tra ngay.
4. Mở DevTools → gọi `fetch("/api/users").then(r=>r.json()).then(console.log)` bằng tài khoản
   bất kỳ → xác nhận KHÔNG có field `myNotesHtml` trong response (double-check không lộ qua
   danh sách users chung, đúng như đã test ở local).

### 4.40 Nút "TTS & WIT" ở cột "Check CRM" — hiện popup ngày TTS/WIT mới nhất theo năm (thêm 2026-08-23, đơn giản hoá cùng ngày)

Cột "Order" trên bảng Hồ sơ (trước đây hiện 2 nút đặt lệnh "Order 8821"/"TTS & WIT" cho Support,
`Order8821Picker`/`OrderTtsWitPicker` trong `src/components/order-cell.tsx`) đã **ẨN 2 nút đó
khỏi bảng Hồ sơ chính** (tính năng đặt lệnh vẫn còn nguyên, chỉ dùng được qua tab "Orders" riêng
cho Support — không đụng `placeOrder`/`hasWaitingOrderForSsn`/`missingOrderClientFields`/
`src/app/dashboard/orders/page.tsx`), thay bằng **1 nút mới cũng tên "TTS & WIT"**
(`CrmTtsWitCheckButton`, `src/components/crm-tts-wit-check-button.tsx`) — bấm để đọc trực tiếp
CRM ngoài (`tax.agentc3.com`) và **mở popup hiện ngay** ngày upload mới nhất của TTS/WIT cho
từng năm 2023/2024/2025 (6 ô: TTS×3 năm + WIT×3 năm, "—" nếu năm đó chưa có file). Cột đổi tên
hiển thị từ "Order" thành "Check CRM" — **CHỈ đổi qua i18n** (`col.header.order` trong
`src/lib/i18n.ts`, VI + EN), KHÔNG đụng `label` trong `DEFAULT_COLUMNS`/`AppConfig.columns` vì
cột này dùng key i18n cố định (`translateColumnLabel()` tra `DEFAULT_COLUMN_LABEL_KEY["order"]`),
bỏ qua hoàn toàn `label` lưu trong DB — **không cần script merge cho phần đổi tên cột**.

**Lịch sử quyết định (đọc trước khi sửa lại tính năng này)**: bản đầu (cùng ngày) thiết kế theo
kiểu "so mốc + báo Notification cho Agent 1/Processor 1 khi có file mới hơn lần trước" (thêm 3
cột `Case.crmLatestTtsUploadedAt`/`crmLatestWitUploadedAt`/`crmTtsCheckedAt`) — user test xong
báo "không thấy có thông báo gì" vì lần bấm ĐẦU TIÊN của 1 hồ sơ theo thiết kế đó chỉ lưu mốc,
không báo gì (đúng thiết kế nhưng không có phản hồi tức thời, gây hiểu nhầm là lỗi). Sau khi hỏi
lại, user xác nhận muốn **bỏ hẳn cơ chế Notification/so-mốc**, đổi thành mỗi lần bấm luôn hiện
NGAY kết quả qua popup — đơn giản hơn, phản hồi tức thời, không cần theo dõi trạng thái gì giữa
các lần bấm. Đã **XOÁ SẠCH** 3 cột `Case` vừa thêm (migration DROP COLUMN riêng, xem bên dưới —
3 cột này ĐÃ deploy lên production trước đó cùng ngày rồi bị xoá lại ngay, không có dữ liệu thật
nào bị mất vì tính năng mới ra đời trong ngày, chỉ có dữ liệu test).

Chỉ nút "TTS & WIT" hiện khi hồ sơ đã có `Case.clientLink` trỏ CRM agentc3 (giống gate của
"Update to CRM") — ngược lại ô hiện "—" tĩnh. Route `POST /api/agentc3-import/check-latest-tts`
(gate `canViewCase`, dùng chung `fetchWithSession`/cheerio với `agentc3-client.ts`,
`fetchTtsWitDatesByYear()`) đọc tab Documentation, CHỈ ĐỌC — không ghi/so sánh/thông báo gì.
Phân loại theo tên loại tài liệu + năm trích từ chính tiêu đề (regex `\b(20\d{2})\b`): **TTS**
= tiêu đề chứa "TTS" ("Pitbulltax {năm} TTS"/"{năm} TTS"); **WIT** = tiêu đề chứa "WI Transcript"
("{năm} WI Transcript") — CẢ 2 chỉ giữ lại năm thuộc 2023/2024/2025 (cố ý bỏ 2022 dù CRM có slot
WIT năm đó — theo yêu cầu ban đầu, giữ nguyên phạm vi này ở thiết kế mới).

**Đã tự kiểm tra đầy đủ (2026-08-23)** qua curl thật (session admin thật) + Playwright thật: gán
tạm `clientLink` của 1 hồ sơ dev sang customer CRM thật đã biết có sẵn TTS/WIT (`BY309062`) →
gọi route → xác nhận trả đúng `{tts:{"2023":...,"2024":...,"2025":...}, wit:{...}}` khớp đúng
timestamp thật đọc được từ CRM. Qua UI: bấm nút "TTS & WIT" → popup mở ngay hiện đủ 6 ô ngày
đúng dữ liệu route trả về. Dữ liệu test (link CRM tạm) đã khôi phục lại sau khi kiểm tra.
`tsc --noEmit`/`eslint` sạch.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-23** — `prisma migrate deploy` nhắm production đã chạy CẢ 2 migration
   cùng ngày: migration thêm 3 cột `crmLatestTtsUploadedAt`/`crmLatestWitUploadedAt`/
   `crmTtsCheckedAt` (bản thiết kế đầu, đã lỗi thời) VÀ migration `drop_case_crm_tts_tracking`
   xoá lại đúng 3 cột đó ngay sau (bản thiết kế cuối không cần lưu gì trên `Case`) — production
   hiện tại schema `cases` KHÔNG còn 3 cột này, khớp đúng code hiện tại.
2. Không cần script merge cho phần đổi tên cột "Order" → "Check CRM" (chỉ đổi qua i18n).
3. ✅ **Đã xong 2026-08-23** — đã chạy script merge cập nhật `width` của cột `"order"` trong
   `AppConfig.columns` production từ `92` lên `118` (cosmetic, đỡ cắt chữ header "Check CRM") —
   BƯỚC NÀY VẪN ĐÚNG, không bị ảnh hưởng bởi việc đổi thiết kế Notification → popup.
4. [CHỜ XÁC NHẬN QUA UI] Đăng nhập production bằng tài khoản bất kỳ có quyền cột "order" (mặc
   định mọi role), mở bảng Hồ sơ → xác nhận cột hiện "Check CRM" (không còn "Order"), KHÔNG còn
   thấy nút "8821" — chỉ còn đúng 1 nút "TTS & WIT" mới ở hồ sơ đã có `clientLink`, hồ sơ chưa
   liên kết hiện "—".
5. Bấm nút "TTS & WIT" ở 1 hồ sơ thật đã liên kết CRM → xác nhận popup mở ngay, hiện đúng 6 ô
   ngày (TTS/WIT × 2023/2024/2025) khớp đúng dữ liệu thật trên CRM, năm nào chưa có file hiện
   "—". Bấm lại nhiều lần → xác nhận luôn đọc lại CRM mới nhất (không cache/không lỗi trùng).
6. Vào tab "Orders" (Support) → xác nhận vẫn đặt/xử lý được lệnh Order 8821/TTS & WIT như cũ
   (tính năng cũ không mất, chỉ mất chỗ bấm nhanh từ bảng Hồ sơ chính).

**Bổ sung cùng ngày (2026-08-23)** — đổi tên lần 2 theo yêu cầu: cột "Check CRM" → **"TTS & WIT
Lastest"**, nút "TTS & WIT" → **"Check log"** (chỉ đổi qua i18n `col.header.order`/
`crmTtsWit.button`, không cần script merge cho phần tên). Nút đổi từ `w-full` (kéo giãn hết
chiều rộng cột) sang `inline-flex` fit theo đúng độ dài chữ "Check log" (yêu cầu "fit button vừa
cỡ chữ"). Cột tăng `width` từ 118 lên **140** (header "TTS & WIT Lastest" dài hơn "Check CRM") —
✅ **Đã xong 2026-08-23**: đã chạy script merge cập nhật `width` cột `"order"` trong
`AppConfig.columns` production từ 118 lên 140.

### 4.41 [CHỜ XỬ LÝ] Feature key `viewOrders` — cấu hình được quyền xem tab "Order" qua trang Phân quyền (thêm 2026-08-23)

Trước đây tab "Order" ở nav (`top-nav.tsx`) VÀ trang `/dashboard/orders` (chặn truy cập thẳng
qua URL) đều hard-code `roles: ["agent","processor","support","agent_leader","processor_leader"]`
— Quản lý (manager) và Kế toán KHÔNG xem được tab này dù có toàn quyền ở mọi tab khác. Đổi thành
feature key `viewOrders` (mặc định giữ nguyên đúng 5 role đó, KHÔNG rỗng — đúng loại thay đổi mô
tả ở mục 4.8/4.21, giống `viewCollecting`/`viewCpaReview`/`viewForProcessor`), Admin giờ cấp/thu
quyền qua trang Phân quyền (dòng "Xem tab Order" tự xuất hiện, `ASSIGNABLE_FEATURES` lặp tự
động). **Hệ quả phụ có chủ đích**: vì `hasFeature()` luôn bypass cho `role === "manager"` (đúng
convention chung mọi feature key khác trong app), Quản lý (Admin) giờ xem được tab "Order" — TRƯỚC
ĐÂY KHÔNG xem được do hard-code loại trừ. Đây là thay đổi hành vi nhỏ nhưng đã chủ ý (nhất quán
với mọi tab feature-gated khác), không phải bug.

Không đổi schema (không cột/bảng nào mới) — chỉ đổi `AppConfig.featurePermissions`.

**Đã tự kiểm tra ở local (2026-08-23)** qua Playwright thật: merge `viewOrders` vào DB dev →
đăng nhập Manager → trang Phân quyền hiện đúng dòng "Xem tab Order" (Manager luôn tick sẵn/khoá,
Agent/Processor/Support/Agent Leader/Processor Leader đã tick sẵn đúng mặc định, Kế toán KHÔNG
tick — khớp đúng hành vi hard-code cũ) → vào thẳng `/dashboard/orders` bằng Manager → xác nhận
xem được bình thường (trước đây bị chặn "Bạn không có quyền..."). `tsc --noEmit` sạch; `eslint`
chỉ còn 1 lỗi CÓ SẴN TỪ TRƯỚC ở dòng không liên quan trong cùng file (`orders/page.tsx:84`,
`react-hooks/set-state-in-effect` ở 1 component khác, xác nhận qua `git diff` không đụng dòng đó).

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. Không cần `prisma migrate deploy` (không đổi schema).
2. ✅ **Đã xong 2026-08-23** — đã chạy script merge cộng dồn thêm
   `viewOrders: ["agent","processor","support","agent_leader","processor_leader"]` vào
   `AppConfig.featurePermissions` production.
3. [CHỜ XÁC NHẬN QUA UI] Đăng nhập production bằng tài khoản **Agent/Processor/Support/Agent Leader/Processor Leader**
   thật → xác nhận vẫn thấy + dùng được tab "Order" như trước (không bị mất quyền do quên bước 2).
4. Đăng nhập bằng tài khoản **Manager** → xác nhận giờ CŨNG thấy tab "Order" (trước đây không
   thấy — xác nhận đúng thay đổi có chủ đích, không phải lỗi).
5. Vào trang Phân quyền, tick thêm 1 role khác (vd Kế toán) vào dòng "Xem tab Order" → đăng nhập
   tài khoản role đó → xác nhận thấy tab (trước đó không thấy). Bỏ tick lại → xác nhận mất quyền
   xem, kể cả gõ thẳng URL `/dashboard/orders`.

### 4.42 Chấm trạng thái "đang online" cạnh avatar ở trang Quản lý tài khoản (thêm 2026-08-23)

Trang "Quản lý tài khoản" (Admin, `/dashboard/users`) giờ hiện 1 chấm nhỏ ở góc avatar mỗi tài
khoản — xanh lá = đang online, xám = không online — dựa trên **Pusher Presence Channel**
(`presence-online-users`, MỚI hoàn toàn, khác 3 kênh `private-*` đã có sẵn). Cơ chế: MỌI user
đăng nhập (không chỉ Admin) đều tự subscribe kênh này ở `useRealtime()` (`src/hooks/
use-realtime.ts`, chạy 1 lần ở layout dashboard cạnh `hydrateFromServer()`) — bản thân việc
subscribe = "báo tôi đang online" với Pusher, tự động unsubscribe khi đóng tab/mất mạng = "báo
offline". Pusher tự dedupe theo `user_id` nếu 1 người mở nhiều tab/thiết bị (chỉ tính 1 lần, chỉ
"rời" khi TẤT CẢ tab đó đóng) — không cần code tự đếm connection.

**Route `POST /api/pusher/auth`** (đã có sẵn cho 3 kênh `private-*`) mở rộng thêm nhánh riêng
cho `presence-online-users` — gọi `pusher.authorizeChannel(socketId, channel, {user_id, user_info:
{name, role}})` thay vì `authorizeChannel(socketId, channel)` như kênh private (presence channel
BẮT BUỘC phải có `channel_data`, khác private channel). Không hạn chế role nào được subscribe
(mọi user đăng nhập đều được — dữ liệu presence chỉ gồm id/tên/role đồng nghiệp nội bộ, không
nhạy cảm), chỉ UI hiện chấm trạng thái là ở trang `/dashboard/users` vốn đã chỉ Admin truy cập
được (`ADMIN_NAV`, không phải feature permission riêng).

`App-store` thêm `onlineUserIds: string[]` (KHÔNG nạp cùng `hydrateFromServer`, chỉ cập nhật
realtime qua 3 action mới `setOnlineUserIds`/`addOnlineUserId`/`removeOnlineUserId` — bind vào 3
event Pusher chuẩn của presence channel: `pusher:subscription_succeeded` (danh sách online lúc
subscribe xong), `pusher:member_added`, `pusher:member_removed`). Reset về rỗng khi effect cleanup
(đóng tab/logout).

**Đã tự kiểm tra đầy đủ (2026-08-23)** bằng Playwright thật với **2 phiên đăng nhập thật khác
nhau** (2 browser context riêng biệt, không phải giả lập): đăng nhập Admin ở browser A, mở trang
Quản lý tài khoản → xác nhận chính Admin hiện chấm XANH (tự thấy mình online), tài khoản khác
(Quang Hua) hiện chấm XÁM. Đăng nhập Quang Hua ở browser B (Pusher thật, không mock) → đợi vài
giây, xác nhận chấm của Quang Hua trên browser A **tự chuyển XANH mà không cần F5** (nhận đúng
`pusher:member_added` qua Pusher cloud thật). Đóng hẳn browser B (ngắt kết nối) → đợi vài giây,
xác nhận chấm của Quang Hua trên browser A **tự chuyển lại XÁM** (nhận đúng
`pusher:member_removed`). `tsc --noEmit`/`eslint` sạch trên toàn bộ file mới/sửa.

**Không đổi schema/feature-permission** — không có bảng/cột DB nào mới (trạng thái online hoàn
toàn ở bộ nhớ Pusher + Zustand, không lưu DB), không có feature key mới. Chỉ cần deploy code,
**không cần** `prisma migrate deploy`, **không cần** script merge `AppConfig`. Yêu cầu duy nhất:
Pusher đã cấu hình đủ 6 biến môi trường (đã có sẵn từ mục 4.20) — nếu thiếu, `getPusherClient()`/
`getPusherServer()` tự trả `null`, chấm trạng thái mặc định luôn XÁM (không lỗi, chỉ mất tính
năng, đúng thiết kế graceful-degrade nhất quán với mọi tính năng Pusher khác trong app).

### 4.43 Phân quyền xem "Đang online" theo TỪNG USER (không theo role) + panel trong dropdown Tài khoản (thêm 2026-08-23, cùng ngày với mục 4.42)

Mở rộng mục 4.42 theo yêu cầu tiếp theo — trước đó chỉ Admin xem được (qua trang
`/dashboard/users`, chấm cạnh avatar). Giờ thêm 2 việc:

1. **Phân quyền theo TỪNG TÀI KHOẢN CỤ THỂ** (không phải theo Role như toàn bộ hệ thống
   `FeaturePermissions` hiện có) — Admin bật/tắt cho từng user riêng lẻ qua nút mắt (Eye/EyeOff)
   trên `UserCard` (`/dashboard/users`), lưu ở cột mới `User.canViewOnlinePresence` (Boolean,
   default `false`, additive). **Đây KHÔNG dùng chung cơ chế `AppConfig.featurePermissions`**
   (vốn là `Record<FeatureKey, Role[]>`) — cố ý thiết kế field riêng trên `User` vì yêu cầu là
   "theo từng user", không phải "theo role". Nút mắt tự ẩn trên card của Manager (Manager luôn
   bypass sẵn, xem bên dưới, nút sẽ vô nghĩa).
2. **Panel "Đang online" dời từ trang `/dashboard/users` (Admin-only) sang dropdown "Tài khoản"**
   ở góc phải header (`top-nav.tsx`, mọi user đều có sẵn dropdown này) — theo đúng yêu cầu "hiện
   ở góc phải phần quản lý tài khoản của mỗi user được phân quyền". Hiện DANH SÁCH user đang
   online (chỉ liệt kê ai đang online, KHÔNG hiện cả danh sách offline như trang Quản lý tài
   khoản — dropdown nhỏ gọn hơn). Gate: `user.role === "manager" || user.canViewOnlinePresence`
   — Manager luôn thấy (đúng convention `hasFeature()` bypass toàn app), user khác chỉ thấy nếu
   Admin đã cấp qua nút mắt ở bước 1. Chấm/danh sách trên trang `/dashboard/users` (mục 4.42)
   GIỮ NGUYÊN không đổi — 2 nơi hiển thị độc lập, cùng đọc chung `state.onlineUserIds`.

API: `GET /api/users` (list) + `PATCH /api/users/[id]` (route có sẵn) thêm field
`canViewOnlinePresence` — PATCH validate `typeof body.canViewOnlinePresence === "boolean"`,
gate bằng `canManageUsers()` sẵn có (cùng quyền `manageUsers` đang gate role/email/teamMemberIds),
không cần feature key mới.

**Đã tự kiểm tra đầy đủ (2026-08-23)** bằng Playwright thật với 2 phiên đăng nhập thật khác
nhau: Admin bấm nút mắt cấp quyền cho 1 tài khoản Processor thường (Quang Hua, không phải
Manager) → đăng nhập bằng đúng tài khoản đó ở browser khác, mở dropdown "Tài khoản" → xác nhận
thấy panel "ĐANG ONLINE (2)" liệt kê đúng Admin + chính mình (2 phiên đang mở), tên/avatar khớp
đúng. Trước khi cấp quyền, đã xác nhận dropdown của tài khoản đó KHÔNG có panel này (đúng gate).
Đã revert lại quyền test về `false` sau khi kiểm tra xong (không để lại trạng thái test trong
DB dev). `tsc --noEmit`/`eslint` sạch.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-23** — `prisma migrate deploy` nhắm production đã chạy (1 cột mới
   `canViewOnlinePresence` trên `users`, an toàn/additive/default `false`, không đổi hành vi
   hiện có).
2. Không cần script merge `AppConfig` (không đụng `DEFAULT_FEATURE_PERMISSIONS`/`DEFAULT_COLUMNS`).
3. Đăng nhập production bằng **Admin**, vào Quản lý tài khoản → xác nhận thấy nút mắt (Eye/EyeOff)
   cạnh mỗi tài khoản KHÔNG phải Manager → bấm cấp quyền cho 1 tài khoản thật.
4. Đăng nhập bằng đúng tài khoản vừa cấp → mở dropdown "Tài khoản" (avatar góc phải) → xác nhận
   thấy panel "Đang online" liệt kê đúng những ai đang thật sự online lúc đó.
5. Đăng nhập bằng 1 tài khoản KHÁC chưa được cấp (không phải Manager) → xác nhận dropdown "Tài
   khoản" của họ KHÔNG có panel này.
6. Vào lại Quản lý tài khoản (Admin), bấm nút mắt thu hồi quyền vừa cấp ở bước 3 → đăng nhập lại
   tài khoản đó → xác nhận panel biến mất khỏi dropdown.

### 4.44 [CHỜ XỬ LÝ] Cache cookie đăng nhập CRM agentc3 xuống DB (tầng 2) — bớt đăng nhập lại thừa giữa các route (thêm 2026-08-28)

Cache cookie session CRM agentc3 (`src/lib/agentc3-client.ts`) trước đây chỉ có 1 tầng — biến
module-scope `cachedCookie`, TTL 15 phút — nhưng mỗi `route.ts` trên Vercel là 1 Serverless
Function RIÊNG, module state tách biệt hoàn toàn: bấm nút "Check log"/"TTS & WIT" (route
`check-latest-tts`, tự đăng nhập xong) rồi mở chat so sánh WIT/TTS (route `compare-tts-wit-chat`)
vẫn phải đăng nhập lại dù vừa đăng nhập vài giây trước — người dùng nhận ra đúng vấn đề này
("lúc bấm get file đã đăng nhập và lấy link rồi, tại sao mất thời gian đăng nhập lại"). Thêm
`AppConfig.agentc3SessionCookie String?` + `AppConfig.agentc3SessionCookieAt DateTime?` (2 cột
mới, additive — cùng pattern `ringcentralSubscriptionId`/`ringcentralSubscriptionExpiresAt` đã
có sẵn) làm tầng cache thứ 2 dùng chung được giữa MỌI route/MỌI instance — xem
`.claude/skills/crm-tts-wit-compare/SKILL.md` mục lịch sử #21 cho chi tiết đầy đủ (thứ tự ưu
tiên đọc cookie, verify sống 2-process). **KHÔNG đụng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`**
nên **không cần** script merge `AppConfig`, chỉ cần migration.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-26** — `prisma migrate deploy` nhắm production đã chạy (migration
   `20260825151332_add_agentc3_session_cookie` — 2 cột mới trên `app_config`, an toàn/additive/
   nullable).
2. [CHỜ XÁC NHẬN QUA UI] Đăng nhập production, bấm nút "Check log"/"TTS & WIT" ở 1 hồ sơ đã liên kết CRM → ngay sau đó
   (trong vòng vài giây) mở popup "Get Files" → chọn TTS + WIT → hỏi 1 câu bất kỳ trong chat so
   sánh → xác nhận phản hồi nhanh hơn hẳn so với trước (không phải chờ thêm 1 lượt đăng nhập CRM
   ẩn phía sau — khó đo trực tiếp qua UI, có thể kiểm tra gián tiếp qua thời gian phản hồi tổng
   thể ngắn hơn rõ rệt so với lúc DB cookie đã hết hạn 15 phút).

### 4.45 [CHỜ XỬ LÝ] Admin ẩn/hiện toàn cục từng nút trong popup "Gửi dữ liệu" (thêm 2026-08-30)

Popup "Gửi dữ liệu" (`SendActionsMenuButton`, cạnh badge Status trên bảng Hồ sơ) gồm 5 nút:
Update to CRM/Test Sheet/Send mail to CPA/Send to Google Sheet/Send email to client. 3 nút sau
đã có cơ chế cấp quyền theo TỪNG ROLE qua `FeaturePermissions` (Manager luôn bypass, xem trang
Phân quyền) — nhưng theo yêu cầu người dùng, cần thêm 1 lớp **bật/tắt TOÀN CỤC** cho MỖI nút
(khi tắt, ẩn với TẤT CẢ mọi người, KỂ CẢ Manager) — khác hẳn ý nghĩa `FeaturePermissions`, nên
KHÔNG dùng chung cơ chế đó mà thêm field riêng `AppConfig.sendActionsHidden` (Json?, additive —
`Partial<Record<"updateToCrm"|"testSheet"|"cpaEmail"|"sheet"|"clientEmail", boolean>>`, xem
`SendActionId`/`SendActionsHidden` trong `src/lib/types.ts`). Dialog quản lý
(`SendActionsVisibilityDialog`, `src/components/send-actions-visibility-dialog.tsx`) đặt trên
trang Phân quyền (đã gate manager-only sẵn ở đó) — 5 checkbox tick/bỏ tick, lưu ngay không cần
bước "Lưu" riêng (`setSendActionHidden` trong `app-store.ts`, gọi `PUT /api/config` chỉ chấp
nhận từ role manager, cùng pattern `careOfEligibleNoticeTypes`). `cases/page.tsx` áp dụng cờ ẩn
bằng cách AND thêm `!sendActionsHidden.xxx` vào từng biến `showXxxAction` sẵn có. Đặt dialog
quản lý ở trang Phân quyền (không đặt gear icon ngay trong popup từng dòng hồ sơ) vì nếu Admin
tắt hết cả 5 nút, popup "Gửi dữ liệu" của 1 dòng có thể không còn hiện ra nữa (điều kiện render
`(showSendToSheetAction || ... || showUpdateToCrmAction || canSendSmsFeature)`) — cần 1 chỗ LUÔN
truy cập được để bật lại, không phụ thuộc trạng thái riêng của từng dòng hồ sơ.

**Gotcha thật gặp khi tự test (2026-08-30)**: sau khi `npx prisma generate` (đã chạy `prisma
migrate dev` xong), dev server ĐANG CHẠY TỪ TRƯỚC (khởi động trước khi generate) vẫn dùng
Prisma Client CŨ trong bộ nhớ — `PUT /api/config` trả `500` khi cố ghi `sendActionsHidden` (field
Prisma Client cũ không biết tới). Đúng gotcha "Prisma Client staleness" đã ghi nhận nhiều lần
trước đó trong file này — **PHẢI kill hẳn process dev server cũ rồi khởi động lại** (không chỉ
chạy `prisma generate`) sau khi đổi schema, kể cả khi migration đã áp dụng thành công vào DB.

**Đã tự kiểm tra đầy đủ qua Playwright thật (2026-08-30)** — sau khi restart dev server: đăng
nhập Admin, vào trang Phân quyền, mở dialog "Ẩn/hiện nút", bỏ tick "Update to CRM" → `PUT
/api/config` trả `200` → quét lại bảng Hồ sơ xác nhận nút "Update to CRM" biến mất khỏi popup
"Gửi dữ liệu" ở MỌI hồ sơ đang hiện nó trước đó (63/72 hồ sơ dev có `clientLink` trỏ CRM) →
reload trang xác nhận vẫn ẩn (persist thật, không chỉ optimistic UI) → tick lại → xác nhận hiện
trở lại + persist qua reload. `tsc --noEmit`/`eslint` sạch.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. ✅ **Đã xong 2026-08-30** — `prisma migrate deploy` nhắm production đã chạy (migration
   `20260830063829_add_send_actions_hidden` — 1 cột mới trên `app_config`, an toàn/additive/
   nullable, null mặc định = không ẩn nút nào, không đổi hành vi hiện có).
2. Không cần script merge `AppConfig.featurePermissions`/`columns` (field độc lập, không đụng
   `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`).
3. [CHỜ XÁC NHẬN QUA UI] Đăng nhập production bằng tài khoản **manager** thật, vào trang Phân quyền → xác nhận thấy
   nút "Ẩn/hiện nút" cạnh 3 nút cấu hình sẵn có (CPA Email/Google Sheet/Client Email) → mở dialog,
   tắt thử 1 nút (vd "Send to Google Sheet") → vào bảng Hồ sơ, mở popup "Gửi dữ liệu" ở 1 hồ sơ
   đang đủ điều kiện hiện nút đó → xác nhận nút đã biến mất.
4. Reload trang → xác nhận vẫn ẩn (đã lưu DB, không phải chỉ optimistic). Bật lại → xác nhận hiện
   trở lại đúng theo `FeaturePermissions`/status/email như hành vi cũ.
5. Đăng nhập bằng tài khoản KHÔNG phải manager → xác nhận KHÔNG thấy nút "Ẩn/hiện nút" trên trang
   Phân quyền (dialog chỉ hiện với manager, cùng gate với 3 dialog cấu hình khác trên trang đó).

### 4.46 Fix "Send to Google Sheet"/mail CPA + "Test Sheet" trỏ nhầm tháng gần nửa đêm giờ Phoenix (thêm 2026-08-30)

Người dùng báo "hiện tại hệ thống đang tháng 8 nhưng mai đã là Sep, send row to google sheet
hệ thống vẫn tháng 8 nhưng đã sent đến row tháng 9". Nguyên nhân: `buildMonthYear()`
(`src/lib/month-year.ts`, dùng cho tên tab Google Sheet + token `{monthYear}` trong mail CPA)
và `currentMonthKey()` (`src/lib/cpa-review-month.ts`, dùng cho route `test-cpa-review-sheet`
xác định THÁNG NÀO của tab "CPA Review" sẽ nhận dòng mới) đều gọi trực tiếp
`now.getFullYear()`/`now.toLocaleString()`/`toMonthKey(new Date())` — các hàm này đọc theo múi
giờ MÔI TRƯỜNG CHẠY, mà cả 2 hàm đều được gọi Ở SERVER (route `send-to-sheet`, `cpa-email-
template.ts`, `test-cpa-review-sheet`, chạy trên Vercel = giờ UTC), không phải múi giờ nghiệp
vụ Phoenix (UTC-7, không DST) của công ty. Khoảng 17h-24h giờ Phoenix MỖI NGÀY, UTC đã sang
ngày/tháng mới trước đó ~7 tiếng — đúng khung giờ này, "Test Sheet" tạo dòng CPA Review vào
SAI tháng (tháng sau), và "Send to Google Sheet"/mail CPA trỏ nhầm sang tab tháng sau, dù
"hôm nay" thực tế của công ty vẫn thuộc tháng cũ.

**Cách sửa**: cả 2 hàm đổi sang tính theo giờ Phoenix tường minh qua `Intl.DateTimeFormat`
(`timeZone: "America/Phoenix"`) — `currentMonthKey()` tái dùng `toPhoenixDateStr()`
(`report-period.ts`, cùng cơ chế `todayIsoDate()` đã dùng cho cột "Ngày gửi"), `buildMonthYear()`
tự dựng qua `formatToParts()`. Chữ ký hàm giữ nguyên (`buildMonthYear(now: Date)`,
`currentMonthKey(): string`) — chỉ đổi cách đọc bên trong, không cần sửa nơi gọi.

**Đã verify sống**: truyền thẳng 2 mốc UTC quanh ranh giới nửa đêm Phoenix
(`2026-09-01T06:59:00Z` = 31/08 23:59 Phoenix, `2026-09-01T07:01:00Z` = 01/09 00:01 Phoenix) vào
`buildMonthYear()` — mốc đầu ra đúng "Aug26" (KHÔNG còn nhảy sang "Sep26" như code cũ sẽ làm
nếu server chạy giờ UTC), mốc sau ra đúng "Sep26". `tsc --noEmit`/`eslint` sạch. **Không cần
bước production nào** (thuần logic tính thời gian, không đổi schema/API) — chỉ cần deploy code.

### 4.47 [CHỜ XỬ LÝ] Đồng bộ Sheet→App tab "CPA Review" viết lại — không cần SSN, gộp mọi ô 1 dòng, tự xoá khi xoá trắng (thêm 2026-08-31)

Người dùng báo "khi nhập ở Google Sheet vẫn chưa nhận trên Phần mềm, Production" — debug trực
tiếp qua webhook thật (gọi thẳng `POST /api/cpa-review-sheet/webhook` với đúng secret production,
tạo record thành công) xác nhận ROUTE hoạt động đúng, vấn đề nằm ở logic CŨ của
`onCpaReviewEdit` (Apps Script): `if (row < 4) return;` rồi `var ssn = ...; if (!ssn) return;` —
**bắt buộc dòng phải có SSN (cột D) mới gửi bất cứ gì**, và MỖI LẦN CHỈ GỬI ĐÚNG 1 Ô vừa sửa
(không phải cả dòng). Hệ quả: gõ Name/Phone/... TRƯỚC KHI gõ SSN bị bỏ qua âm thầm, mất hẳn
(không lỗi, không có gì để biết) — đúng nguyên nhân người dùng báo. Đã viết lại toàn bộ theo 3
yêu cầu liên tiếp cùng ngày:

1. **Bỏ hẳn yêu cầu bắt buộc SSN** ("không cần phải có SSN ở GGS mới đồng bộ lên phần mềm, mà
   cột nào có thông tin cũng phải đồng bộ") — `onCpaReviewEdit` giờ LUÔN quét lại TOÀN BỘ dòng
   (A..AH) và gửi payload MỚI `{secret, ssn, row, fullRowSync: true, cells: [{columnIndex,
   rawValue}, ...]}` ở MỌI lần sửa 1 ô bất kỳ trong dòng (row >= 4), không riêng cột SSN. Webhook
   (nhánh `fullRowSync` mới trong `cpa-review-sheet/webhook/route.ts`) định danh dòng ưu tiên
   qua SỐ DÒNG THẬT (`row`, luôn có mặt) — chỉ fallback qua SSN nếu có. Record mới có thể tạo
   ra HOÀN TOÀN không có `custom.ssn` (chỉ có Name/Phone/...) — hợp lệ, `custom` là JSON tự do.
2. **Bug tự phát hiện khi verify bước 1**: gõ liên tiếp nhiều ô trong vài giây (cách nhập tay
   bình thường — Name rồi Phone rồi SSN) khiến lượt gửi SAU bị chính cơ chế "App luôn thắng"
   (`isRecentlyUpdatedByApp`, mục 4.22) TỰ CHẶN NHẦM — hàm đó chỉ nhìn THỜI GIAN ghi gần nhất,
   không phân biệt được "app vừa ghi thật" (PATCH /api/cpa-review/[id]) với "chính webhook Sheet
   này vừa ghi trước đó vài giây" (do giờ MỌI edit đều gửi lại cả dòng, tần suất webhook ghi cao
   hơn hẳn trước). Sửa bằng field nội bộ `custom.__syncedFrom` ("app" hoặc "sheet", không leak ra
   Sheet/UI vì cả 2 chỉ đọc field có tên cụ thể) — gắn "app" ở `PATCH /api/cpa-review/[id]` và
   `POST /api/cases/[id]/test-cpa-review-sheet` (Test Sheet), gắn "sheet" ở nhánh `fullRowSync`
   — "App luôn thắng" giờ CHỈ chặn nếu lần ghi gần nhất thật sự đến từ "app".
3. **Tự xoá record khi Sheet xoá trắng 1 dòng** ("row đó không còn bất cứ thông tin gì thì phần
   mềm tự động delete 1 dòng đó") — KHÁC `rowsRemoved`/`onCpaReviewChange` đã có (dòng bị XOÁ
   HẲN khỏi Sheet, lệch số dòng các dòng sau): đây là dòng VẪN CÒN vị trí trên Sheet nhưng nội
   dung A..AH đều rỗng (bôi đen xoá hết nội dung, không xoá dòng). `onCpaReviewEdit` phát hiện
   `cells.length === 0` → gửi tín hiệu riêng `{secret, row, rowCleared: true}` — webhook (nhánh
   `rowCleared` mới) khớp record qua `rowIndex` cache theo số dòng rồi xoá thật.

**Đã tự kiểm tra đầy đủ qua webhook thật (dev server + DB thật, tháng test riêng `2099-01` để
không đụng dữ liệu thật)**: (a) gõ Name không SSN → tạo đúng record chỉ có Name; (b) gọi 3 lần
LIÊN TIẾP (Name → +Phone → +SSN, cách nhau không tới 1 giây) → đúng 1 record duy nhất, cập nhật
đủ cả 3 lần (không bị "app_wins" chặn nhầm lần 2/3); (c) gửi `rowCleared: true` → record bị xoá
đúng, còn 0 record. `tsc --noEmit`/`eslint` sạch.

**QUAN TRỌNG — mọi Sheet ĐÃ kết nối trước bản sửa này phải dán lại script mới** (giống gotcha
đã ghi ở mục 4.22 "onEdit là simple trigger" trước đó) — script cũ vẫn gửi payload dạng CŨ (1 ô,
bắt buộc SSN), không có 2 tính năng mới. Cách lấy lại: tab CPA Review → chọn đúng tháng → nút
"Hướng dẫn" → "Copy script" → dán ĐÈ vào Apps Script của đúng Sheet đó → Save → chọn lại
`installCpaReviewTriggers` → Run → Allow lại (script/trigger đã đổi tên hàm nội bộ đủ nhiều lần
qua các đợt sửa trước, nên luôn cần cài lại sau mỗi lần đổi logic `onCpaReviewEdit`).

**Bổ sung cùng ngày (2026-08-31, sau khi báo cáo bản đầu ở trên đã lên production) — 4 bug thật
tiếp theo, sửa trong cùng 1 đợt**: người dùng báo liên tiếp "xóa trên phần mềm vẫn chưa xóa trên
google sheet", "khi insert link dưới Google thì phần mềm vẫn chưa lấy link insert lên", "khi tôi
input 1 row dưới google sheet thì phần mềm nhảy 2 row tương tự", và "đảm bảo dữ liệu từ row 4 trở
đi của sheet đều đồng bộ dữ liệu từ row 4 trở đi của Phần mềm". Cả 4 đều là hệ quả trực tiếp của
bản viết lại ở trên:

1. **App→Sheet xoá không hoạt động**: `deleteRecordRowFromCpaReviewSheet()`
   (`cpa-review-sheet-sync.ts`) có `if (!ssn) return;` NGAY ĐẦU — record giờ hợp lệ dù KHÔNG có
   SSN (đúng thiết kế mới) nhưng hàm xoá vẫn đòi SSN mới chạy tiếp, bỏ qua âm thầm mọi record
   không SSN. Sửa: bỏ hẳn early-return theo SSN, chỉ cần `rowIndex[record.id]` (định danh CHÍNH
   theo số dòng) tồn tại là đủ để xoá, SSN chỉ còn là fallback tra cứu phụ.
2. **nameLink (link chèn ở ô Name trên Sheet) không lên app**: nhánh `fullRowSync` MỚI trong
   webhook hoàn toàn THIẾU xử lý field `nameLink` — chỉ nhánh single-cell CŨ (không còn Apps
   Script nào gửi nữa) có xử lý này. Sửa: thêm đọc `body.nameLink` và merge vào `custom.nameLink`
   trong nhánh `fullRowSync`.
3. **Tạo trùng 2 record cho 1 dòng Sheet khi gõ nhanh liên tiếp nhiều ô**: race condition —
   `UrlFetchApp.fetch()` tốn 200-500ms+, gõ nhanh (Tab qua nhiều cột, hoặc paste) khiến 2 lượt
   `onCpaReviewEdit` chạy CHỒNG LẤN THẬT SỰ, lượt sau đọc `rowIndex` CŨ (chưa thấy record lượt
   trước vừa lưu) nên tạo thêm 1 record trùng. Sửa: bọc toàn bộ `onCpaReviewEdit` bằng
   `LockService.getScriptLock()` (chờ tối đa 10s) — tuần tự hoá MỌI lượt sửa của CÙNG script,
   đảm bảo lượt sau luôn thấy đúng kết quả lượt trước.
4. **Thứ tự dòng trong app không khớp thứ tự dòng thật trên Sheet**: record mới tạo qua
   `fullRowSync` dùng `sortOrder: -Date.now()` (quy ước "mới nhất lên đầu" mượn từ bảng Hồ sơ
   chính) — khiến dòng vừa gõ LUÔN nhảy lên ĐẦU app bất kể vị trí thật trên Sheet. Sửa: dùng
   THẲNG số dòng Sheet (`fullRowSheetRow`, vd 4/5/6...) làm `sortOrder` — `GET /api/cpa-review`
   sort tăng dần nên thứ tự app tự khớp đúng thứ tự Sheet. Áp dụng cho CẢ tạo mới lẫn cập nhật
   (tự "chữa lành" sortOrder nếu record được tạo từ đường khác — nút "Thêm"/"Test Sheet" — rồi
   mới được gán 1 dòng Sheet cụ thể).

**Đã verify sống cả 2 (nameLink + thứ tự sortOrder)** qua webhook thật (tháng test riêng
`2099-02`): tạo dòng ở row 10 kèm nameLink TRƯỚC, rồi tạo dòng ở row 4 SAU — record row 4 vẫn
hiện TRƯỚC record row 10 khi sort theo sortOrder (đúng thứ tự Sheet, không phải thứ tự tạo),
nameLink lưu đúng nguyên văn. Riêng cơ chế LockService (chỉ chạy được trong Apps Script thật,
không mô phỏng được từ máy local) — chưa tự verify sống, chỉ dựa vào đây là pattern chính thức
Google khuyến nghị cho đúng tình huống này. **Nếu sau khi deploy vẫn còn gặp lại 2 record trùng
cho 1 dòng Sheet, đây là chỗ đầu tiên cần xem lại** (kiểm tra Executions log của Apps Script xem
có request nào bị `lockErr` timeout không).

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. Không cần `prisma migrate deploy`/script merge `AppConfig` (thuần logic webhook + Apps
   Script, không đổi schema/feature-permission).
2. Với Sheet tháng đang dùng thật (production), dán lại script mới theo hướng dẫn ở trên (script
   đã đổi thêm lần nữa để thêm LockService — BẮT BUỘC dán lại dù đã dán 1 lần trước đó trong
   cùng ngày).
3. Gõ thử Name vào 1 dòng mới KHÔNG kèm SSN → xác nhận app nhận được (tab CPA Review hiện dòng
   mới có Name, các cột khác trống).
4. Gõ tiếp Phone rồi SSN cho ĐÚNG dòng đó, cách nhau vài giây → xác nhận cả 2 lần đều lên app
   (không bị mất Phone như thiết kế cũ), vẫn đúng 1 dòng (không tạo trùng).
5. Gõ THẬT NHANH liên tiếp nhiều ô khác nhau của CÙNG 1 dòng mới (paste nhiều ô cùng lúc, hoặc
   Tab nhanh qua từng cột) → xác nhận vẫn CHỈ đúng 1 dòng trong app (không tạo trùng 2 dòng).
6. Xoá trắng toàn bộ nội dung dòng đó (bôi đen, Delete — KHÔNG xoá hẳn dòng) → xác nhận dòng
   tương ứng biến mất khỏi tab CPA Review trong app.
7. Chèn link (Insert link) vào ô Name của 1 dòng đã có SSN → xác nhận link hiện đúng lên app
   (icon mở link cạnh tên).
8. Xoá 1 dòng qua app (nút thùng rác) → xác nhận dòng đó cũng biến mất khỏi Sheet thật (không
   chỉ biến mất trên app).
9. Gõ 1 dòng mới vào Sheet ở vị trí SỚM HƠN (vd row 4) SAU KHI đã có dữ liệu ở row muộn hơn (vd
   row 10) — xác nhận dòng row 4 hiện TRƯỚC dòng row 10 trong app (khớp đúng thứ tự Sheet, không
   phải thứ tự gõ trước/sau).
10. Sửa 1 hồ sơ ĐANG CÓ SẴN qua app (PATCH, vd đổi Status) → xác nhận Sheet vẫn cập nhật đúng
    (App→Sheet không bị ảnh hưởng bởi thay đổi này) và KHÔNG bị ghi đè lại bởi chính echo Sheet
    gửi về ngay sau đó (kiểm tra qua reload — giá trị giữ nguyên đúng theo app, không nhảy về gì
    khác).

**Bổ sung cùng ngày (2026-08-31, sau khi báo cáo 4 bug ở trên đã lên production) — 2 thay đổi
nữa, không liên quan schema/webhook**:

1. **Đã THỬ RỒI GỠ BỎ tính năng "tự thêm dòng mới khi gõ vào dòng cuối bảng CPA Review trên
   app"** — từng thêm (Admin/user gõ vào 1 trong 6 cột A-F của dòng cuối cùng tự động tạo thêm
   1 dòng trống kế tiếp, giống hành vi Excel) nhưng người dùng báo bug "nhập dòng 4 trên app
   thì Sheet lại nhảy ở dòng 5 và app tự tạo thêm 1 dòng 5 trống" ngay sau khi tính năng lên
   production. Điều tra kỹ (kiểm tra `pushRecordToSheet`/`syncRecordToCpaReviewSheet`/DB thật)
   không chứng minh được cơ chế chính xác gây ra bug (record trống không SSN vốn không bao giờ
   được đẩy lên Sheet theo code hiện tại — `syncRecordToCpaReviewSheet` vẫn còn early-return
   theo SSN, KHÁC `deleteRecordRowFromCpaReviewSheet` đã bỏ gate này ở mục sửa trước đó — nên
   giả thuyết ban đầu "dòng trống tranh dòng Sheet" không thực sự khớp), nhưng theo yêu cầu rõ
   ràng của người dùng ("không tự thêm dòng, chỉ tự xuống dòng khi có dữ liệu mới từ send to
   CPA Review") đã REVERT HẲN tính năng này khỏi `src/app/dashboard/cpa-review/page.tsx` — ô
   nhập A-F giờ chỉ gọi `updateCpaReviewCell()`, không còn gọi `addCpaReviewRow()` kèm theo bất
   kể gõ gì. Cơ chế tạo dòng mới cho tab CPA Review giờ CHỈ còn 2 đường: nút "Thêm" tay, và
   "Test Sheet"/"Send to CPA Review" ở bảng Hồ sơ chính (route riêng, độc lập hoàn toàn, không
   dùng chung logic này) — không đụng gì tới `syncRecordToCpaReviewSheet` (vẫn giữ nguyên gate
   SSN, không phải phần thay đổi trong đợt này).
2. **Cột Name khi đẩy App→Sheet đổi từ căn giữa sang căn TRÁI** ("cột Name khi đẩy xuống google
   sheet nên Left column chứ ko center column") — `centerAlignRow()` (chỉ chạy cho dòng MỚI)
   vẫn giữ nguyên căn giữa CẢ dòng như cũ, nhưng thêm hàm mới `leftAlignColumn()`
   (`src/lib/google-sheets.ts`) gọi NGAY SAU đó trong `pushRecordToSheet()`
   (`cpa-review-sheet-sync.ts`) để ghi đè lại riêng cột Name (cột B, `NAME_COLUMN_INDEX`) thành
   căn trái — áp dụng cho **MỌI lần ghi** (không chỉ dòng mới), vì dòng có sẵn cũng có thể đã bị
   căn giữa từ trước khi có yêu cầu này (mục 4.16 phần centerAlignRow, thêm 2026-08-16).

**Chưa verify sống qua Playwright/webhook thật** cho cả 2 thay đổi này (chỉ `tsc --noEmit`/
`eslint` sạch) — cần xác nhận qua UI thật trước khi coi là xong hẳn.

**Sau khi deploy code này lên production**: không cần `prisma migrate deploy`/script merge
`AppConfig` (thuần logic UI + format Sheet, không đổi schema/feature-permission). Kiểm tra: (a)
gõ vào dòng CUỐI CÙNG của bảng CPA Review trên app → xác nhận KHÔNG tự thêm dòng mới nào (chỉ
lưu đúng ô vừa gõ); (b) "Test Sheet"/"Send to CPA Review" ở bảng Hồ sơ chính vẫn tạo dòng mới
bình thường (không bị ảnh hưởng bởi revert); (c) sửa 1 ô Name bất kỳ trên app (hoặc thêm 1 dòng
mới) → xác nhận ô Name tương ứng trên Sheet thật căn TRÁI, các cột khác trong cùng dòng vẫn căn
giữa như cũ (không bị đổi theo).

**Bổ sung 2026-09-02 — 2 bug thật tiếp theo phát hiện khi debug live trên production (dữ liệu
chạy thật, chỉ đọc DB để chẩn đoán, không ghi/xoá gì)**:

1. **Ngày lệch 1 hôm giữa Sheet và app** (báo cáo thật: "cột date 2025 google sheet là 09/01/26
   nhưng app là 08/31/26") — `parseSheetDate()` (`cpa-review-sheet-columns.ts`) ở nhánh fallback
   cuối (chuỗi dạng `Date.toString()`, Apps Script trả về khi ô có định dạng số không phải
   "Date" thuần) dùng `new Date(trimmed).getFullYear()/getMonth()/getDate()` với Ý ĐỊNH "lấy giờ
   LOCAL để tránh lệch múi giờ" (comment cũ) — nhưng trên Vercel, "local" của Node runtime
   CHÍNH LÀ UTC (không phải giờ Việt Nam mà Apps Script project đang chạy) → `new Date(...)` quy
   đổi chuỗi (đã có offset GMT+07:00 nhúng sẵn) thành 1 thời điểm UTC tuyệt đối RỒI lấy lại
   ngày/tháng/năm theo UTC đó — 00:00 giờ Việt Nam = 17:00 UTC hôm TRƯỚC, nên kết quả luôn lùi
   lại đúng 1 ngày. Sửa triệt để: đọc thẳng ngày/tháng/năm IN RA TRONG chuỗi bằng regex
   (`/^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})/`), không quy đổi qua bất kỳ múi giờ nào — verify
   bằng script độc lập ép `TZ=UTC` (giống môi trường Vercel thật): bản cũ cho `2026-08-31`, bản
   mới cho đúng `2026-09-01`.
2. **Xoá 1 ô riêng lẻ trên Sheet không xoá theo trên app** (báo cáo thật: "google sheet xóa date
   nhưng trên app không xóa, sau khi xóa bỏ lại cũng không thay đổi") — `onCpaReviewEditLocked`
   (Apps Script, sinh trong `buildAppsScript()`) quét cả dòng rồi **loại bỏ MỌI ô rỗng khỏi
   payload gửi lên**, kể cả ô VỪA bị người dùng chủ động xoá trong chính lần sửa này — thiết kế
   này vốn để tránh gửi rỗng cho các ô "chưa từng điền" (sẽ xoá nhầm field app đang giữ nhưng
   chưa kịp đẩy xuống Sheet), nhưng tác dụng phụ là ô vừa xoá cũng bị coi như "chưa từng điền",
   webhook không bao giờ nhận được tín hiệu để xoá field tương ứng trong `custom`. Sửa: dùng
   `e.range.getColumn()`/`getNumColumns()` (từ chính sự kiện `onEdit`) để biết CHÍNH XÁC cột nào
   vừa được sửa trong lần này (bao cả paste/xoá nhiều ô cùng lúc) — ô rỗng NẰM TRONG phạm vi vừa
   sửa vẫn được gửi (rawValue rỗng, webhook đã có sẵn logic xoá field khi nhận rawValue rỗng),
   ô rỗng NGOÀI phạm vi đó (chưa từng điền) vẫn bị bỏ qua như cũ. Đồng thời sửa điều kiện phát
   hiện "dòng bị xoá trắng hoàn toàn" từ `cells.length === 0` sang cờ `hasNonEmpty` riêng — vì
   giờ `cells` có thể chứa đúng 1 phần tử rỗng (ô vừa xoá) dù cả dòng đã trống, `cells.length`
   không còn đáng tin để phát hiện "xoá trắng cả dòng" nữa.

3. **Bôi đen NHIỀU DÒNG rồi sửa/xoá/paste 1 lần chỉ đồng bộ đúng dòng ĐẦU TIÊN** (phát hiện khi
   rà soát theo yêu cầu rõ ràng "tất cả sửa xoá ở các cột đều phải cập nhật đúng row") — Google
   Sheets bắn ĐÚNG 1 sự kiện `onEdit` cho CẢ VÙNG khi chọn nhiều dòng rồi Delete/paste 1 khối,
   nhưng `onCpaReviewEdit(e)` bản trước chỉ đọc `e.range.getRow()` (dòng đầu tiên của vùng) —
   mọi dòng còn lại trong vùng bị bỏ sót hoàn toàn, không có tín hiệu nào gửi lên app. Sửa: lặp
   qua từng dòng trong `e.range.getNumRows()` (từ `startRow` tới `startRow + numRows - 1`), gọi
   `onCpaReviewEditLocked` cho từng dòng — vẫn trong CÙNG 1 lần giữ `LockService` (không lock
   lại mỗi dòng), tuần tự từng `UrlFetchApp.fetch` một.

**QUAN TRỌNG — như mọi lần đổi logic `onCpaReviewEdit`/`onCpaReviewEditLocked` trước đây, PHẢI
dán lại script mới cho MỌI Sheet đang kết nối** (tab "Hướng dẫn" → "Copy script" → dán đè vào
Apps Script → Save → chọn `installCpaReviewTriggers` → Run → Allow lại).

**Chỉ verify được bug #1 qua script độc lập** (ép `TZ=UTC`, không cần Sheet thật) — bug #2 và
#3 cần Apps Script thật chạy trong Google Sheet (không mô phỏng được `e.range`/`onEdit` từ máy
local), **chưa tự verify sống**. `tsc --noEmit`/`eslint` sạch trên cả 2 file sửa (cả 2 đợt).

**Sau khi deploy code này lên production**: không cần `prisma migrate deploy`/script merge
`AppConfig` (thuần logic parse ngày + Apps Script, không đổi schema/feature-permission). Kiểm
tra: (a) gõ 1 ngày bất kỳ vào cột Date của 1 năm trên Sheet → xác nhận app hiện ĐÚNG NGÀY đó
(không lệch 1 hôm); (b) trên 1 dòng đã có dữ liệu ở nhiều cột, xoá riêng lẻ 1 ô Date (không xoá
cả dòng) → xác nhận field ngày tương ứng trong app cũng bị xoá theo (trống, không giữ giá trị
cũ); (c) gõ lại giá trị mới vào đúng ô đó → xác nhận app cập nhật đúng giá trị mới đó.

### 4.48 [CHỜ XỬ LÝ] Mỗi Processor tự cấu hình Sheet RIÊNG cho bảng cá nhân "For Processor" (tab Report), đồng bộ 2 chiều (thêm 2026-09-02)

Theo yêu cầu "ở màn hình Report của For Processor, cho mỗi tài khoản tự cấu hình link Google
Sheet riêng để đồng bộ" — nút mới **"Sheet của tôi"** (cạnh nút "Quản lý task" nếu có, trong
bảng CÁ NHÂN của Processor — KHÁC hẳn `ProcessorReportSheetConfigDialog` đã có sẵn cho bảng
TỔNG HỢP của Leader, cả 2 tồn tại song song, không thay thế nhau) — mỗi Processor tự kết nối 1
Google Sheet của riêng họ, đồng bộ 2 chiều ở mức TỪNG NGÀY (khác bảng Leader vốn chỉ đồng bộ số
CỘNG DỒN cả tháng theo từng Processor).

**Đổi kiến trúc giữa chừng (đọc trước khi động vào tính năng này)**: bản ĐẦU dùng Service
Account chung (giống hệt CPA Review — mỗi Processor share quyền Editor Sheet của họ cho email
Service Account) theo đúng yêu cầu ban đầu "dùng chung CPA Review". Ngay khi thử áp dụng thật,
phát hiện **Sheet của Processor có thể bị khoá chia sẻ** (tổ chức/chủ sở hữu chỉ cho phép đúng
1 email cụ thể sửa, không cho mời thêm Editor ngoài) — Service Account không share được vào
Sheet dạng này. Đã đổi hẳn sang **OAuth2 THEO TỪNG USER** (dùng lại CHÍNH `User.googleRefreshToken`
đã có sẵn cho tính năng "Send to Google Sheet" — không thêm field/token mới) — App ghi Sheet
bằng danh nghĩa TÀI KHOẢN GOOGLE THẬT của Processor đó (vốn đã có quyền Editor sẵn trên Sheet
của chính họ), không cần bước share quyền nào cả. Chiều Sheet→App (Apps Script) hoàn toàn
KHÔNG đổi giữa 2 phương án — Apps Script luôn chạy dưới quyền chính chủ Sheet, không liên quan
gì tới cách App ghi ngược lại.

**Kiến trúc cuối cùng**:
1. **`User.ownProcessorReportSheetConfig`** (cột `Json?` mới, additive, migration
   `20260902094233_add_processor_own_report_sheet`) — `Record<"YYYY-MM",
   OwnProcessorReportSheetConfig>` — mỗi tháng 1 kết nối riêng (cùng tinh thần CPA Review/bảng
   Leader), nhưng lưu TRÊN CHÍNH User (không phải AppConfig) vì đây là cấu hình CÁ NHÂN, không
   ai khác xem/sửa được. `OwnProcessorReportSheetConfig = {sheetId, gid, tabName, webhookSecret,
   connectedAt}` — KHÔNG có `taskRowMap`/`userColumnMap`/`rowIndex` như CPA Review/bảng Leader
   vì layout HOÀN TOÀN CỐ ĐỊNH, tính trực tiếp không cần cache: dòng = 2 + thứ tự task trong
   `AppConfig.processorReportTasks` (cùng thứ tự bảng Leader dùng), cột = ngày trong tháng (cột
   B = ngày 1).
2. **`src/lib/processor-own-report-sheet-sync.ts`** (module mới) — `connectOwnReportSheet`/
   `resyncOwnReportSheet` (ghi toàn bộ layout, nhận `refreshToken` do ROUTE tự kiểm tra/truyền
   vào, KHÔNG tự throw khi "chưa kết nối" — phân biệt rõ với `GoogleAuthExpiredError` chỉ dùng
   cho "đã kết nối nhưng token hết hạn/bị thu hồi" giữa chừng 1 lệnh gọi API), `pushOwnReportCell`
   (đẩy đúng 1 ô, best-effort, tự xoá `googleRefreshToken` nếu phát hiện token chết — cùng
   pattern route `send-to-sheet`), `applyOwnReportSheetCells` (webhook Sheet→App, "App luôn
   thắng" grace window 5s dựa `ProcessorReportEntry.updatedAt`, KHÔNG cần marker `__syncedFrom`
   phức tạp như CPA Review vì Apps Script chỉ gửi ĐÚNG ô vừa sửa — không full-row-rescan nên
   tần suất webhook thấp hơn hẳn, ít rủi ro tự chặn nhầm).
3. **`src/lib/google-sheets.ts`** thêm 2 export mới dùng chung: `getOAuthSheetsClient(refreshToken)`
   (trả về client Sheets API OAuth theo user, tái dùng được cho MỌI helper khác trong file vốn
   nhận tham số `sheets` chung — `writeCells`/`ensureRowExists`/`ensureSheetGridSize`/
   `resolveTabNameFromGid`, tất cả AUTH-AGNOSTIC sẵn) và `throwIfGoogleAuthExpired(err)` (tách
   riêng phần nhận diện lỗi `invalid_grant` từ `appendRowToSheet`, dùng lại được ở nơi khác).
4. **Route `POST/GET/DELETE /api/config/processor-own-report-sheet`** — chỉ role `processor`
   tự truy cập được (không cần feature permission riêng, không phải Admin/Leader cấu hình hộ).
   `POST` (connect/resync) kiểm tra `me.googleRefreshToken` TRƯỚC, trả 428 "GOOGLE_NOT_CONNECTED"
   nếu chưa kết nối — client tự mở popup `connectGoogleAccount()` (cùng UX nút "Send to Google
   Sheet" đã có) rồi gọi lại action, không cần user bấm 2 lần.
5. **Route `POST /api/processor-own-report-sheet/webhook`** — public (secret-based, giống CPA
   Review), dò user+tháng khớp secret bằng cách quét toàn bộ user role `processor` (số lượng
   nhỏ, chấp nhận quét thẳng thay vì lọc Json-null ở DB — tránh gotcha Prisma JSON null filter
   dễ sai ngữ nghĩa).
6. **Apps Script** (sinh trong route connect, không cần `LockService` như CPA Review — mỗi ô
   (task, ngày) chỉ upsert theo VỊ TRÍ CỐ ĐỊNH, không có rủi ro tạo record trùng theo business
   key như CPA Review) — vẫn lặp qua TOÀN BỘ `e.range` (nhiều dòng/cột cùng lúc, không chỉ ô
   đầu tiên) theo đúng quy tắc mới thêm ở `workflow-conventions.md` (bôi đen nhiều dòng phải
   đồng bộ đủ).
7. Hook vào `POST/PATCH /api/processor-report/entries` (route CÓ SẴN, dùng chung cho cả bảng
   cá nhân lẫn cache tổng hợp Leader) — thêm 1 `after()` gọi `pushOwnReportCell` cạnh
   `recomputeAndPushProcessorReportSummary` có sẵn, 2 nhánh HOÀN TOÀN độc lập, không ảnh hưởng
   nhau nếu 1 nhánh lỗi.

**Đã tự kiểm tra (2026-09-02)**:
- Script độc lập gọi thẳng `applyOwnReportSheetCells()` trên DB dev thật (tháng test riêng
  `2099-03`, đã dọn sạch sau test) — 5 case: tạo mới đúng giá trị; grace window 5s chặn đúng
  lượt ghi thứ 2 tới quá gần; sau khi hết grace window, xoá ô (rawValue rỗng) ra đúng giá trị
  0; cột ngoài phạm vi tháng (col=40) bị bỏ qua đúng, không tạo entry rác.
- Playwright thật (đăng nhập `quang@directfunder.com`, role processor, tài khoản NÀY đã từng
  kết nối Google từ trước) — mở popup "For Processor" → tab Report → bấm "Sheet của tôi" → xác
  nhận dialog mở đúng tiêu đề kèm tháng, hiện đúng ô dán link (KHÔNG hiện bước "Kết nối Google"
  vì tài khoản test đã kết nối sẵn — chưa tự verify được nhánh "chưa kết nối" qua UI thật vì
  không có tài khoản processor nào trong DB dev còn `googleRefreshToken = null` sẵn để test).
- **CHƯA verify được luồng ghi Google Sheet thật** (connect/resync/push cell thật sự gọi
  Sheets API) — không có Google Sheet thật để test trong môi trường này. Logic dùng lại NGUYÊN
  VẸN các helper (`writeCells`/`ensureRowExists`/`ensureSheetGridSize`/`resolveTabNameFromGid`)
  đã verify kỹ ở CPA Review/bảng Leader/`appendRowToSheet`, chỉ khác client OAuth thay Service
  Account — rủi ro thấp nhưng NÊN tự kết nối 1 Sheet thật trước khi công bố rộng cho team.
- **CHƯA verify được Apps Script thật** (Sheet→App qua trình duyệt Google Sheets thật) — cùng
  lý do không có Sheet thật để dán script vào.
- `tsc --noEmit`/`eslint` sạch trên toàn bộ file mới/sửa.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (thêm cột `ownProcessorReportSheetConfig` trên
   `users`, an toàn/additive/nullable).
2. Không cần script merge `AppConfig` (không đụng `columns`/`featurePermissions`).
3. Đăng nhập production bằng tài khoản **Processor** thật (đã từng kết nối "Send to Google
   Sheet" trước đó hoặc kết nối mới ngay tại đây), mở "For Processor" → Report → bấm "Sheet của
   tôi" → nếu chưa kết nối Google, xác nhận bấm "Kết nối Google" mở đúng popup OAuth.
4. Dán link 1 Google Sheet THẬT của chính Processor đó (Sheet họ sở hữu, không cần share cho
   ai) → mở đúng tab tháng hiện tại trước khi copy link (URL có `#gid=...`) → bấm Kết nối → xác
   nhận layout được ghi đúng (dòng 1 = "Tasks" + số ngày 1..N, các dòng sau = tên task theo
   đúng thứ tự bảng Leader, số liệu hiện có được điền sẵn).
5. Copy đoạn Apps Script hiện ra, dán vào Extensions → Apps Script của Sheet đó → Save → chọn
   hàm `installOwnReportTriggers` → Run → Allow.
6. Gõ số vào 1 ô bất kỳ trong bảng cá nhân trên app → xác nhận Sheet cập nhật đúng ô (dòng
   task, cột ngày) trong vài giây.
7. Sửa trực tiếp 1 ô trên Sheet → xác nhận app cập nhật lại đúng entry đó (Sheet→App, không
   cần F5 nếu Pusher `case:changed`-style broadcast đã áp dụng cho processor report — nếu chưa
   có realtime cho bảng này, xác nhận ít nhất reload thấy đúng).
8. Xác nhận bảng TỔNG HỢP của Leader (nút "Sheet" của Leader, riêng biệt) vẫn cập nhật đúng số
   liệu Processor đó — 2 luồng đồng bộ độc lập nhưng cùng nguồn dữ liệu (`ProcessorReportEntry`).
9. Bấm "Đồng bộ lại toàn bộ" → xác nhận ghi lại đúng toàn bộ layout + số liệu tháng đó, không
   mất dữ liệu cũ trên Sheet (không đụng cột/dòng ngoài phạm vi layout).
10. Bấm "Ngắt kết nối" → kết nối lại (không cần đăng nhập Google lần nữa nếu token còn hiệu
    lực) → xác nhận secret MỚI được sinh, cần dán lại Apps Script mới (secret cũ không còn khớp).

### 4.49 Khoá sửa/xoá row CPA Review theo Processor đã gán (thêm 2026-09-02)

Theo yêu cầu "chỉ có tài khoản gắn tên Processor mới được sửa xóa ở row đó" — row nào ĐÃ được
gán tên vào cột "Processor" (`custom.processorUserId`) thì từ nay CHỈ đúng tài khoản đó (hoặc
role `manager`/`processor_leader`, vai trò quản lý trực tiếp — xác nhận qua AskUserQuestion) mới
sửa/xoá được row đó qua UI app; các role khác (kể cả Agent/Agent Leader vốn cũng có quyền
`addCpaReviewRow`/`deleteCpaReviewRow` theo role) bị khoá nếu không phải đúng người được gán.
Row CHƯA gán Processor (cột đang trống) giữ nguyên quyền cũ — mọi user có quyền vào tab này vẫn
sửa/xoá được, vì chưa có ai để khoá theo.

**Phạm vi CHỈ áp dụng chiều APP** (PATCH/DELETE qua `/api/cpa-review/[id]`) — Sheet→App qua
webhook (`onCpaReviewEdit`) KHÔNG áp dụng được ràng buộc này vì webhook xác thực bằng secret,
không gắn với phiên đăng nhập của user nào — sửa trực tiếp trên Google Sheet vẫn không bị chặn
bởi quy tắc này (Sheet vốn đã là nguồn "ai cũng sửa được" theo thiết kế đồng bộ 2 chiều có sẵn,
không đổi ở đây).

**2 lớp thực thi**:
1. **Server (authoritative)** — `canEditRecord(me, custom)` (`src/app/api/cpa-review/[id]/route.ts`)
   — PATCH đọc `custom.processorUserId` của record TRƯỚC khi merge, trả 403 nếu khoá; DELETE
   kiểm tra tương tự trước khi xoá (thêm SAU check `hasFeature("deleteCpaReviewRow")` có sẵn —
   2 lớp độc lập, role không đủ quyền bị chặn bởi lớp cũ trước khi chạm tới lớp mới).
2. **Client (UX, không phải chặn thật)** — `canEditRow(row)` (`cpa-review/page.tsx`) tính
   `rowEditable` cho MỖI row, truyền `editable={rowEditable}` xuống MỌI `EditableCell`/
   `AssignMenu` của row đó (bao gồm cả 2 field bên trong `YearCells`/`DateWithNote` — phải
   thêm prop `editable` xuyên suốt 2 component con này), ẩn cả nút xoá (`canDelete &&
   rowEditable`) và nút "Lưu" ghi chú theo năm.

**Đã tự kiểm tra qua server thật** (script gọi thẳng route qua session cookie thật, dữ liệu
test tháng riêng `2099-04`, đã dọn sạch sau test) — 5 case: (1) user KHÁC bị chặn PATCH đúng
403 kèm message rõ ràng; (2) đúng user được gán PATCH thành công; (3) user KHÁC bị chặn DELETE
(403, dù message cụ thể có thể tới từ lớp permission cũ tuỳ role, hành vi chặn vẫn đúng); (4)
Manager PATCH row đã khoá cho người khác vẫn thành công (bypass đúng thiết kế); (5) row CHƯA
gán Processor — user bất kỳ vẫn PATCH thành công (không bị khoá nhầm). `tsc --noEmit`/`eslint`
sạch (chỉ còn lỗi có sẵn từ trước, không liên quan, ở dòng khác trong cùng file).

**Không cần bước production nào** (không đổi schema — `processorUserId` đã có sẵn trong
`custom` JSON tự do từ trước, không đổi feature-permission) — chỉ cần deploy code. Sau khi
deploy: đăng nhập bằng 1 tài khoản Processor, gán tên chính họ vào cột "Processor" của 1 row →
đăng nhập bằng tài khoản Processor KHÁC → xác nhận các ô của row đó hiện khoá xám (không sửa
được), nút xoá biến mất; đăng nhập lại đúng tài khoản đã gán → xác nhận sửa/xoá bình thường;
đăng nhập Manager hoặc Processor Leader → xác nhận vẫn sửa/xoá được row đã khoá cho người khác.

### 4.50 Thông báo cho Processor khi Status năm (2023/2024/2025) tab CPA Review chuyển sang Rejected (thêm 2026-09-02)

Theo yêu cầu "khi Status của các năm 2023,2024,2025... chuyển sang trạng thái Reject, sẽ có
thông báo đến Processor đó trên notification" — mỗi khi 1 trong 3 cột "{năm} Status" đổi sang
đúng giá trị `"rejected"` (option "Rejected" trong `CPA_REVIEW_STATUS_OPTIONS`), tự tạo 1
Notification cho ĐÚNG tài khoản đang được gán ở cột "Processor" (`custom.processorUserId`) của
row đó — nếu row CHƯA gán Processor nào thì bỏ qua im lặng (không có ai để báo).

**Áp dụng CẢ 2 chiều ghi** (khác mục 4.49 chỉ áp dụng chiều app):
1. **App** (`PATCH /api/cpa-review/[id]`) — `fromUserId` = người vừa đổi Status (`me.id`).
2. **Sheet→App** (`POST /api/cpa-review-sheet/webhook`, cả nhánh `fullRowSync` mới lẫn nhánh
   single-cell cũ còn giữ để tương thích ngược) — `fromUserId` = chuỗi cố định
   `"system:cpa-review-sheet-sync"` (không có phiên user nào, webhook xác thực bằng secret,
   cùng quy ước "system:<nguồn>" đã dùng cho agentc3 sync).

Chỉ báo khi field **THỰC SỰ có trong request/payload lần này** đổi sang rejected (không phải
quét lại toàn bộ `custom` đã merge) — sửa 1 field không liên quan của cùng record không bắn lại
thông báo cũ. 2 hàm mới trong `src/lib/cpa-review-case-sync.ts`:
- `extractRejectedYearStatuses(incomingCustom)` — khác `extractChangedYearStatuses` có sẵn
  (hàm đó CHỈ khớp 4 giá trị dùng cho đồng bộ `refundYearStatus`, không có "rejected").
- `notifyProcessorOnRejectedCpaReviewStatus(record, rejectedYears, fromUserId)` — tạo 1
  Notification/năm bị reject, tự dò Case khớp SSN (nếu có) để click-through notification nhảy
  đúng hồ sơ trên bảng Hồ sơ chính (không tìm thấy vẫn tạo Notification bình thường, chỉ
  `caseId` rỗng nên click không nhảy đi đâu).

**Đã tự kiểm tra qua server thật** (session Manager thật, dữ liệu test tháng riêng `2099-05`,
đã dọn sạch sau test): PATCH đổi `status_2024` sang "rejected" → đúng 1 Notification mới tạo
cho Processor đã gán, nội dung đúng định dạng "CPA Review: {tên} (SSN: ...) — Status năm 2024
đã chuyển sang Rejected"; PATCH đổi `status_2025` sang "accepted" (không phải rejected) ngay
sau đó → KHÔNG tạo thêm Notification nào (đúng, không báo nhầm cho status khác). `tsc --noEmit`/
`eslint` sạch. **Chưa verify được nhánh Sheet→App qua Apps Script thật** (không có Google Sheet
thật để test đổi Status trực tiếp trên Sheet) — logic dùng chung `extractRejectedYearStatuses`
đã verify đúng phía app, chỉ khác nguồn gọi.

**Không cần bước production nào** (không đổi schema — `Notification` model và
`custom.processorUserId` đã có sẵn từ trước, không đổi feature-permission) — chỉ cần deploy
code. Sau khi deploy: đăng nhập 1 tài khoản bất kỳ có quyền sửa CPA Review, mở 1 row đã gán
Processor, đổi Status 1 năm bất kỳ sang "Rejected" → đăng nhập bằng đúng tài khoản Processor đã
gán → xác nhận nhận được thông báo (chuông + toast nếu đang mở app) đúng nội dung năm/tên/SSN.

### 4.51 [CHỜ XỬ LÝ] Bug NGHIÊM TRỌNG: sửa tab THÁNG KHÁC trong CÙNG FILE Sheet bị đồng bộ nhầm thành tháng đang kết nối (thêm 2026-09-02)

Người dùng báo "thấy nhiều row lạ tự thêm ở tab CPA Review" — điều tra qua production (chỉ đọc)
lộ ra **18 record thật** (tên/SSN khách hàng thật, không phải test) bị tạo nhầm vào tháng
2026-09, `sortOrder` 314-333 (khớp đúng vị trí dòng THẬT trên 1 tab khác nhiều dữ liệu, không
phải dòng 5+ liền sau row 4). Người dùng xác nhận: **các dòng này thực ra thuộc tab "Aug26"**
(tháng 8), không phải "Sep26" (tháng 9 đang kết nối) — cùng nằm trong 1 FILE Google Sheet.

**Nguyên nhân gốc**: Apps Script BOUND vào cả FILE Spreadsheet, không phải riêng 1 tab —
`onCpaReviewEdit`/`onCpaReviewChange` (sinh ra trong `buildAppsScript()`,
`src/app/api/config/cpa-review-sheet/route.ts`) trước đây **KHÔNG kiểm tra tên tab vừa sửa**,
nên sửa/xoá dữ liệu ở BẤT KỲ tab nào khác trong cùng file (vd "Aug26", hay bất kỳ tab nào khác
người dùng có thể có trong cùng file) vẫn kích hoạt trigger, gửi dữ liệu lên webhook kèm
**secret của tháng ĐANG kết nối** (Sep26) — khiến dữ liệu tháng cũ bị ghi nhầm thành record
tháng mới. Đây là lỗ hổng có từ RẤT LÂU (từ lúc thiết kế `onCpaReviewEdit`/`onCpaReviewChange`
ban đầu, không phải lỗi mới phát sinh gần đây) — chỉ vừa bị phát hiện vì lần này người dùng có
1 file Sheet chứa nhiều tab tháng khác nhau cùng lúc.

**Cách vá**: thêm 1 dòng chặn NGAY ĐẦU cả 2 hàm — `onCpaReviewEdit` dùng
`e.range.getSheet().getName() !== "${tabName}"` (có sẵn `e.range` từ sự kiện onEdit);
`onCpaReviewChange` dùng `SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getName() !==
"${tabName}"` (sự kiện onChange KHÔNG có `e.range`, `getActiveSheet()` là cách chuẩn Google gợi
ý để biết tab nào vừa được thao tác lúc trigger chạy). Sửa/xoá ở tab khác giờ bị bỏ qua NGAY
LẬP TỨC, không còn gửi gì lên webhook.

**Dữ liệu bị ảnh hưởng đã dọn**: 18 record đã bị tạo nhầm (id liệt kê trong lịch sử debug, không
lặp lại ở đây) đã **XOÁ VĨNH VIỄN** khỏi production theo yêu cầu người dùng (xác nhận rõ ràng
trước khi xoá), chỉ giữ lại đúng 1 record thật của tháng 9 (row 4, "Tam V Dang") — `rowIndex`
cache trong `AppConfig.cpaReviewSheetConfig["2026-09"]` cũng đã dọn theo, chỉ còn đúng 1 entry.
**Không có script tự động nào lưu lại — đây là thao tác admin 1 lần, đã hoàn tất qua script tạm
gọi thẳng Prisma nhắm `PROD_DATABASE_URL`, đã xoá script tạm sau khi chạy xong.**

**QUAN TRỌNG — như mọi lần đổi logic `onCpaReviewEdit`/`onCpaReviewChange`, PHẢI dán lại script
mới cho MỌI Sheet đang kết nối** (Hướng dẫn → Copy script → dán đè → Save → chạy lại
`installCpaReviewTriggers`) — nếu không dán lại, bug này VẪN CÒN NGUYÊN (script cũ trên Sheet
thật không tự cập nhật theo code deploy). Đặc biệt quan trọng cho người dùng này vì họ xác nhận
có nhiều tab tháng trong cùng 1 file.

**Chưa verify được qua Apps Script thật** (không có Sheet nhiều-tab thật để mô phỏng đúng kịch
bản "sửa tab khác trong cùng file" từ môi trường này) — logic dựa trên tài liệu chính thức của
Google về `onEdit`/`onChange` event object, rủi ro thấp nhưng NÊN người dùng tự xác nhận lại sau
khi dán script mới: sửa thử 1 ô ở tab KHÁC "Sep26" trong cùng file → xác nhận KHÔNG có record
mới nào xuất hiện ở tab CPA Review tháng 9. `tsc --noEmit`/`eslint` sạch.

**Sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. Không cần `prisma migrate deploy`/script merge `AppConfig` (thuần logic Apps Script, không
   đổi schema/feature-permission).
2. Dán lại Apps Script mới vào MỌI Sheet CPA Review đang kết nối (ít nhất tháng 2026-09 —
   `Sep26`), chạy lại `installCpaReviewTriggers`.
3. Sửa thử 1 ô ở tab "Aug26" (hoặc bất kỳ tab nào khác không phải "Sep26") trong CÙNG file Sheet
   → xác nhận KHÔNG có record mới nào xuất hiện ở tab CPA Review app cho tháng 2026-09.
4. Sửa thử 1 ô ở đúng tab "Sep26" → xác nhận VẪN đồng bộ đúng như bình thường (không bị chặn
   nhầm).
5. Xoá thử 1 dòng ở tab "Aug26" → xác nhận KHÔNG có record nào ở tháng 2026-09 bị xoá theo
   (kiểm tra `onCpaReviewChange` cũng đã chặn đúng).

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
