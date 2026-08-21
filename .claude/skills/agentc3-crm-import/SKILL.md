---
name: agentc3-crm-import
description: How the "Nhập từ CRM" toolbar button (bảng Hồ sơ) reads a customer profile from the external CRM tax.agentc3.com and creates/fills a Direct Funder case. Read this before touching src/lib/agentc3-client.ts, src/app/api/agentc3-import/fetch/route.ts, src/components/agentc3-import-dialog.tsx, or the importCaseFromAgentC3 store action — or before adding a similar "import from an external system" feature.
---

# Nhập hồ sơ từ CRM ngoài (tax.agentc3.com)

Đã triển khai đầy đủ (2026-08-21) và tự kiểm tra end-to-end (curl + Playwright thật, tài
khoản `Pro Support` do người dùng cung cấp) — không phải kế hoạch còn dang dở. Đọc file này
trước khi sửa bất kỳ phần nào của tính năng, hoặc khi làm 1 tính năng "nhập từ hệ thống
ngoài" tương tự sau này.

## Bài toán

Công ty có 1 CRM cũ (`tax.agentc3.com`, PHP/CodeIgniter, hoàn toàn tách biệt khỏi
database/app Direct Funder) chứa dữ liệu khách hàng có sẵn. Người dùng dán 1 link hồ sơ
khách hàng trên CRM đó (vd `https://tax.agentc3.com/customer/info/BY306393`) — app tự đăng
nhập, đọc đúng các trường đã chỉ định, rồi **tạo hồ sơ mới** (SSN chưa có) hoặc **chỉ điền
vào những ô đang trống** của hồ sơ đã có sẵn khớp SSN (SSN đã có — KHÔNG BAO GIỜ ghi đè dữ
liệu đã tồn tại).

## Phát hiện kỹ thuật quan trọng: không cần headless browser

Trang chi tiết khách hàng (`/customer/info/{id}`) trên agentc3 là **HTML render sẵn từ
server** (CodeIgniter, không phải SPA) — chỉ cần session cookie (`ci_session`) rồi
`fetch()` HTML là đủ để đọc toàn bộ dữ liệu. Đã xác nhận qua `curl` thật trước khi viết code.
**KHÔNG dùng Playwright/Chromium ở server** cho tính năng này (khác Notice Splitter/PDF —
xem `vercel-blob-large-upload` skill) — không có rủi ro timeout/kích thước package Chromium
trên Vercel serverless, tốc độ đọc 1 hồ sơ chỉ ~2-4 giây.

## Đăng nhập CRM ngoài — không có CSRF nhưng rất kén header

`src/lib/agentc3-client.ts`, hàm `login()`:
- `POST https://tax.agentc3.com/auth/login`, form-urlencoded `username`/`password` **+ bắt
  buộc thêm `login=Login`** (đúng tên/giá trị nút submit) — thiếu field này CodeIgniter âm
  thầm trả lại nguyên form login (KHÔNG lỗi rõ ràng), rất dễ tưởng nhầm sai mật khẩu.
- **Không có CSRF token** — không cần lo phần đó.
- **Bắt buộc `User-Agent` giống trình duyệt thật** (`BROWSER_USER_AGENT` const) + header
  `Referer`/`Origin` — thiếu cũng bị âm thầm từ chối.
- Đăng nhập thành công nhận diện qua header `Refresh: 0;url=.../customer/search` (CodeIgniter
  dùng meta-refresh kiểu redirect, KHÔNG phải `Location` 302 thật) — không dùng `res.ok`/status
  code để xác nhận, phải check chính header này (`AgentC3LoginError` nếu thiếu).
- Session cookie cache ở biến module-scope (`cachedCookie`, TTL 15 phút) — tự đăng nhập lại
  nếu hết hạn cache HOẶC server tự redirect về `/auth/login` giữa chừng (`fetchWithSession()`
  tự retry 1 lần).
