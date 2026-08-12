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

### 4.12 [CHỜ XỬ LÝ] Đồng bộ production cho tính năng "Gửi email cho khách hàng" (Microsoft 365/Outlook) (thêm 2026-08-11)

Tính năng mới thêm `User.microsoftRefreshToken` + `AppConfig.clientEmailTemplate` (2 field additive) + feature key `sendClientEmail` vào `DEFAULT_FEATURE_PERMISSIONS` — đúng loại thay đổi mô tả ở mục 4.8, nên **sau khi deploy code này lên production PHẢI làm đủ các bước sau** (xoá mục này khỏi file khi đã làm xong):
1. `prisma migrate deploy` nhắm production (2 cột trên, an toàn/additive).
2. Chạy script merge cộng dồn thêm `sendClientEmail: ["processor"]` vào `AppConfig.featurePermissions` production nếu key đó chưa có (nếu bỏ qua, processor trên production sẽ không thấy nút dù code đúng — xem cơ chế lỗi ở mục 4.8).
3. Tạo App registration trên Azure Portal (tenant công ty `@directfunder.com`, Single tenant) nếu chưa có từ bước dev, đăng ký thêm redirect URI production `https://<production-domain>/api/auth/microsoft/callback`, xác nhận API permission `Mail.Send` (Delegated) đã cấp, Admin bấm "Grant admin consent" nếu tenant policy yêu cầu.
4. Thêm `MICROSOFT_OAUTH_CLIENT_ID`/`MICROSOFT_OAUTH_CLIENT_SECRET`/`MICROSOFT_TENANT_ID` vào Vercel Environment Variables (Production).
5. Đăng nhập bằng tài khoản **processor** thật trên production, mở popup "Edit Hồ sơ" 1 hồ sơ đã có email khách hàng → bấm nút gửi mail cạnh field Email → xác nhận popup OAuth Microsoft mở đúng, đăng nhập bằng mailbox `@directfunder.com` thật, kết nối xong tự gửi tiếp.
6. Vào trang Phân quyền (Admin), mở dialog cấu hình mẫu email khách hàng, nhập Subject/Body thật lần đầu (mặc định rỗng sau migration → dùng DEFAULT_CLIENT_EMAIL_SUBJECT/BODY trong code cho tới khi Admin lưu).
7. Gửi thử 1 email thật tới hộp thư test, xác nhận nội dung/placeholder render đúng và mail đến từ đúng địa chỉ `@directfunder.com` của người bấm gửi (không phải mailbox chung).

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