- Dùng **1 tài khoản CHUNG cho mọi user Direct Funder** (`AGENTC3_USERNAME`/
  `AGENTC3_PASSWORD`), giống mô hình `GMAIL_USER` — không phải OAuth theo từng user.

## Parse dữ liệu — id field cố định, dùng cheerio

Mỗi field nằm trong 1 `<input id="...">`/`<select id="...">` đều đặn — KHÔNG dùng regex thô,
dùng `cheerio` (dependency mới, thuần JS không native binary — an toàn cho serverless, khác
`pdfjs-dist`/`@napi-rs/canvas` đã từng gặp vấn đề "Module not found: Can't resolve 'canvas'"
ở các tính năng khác). Bảng id đã dò được thật (test với link `BY306393` thật, xem
`fetchAgentC3Customer()` trong `agentc3-client.ts`):

| Field | id CRM | Ghi chú |
|---|---|---|
| Taxpayer Name | `p_fl_nm` | 1 chuỗi, tách First/Last bằng `splitNameLastWord()` (`src/lib/client-name.ts`) |
| SSN | `ssn` | qua `formatSsn()` (`src/lib/ssn.ts`) |
| DOB | `p_dob` | `mm/dd/yyyy` → ISO qua `parseDobPaste()` (`src/lib/date-format.ts`) |
| Spouse Name/SSN/DOB | `spouse_name`/`spouser_ssn`/`spouse_dob` | chú ý `spouser_ssn` (thừa chữ "r", đúng id thật trên CRM) |
| Current Address | `p_hm_addr` + `p_city` + `p_state` | ghép chuỗi, KHÔNG lấy `p_zip` thường |
| Email/Phone1/Phone2 | `p_eml1`/`p_ph1`/`p_ph2` | |
| Status | `<select id="p_status">`, đọc `option[selected]` | text tự do, server tự khớp `label` (không phân biệt hoa/thường) với options cột `status` hiện có |
| Refund 4 năm | `refund_2022`..`refund_2025` | khớp thẳng `REFUND_YEARS` (`src/lib/refund.ts`) |
| Agent 1 | `<select id="user_id" disabled>`, đọc TEXT của `option[selected]` | server tự khớp `name` user role `agent` |
| Bank Info | `bank_name`/`routing_number`/`account_number` | |
| Zip IRS | `p_zip_irs` | KHÁC `p_zip` — đúng field IRS theo yêu cầu |
| Full Contacts | `full_contacts` | value ISO sẵn → map thẳng `Case.fcDate` |
| Engagement Letter | `engagement_letter_2026_may` | value ISO sẵn → map thẳng `Case.elDate` |

Nếu CRM đổi cấu trúc HTML trong tương lai (đổi id), `fetchAgentC3Customer()` throw
`AgentC3NotFoundError` khi không thấy `#p_fl_nm` — không âm thầm trả preview toàn field rỗng.

## Kiến trúc 3 lớp (đã triển khai đúng như plan gốc)

1. **`src/lib/agentc3-client.ts`** (server-only) — login + fetch + parse, trả về
   `AgentC3CustomerRaw` THÔ, chưa map/chưa đổi định dạng.
2. **`POST /api/agentc3-import/fetch`** (`src/app/api/agentc3-import/fetch/route.ts`) — gate
   bằng feature `addRow` có sẵn (KHÔNG thêm feature key mới — hành động cuối cùng vẫn là tạo
   hồ sơ, dùng đúng quyền đó). Map dữ liệu thô → `AgentC3ImportPreview`, TỰ khớp Status/Agent
   ở server (đọc `AppConfig.columns`/`User` role agent), và kiểm tra trùng SSN trên **toàn bộ**
   `Case` (không lọc theo RBAC của người xem — tránh tạo trùng hồ sơ nằm ngoài phạm vi họ thấy
   được). Trả kèm `existingCase` đầy đủ (`toCaseRecord()`, tái dùng từ `api/cases/route.ts`)
   nếu SSN đã khớp.
3. **`src/components/agentc3-import-dialog.tsx`** — dialog trên toolbar bảng Hồ sơ (cạnh nút
   "Nhập Excel", gate cùng `canAddRowFeature`). Ô nhập là `<textarea>` nhiều dòng, mỗi dòng 1
   link:
   - **Đúng 1 link** → luồng xem trước như cũ: fetch → hiện form đầy đủ (mọi ô sửa được, trừ ô
     đã có dữ liệu trên hồ sơ trùng SSN thì khoá xám) → người dùng tự bấm Tạo/Cập nhật.
   - **≥ 2 link** (thêm 2026-08-21, yêu cầu "bổ sung có thể insert nhiều link") →
     `handleBatchImport()` tự chạy TUẦN TỰ (không `Promise.all` — cùng lý do
     `importCases`/Excel: tránh nhiều request tạo hồ sơ đọc cùng lúc 1 giá trị `caseNumber` max
     rồi trùng nhau), MỖI link tự fetch preview rồi lưu THẲNG theo đúng dữ liệu/auto-match
     (`buildFieldsFromPreview()`, dùng chung với luồng 1 link) — KHÔNG dừng lại cho sửa tay
     từng hồ sơ. Hiện bảng kết quả tăng dần theo từng dòng (badge Đã tạo/Đã cập nhật/Không
     đổi/Lỗi + tên khách + thông điệp) — 1 link lỗi (vd link sai/CRM đổi cấu trúc) không chặn
     các link còn lại, lỗi hiện ngay trên đúng dòng đó. Cần sửa tay 1 hồ sơ cụ thể trong loạt
     đó → dán lại đúng 1 link đó riêng để vào lại luồng xem trước.
4. **`importCaseFromAgentC3`** (`src/store/app-store.ts`) — 2 nhánh:
   - **Nhánh A (SSN mới)**: build `CaseRecord` đầy đủ (cùng mẫu `addRow()`/`importCases()` —
     Processor luôn tự gán người tạo, Agent khớp CRM hoặc để trống) → `api.createCase()` →
     **PHẢI gọi thêm `updateClientProfile()`** vì `POST /api/cases` (nhánh nhận body) KHÔNG
     ghi `bankName`/`routingNumber`/`accountNumber` (không có trong danh sách field server đọc
     từ body) và KHÔNG tự tính `money`/`custom.caseLabel` từ `refunds` — chỉ route
     `client-profile` mới làm 2 việc đó (xem `src/app/api/cases/[id]/client-profile/route.ts`).
   - **Nhánh B (SSN trùng)**: đọc lại `state.cases` MỚI NHẤT (không dùng bản `existingCase` cũ
     từ lúc preview — phòng hồ sơ bị người khác sửa trong lúc dialog mở), so từng field xem đã
     "trống" chưa (chuỗi rỗng/null, số 0/thiếu key, `assignedTo` null), CHỈ đưa field đang trống
     vào `ClientProfilePayload` rồi gọi `updateClientProfile()` 1 lần + `assignCase()` riêng
     cho Agent nếu trống. Không có field nào cần điền → trả `skippedNoChanges: true`, KHÔNG gọi
     API nào (tránh network call thừa).
   - Cả 2 nhánh đều gọi `logEdit(caseId, "Nhập từ CRM", "", ...)` để lịch sử (History) ghi rõ
     nguồn gốc thay đổi.

## Bổ sung sau bản đầu (2026-08-21, cùng ngày)

- **`Case.clientLink` tự điền link CRM gốc** — cả 2 nhánh (tạo mới lẫn điền-ô-trống) đều gán
  `clientLink` = link chuẩn hoá (`buildAgentC3CustomerUrl()`, bỏ query `prev`/`next` dễ đổi)
  NẾU ô đó đang trống (Nhánh B không ghi đè nếu hồ sơ đã tự gắn link khác trước đó) — người
  dùng bấm icon liên kết cạnh tên khách hàng để quay lại đúng hồ sơ gốc trên agentc3.
- **Khớp Status "mờ" (fuzzy) cho nhóm "Missing Doc"** — `matchStatusId()`/`normalizeStatusPrefix()`
  trong `fetch/route.ts`: thử khớp CHÍNH XÁC (case-insensitive) trước, không khớp thì fallback
  so 2 TỪ ĐẦU đã chuẩn hoá (lowercase, bỏ dấu câu, bỏ "s" số nhiều cuối từ) — "Missing Doc"/
  "Missing Docs"/"Missing Doc Process"/"Missing Docs Process" (CRM trả về nhiều biến thể) đều
  khớp đúng option "Missing Docs" trong Direct Funder. Đã tự kiểm tra qua script độc lập xác
  nhận không khớp nhầm giữa các status khác (vd "Processing" vs "Pre-processing" vẫn tách biệt
  đúng nhờ chỉ so 2 từ đầu).

## Field dùng chung được tách ra để tái dùng

`splitNameLastWord()` (tách "Nguyen Van A" → First "Nguyen Van", Last "A") vốn là hàm private
trong `app-store.ts` (dùng cho nhập Excel) — đã **export ra `src/lib/client-name.ts`** để dùng
chung cho cả import Excel lẫn import agentc3, tránh lặp code. Nếu cần thêm 1 nguồn nhập dữ
liệu khách hàng khác sau này, tái dùng hàm này thay vì viết lại.

## Gotcha đã gặp khi tự test: đóng browser Playwright quá sớm che mất lỗi thật

Lúc tự kiểm tra bằng Playwright, script đóng `browser.close()` ngay sau khi chụp screenshot ở
mốc thời gian cố định (3s) — trong khi nhánh A thực hiện 2 lệnh gọi API TUẦN TỰ
(`createCase` ~0.5s + `updateClientProfile` ~1-5s tuỳ tải máy), đóng browser giữa chừng khiến
lần kiểm tra đầu tiên trông như "money/bankName không được lưu" dù route/logic hoàn toàn đúng
(xác nhận lại bằng cách gọi thẳng `POST /api/cases/[id]/client-profile` qua `curl` với đúng
payload — thành công ngay). **Bài học**: khi test luồng nhiều bước qua Playwright, đợi tín
hiệu thật (dialog đóng / nút đổi trạng thái) thay vì `waitForTimeout()` cố định, đặc biệt khi
máy dev đang tải nặng (nhiều request `POST /api/pusher/auth`/`GET /api/cases` chạy chậm hẳn do
Turbopack cold-compile + nhiều browser Playwright chạy song song).

## Việc CHƯA làm / giới hạn đã biết (giữ nguyên từ plan gốc)

- KHÔNG hỗ trợ nhập hàng loạt nhiều link cùng lúc — chỉ 1 link/lần.
- Không tự động sửa `addRow()`/`importCases()` hiện có — action hoàn toàn riêng biệt.
- Nếu agentc3 đổi cấu trúc HTML, tính năng báo lỗi rõ ràng (404 "trang CRM có thể đã đổi cấu
  trúc") thay vì âm thầm trả field rỗng — nhưng vẫn cần con người phát hiện qua báo lỗi thực tế
  khi dùng, không có cảnh báo chủ động nào khác.

## Biến môi trường

`AGENTC3_USERNAME`/`AGENTC3_PASSWORD` (xem `.env.example`) — thiếu 1 trong 2 thì route tự trả
501 "Chưa cấu hình..." (`AgentC3ConfigError`), không crash app. **Production**: cần thêm 2
biến này vào Vercel Environment Variables — không đổi schema/không cần `prisma migrate deploy`
(tính năng không đụng `DEFAULT_COLUMNS`/`DEFAULT_FEATURE_PERMISSIONS`/DB schema nào cả).
