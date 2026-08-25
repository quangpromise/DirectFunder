---
name: crm-tts-wit-compare
description: How TTS (Tax Return Transcript / Record of Account), WIT (Wage & Income Transcript), and "1040 Tax Return" documents from the external CRM tax.agentc3.com are structured, and how the "Get Files" popup's AI chat ("So sánh WIT / 1040 / TTS (AI)") compares any pair of them using Gemini API free tier with structured output. Read this before touching src/lib/crm-doc-compare.ts, the compare-tts-wit-chat API route, or the compare UI inside src/components/crm-tts-wit-check-button.tsx — or before extending/debugging that feature.
---

# So sánh WIT / 1040 Tax Return / TTS trong popup "Get Files" (cột "Doc CRM")

Tính năng nằm trong popup có sẵn của nút "Get Files" (`CrmTtsWitCheckButton`, xem thêm lịch sử
tính năng đọc link TTS/WIT/1040/Other ở phần cuối `.claude/rules/deployment-database-sync.md`).
Đọc file này trước khi làm/sửa phần so sánh.

**Trạng thái hiện tại (2026-08-26, cập nhật cuối)**: CHỈ CÒN 1 cơ chế so sánh — khung chat
`CompareChatSection` ("So sánh WIT / 1040 / TTS (AI)"), đặt Ở ĐẦU popup (trước cả 3 khối link
TTS/WIT/1040/Other), dùng **Gemini API free tier** trả về DẠNG BẢNG (structured output) với ĐỦ
3 cột giá trị **WIT | 1040 | TTS** cho mỗi hạng mục — cho phép người dùng tự nhìn ra chênh lệch
giữa BẤT KỲ cặp nào trong 3 tài liệu (WIT-1040, 1040-TTS, WIT-TTS), không chỉ WIT-TTS như thiết
kế ban đầu. **Bảng cố định thuần regex (`CompareSection`, chỉ so WIT-TTS) đã BỊ XOÁ HOÀN TOÀN**
2026-08-26 theo yêu cầu người dùng ("bỏ compare cũ đã tạo trước đó") — xem mục lịch sử bên dưới,
KHÔNG khôi phục lại trừ khi người dùng yêu cầu rõ ràng.

## Lịch sử quyết định quan trọng (đọc trước khi đổi lại kiến trúc)

1. **2026-08-25, bản đầu**: dùng LLM (Anthropic API, `@anthropic-ai/sdk`) — chat box tự do, mỗi
   lượt gửi lại toàn văn 2 file (TTS/WIT) cho model tự suy luận trả văn xuôi. Build xong, test
   end-to-end qua dev server thật, hoạt động đúng.
2. **BỎ Anthropic cùng ngày** — lý do: tính phí theo token, phát sinh chi phí liên tục. Thay
   bằng **bảng cố định thuần regex, KHÔNG LLM** (`compareWitToTts()`, chỉ so được ~6 field WIT
   đã xác nhận có "bạn đồng hành" đáng tin trên TTS qua khảo sát dữ liệu thật).
3. **Thêm lại khung chat AI cùng ngày** — theo yêu cầu "nghiên cứu tích hợp Google AI miễn phí"
   — dùng **Gemini API free tier** (KHÔNG phải Anthropic) làm khung chat BỔ SUNG cho bảng regex
   (không thay thế), vì bảng regex chỉ đối chiếu được field đã map cứng, còn câu hỏi tự do cần
   LLM đọc hiểu ngữ nghĩa. Người dùng đã **CHỦ ĐỘNG chọn free tier** dù biết dữ liệu gửi lên
   (bao gồm SSN/thu nhập khách hàng) sẽ bị Google dùng để cải thiện sản phẩm của họ (xác nhận
   qua AskUserQuestion — **KHÔNG tự ý đổi sang bản trả phí mà không hỏi lại trước**, đây là
   quyết định có chủ đích).
4. **2026-08-26, đổi AI chat từ văn xuôi sang structured output** (`responseSchema` của Gemini)
   — theo yêu cầu "chỉnh báo cáo AI theo dạng cột để so sánh" — AI giờ LUÔN trả JSON đúng khuôn
   dạng bảng thay vì văn xuôi tự do parse bằng tay.
5. **2026-08-26, CÙNG NGÀY, XOÁ HẲN bảng regex + đưa chat AI lên đầu + mở rộng ra 3 tài liệu**
   (WIT/1040 Tax Return/TTS thay vì chỉ WIT/TTS), CHỌN THEO NĂM (tự lấy bản `[0]` mới nhất) —
   theo yêu cầu "đưa Chat AI lên trên đầu, thêm các trường so sánh giữa WIT và 1040, 1040 và
   TTS, bỏ compare cũ đã tạo trước đó". Route `POST /api/agentc3-import/compare-tts-wit` (bảng
   regex) đã **XOÁ TOÀN BỘ**, cùng `compareWitToTts`/`ComparisonRow`/`MAPPED_FIELDS`/
   `extractLabeledAmount`/`extractAllLabeledAmounts` trong `crm-doc-compare.ts`, cùng
   `CompareSection`/`CompareTtsWitFn`/`CompareRow` trong `crm-tts-wit-check-button.tsx`, cùng
   `compareTtsWit` ở mọi tầng (`api-client.ts`/`app-store.ts`/`cases/page.tsx`).
6. **2026-08-26, VẪN CÙNG NGÀY, đổi từ "chọn theo năm" sang "chọn CHÍNH XÁC file"** — người dùng
   phản hồi bước 5 "chưa đúng mô tả": muốn **3 trường select tường minh** (TTS/WIT/1040), mỗi
   trường liệt kê TẤT CẢ tên/năm đang có trong loại tài liệu đó (không giới hạn 1 năm), WIT cho
   phép **chọn 2 file** (Taxpayer + Spouse), và chỉ khi có ÍT NHẤT 2/3 loại được chọn mới cho
   phép gửi AI so sánh.
7. **2026-08-27, các tinh chỉnh tiếp theo cùng kiến trúc mục 6** (KHÔNG đổi luồng dữ liệu, chỉ
   đổi UI/prompt):
   - **Nhãn WIT hiện rõ sub-type** — 1 mục "{năm} WI Transcript" trên CRM thật ra gộp 2 loại
     file khác nhau (token thứ 2 trong tên file CRM: `W&I`/`W&IS`) — `extractDocSubType()` trong
     `agentc3-client.ts` đọc token này, đưa LÊN ĐẦU nhãn (vd `"W&I - Nguyen, Pyon Ngoc"`, KHÔNG
     phải để trong ngoặc sau tên — đã đổi lại theo yêu cầu "W&I và W&IS sẽ đưa lên đầu tên").
   - **Cột "Chênh lệch" tự tính + tô màu** (`computeDiff()`/`formatDiff()` trong
     `crm-tts-wit-check-button.tsx`) — đọc số đầu tiên trong mỗi cột giá trị ĐANG HIỆN (bỏ dấu
     phẩy nghìn), lấy max-min; xanh nếu bằng 0 (khớp), đỏ có nền highlight nếu khác 0, "—" nếu
     <2 giá trị đọc được thành số (category không phải số, vd "Filing status").
   - **Bảng chỉ hiện đúng cột đã chọn** — `AiRowsTable` nhận `columns: {wit,taxReturn,tts}`
     (lưu THEO TỪNG LƯỢT chat, không phải global — lựa chọn có thể đổi giữa các lượt hỏi) thay
     vì luôn hiện cả 3 cột.
   - **Popup phân tích riêng, đặt CẠNH popup "Doc CRM"** — state `analysis` nâng lên
     `CrmTtsWitCheckButton` (không còn nằm trong `CompareChatSection`), mỗi câu trả lời AI mới
     mở/thay popup thứ 2 (`.popover` riêng, `max-w-3xl`, `AiRowsTable` với prop `wrap` để chữ
     không bị cắt/`whitespace-nowrap` như bản compact). Container ngoài cùng đổi từ
     `justify-center` 1 phần tử sang flex-row 2 phần tử + `gap-4` + `overflow-x-auto` — khi popup
     phân tích xuất hiện, cả cặp vẫn canh giữa nên popup "Doc CRM" tự bị đẩy sang trái so với lúc
     đứng 1 mình (không cần đo kích thước bằng JS).
   - **Khung chat "Doc CRM" CHỈ còn hiện lại câu đã hỏi** — bảng kết quả AI không lặp lại trong
     khung chat nữa (đã chuyển hẳn sang popup phân tích riêng ở trên) — `messages.filter(role ===
     "user")` trước khi render, tin nhắn assistant vẫn lưu trong `messages`/gửi làm `history` cho
     Gemini (chỉ ẩn khỏi UI, không xoá khỏi state/không đổi payload gửi đi).
   - **Quy tắc chiều so sánh WIT-làm-gốc** (`CHAT_SYSTEM_INSTRUCTION` trong `crm-doc-compare.ts`)
     — với 2 cặp "WIT vs 1040" và "WIT vs TTS", AI BẮT BUỘC duyệt theo từng khoản CÓ TRÊN WIT rồi
     kiểm tra 1040/TTS có ghi nhận không (KHÔNG so chiều ngược — khoản chỉ có ở 1040/TTS mà
     không có ở WIT thì bỏ qua, không đưa vào bảng). Khoản nào có trên WIT nhưng thiếu ở 1040/
     TTS, note PHẢI nêu rõ biểu mẫu nguồn + theo kiến thức thuế, khoản đó có bắt buộc khai 1040
     hay không (vd lãi ngân hàng luôn phải khai dù dưới ngưỡng 1099-INT $10; trợ cấp thất nghiệp
     luôn phải khai; đóng góp HSA thường không cần khai). Cặp "1040 vs TTS" (không có WIT) KHÔNG
     áp dụng quy tắc 1 chiều này.

   Đây là kiến trúc HIỆN TẠI, mô tả đầy đủ ở mục 2 dưới đây (mục 5 phía trên chỉ còn giá trị lịch
   sử, ĐỪNG code theo mô tả đó).

**Tính năng SONG SONG dùng CHUNG `GEMINI_API_KEY` (thêm 2026-08-27, KHÔNG thuộc phạm vi skill
này)**: nút "Trợ lý AI" trên toolbar bảng Hồ sơ (cạnh "My Notes") — chat Gemini free tier TỰ DO,
KHÔNG gắn hồ sơ/CRM nào, KHÔNG dùng chung code với tính năng ở đây (client riêng trong
`src/lib/gemini-general-chat.ts`, route riêng `POST /api/ai-chat`, error class riêng
`GeminiChatConfigError`) — 2 tính năng độc lập hoàn toàn, sửa 1 bên không ảnh hưởng bên kia.

## 1. Ba tài liệu đang so sánh — vai trò khác nhau

- **WIT (Wage and Income Transcript)**: dữ liệu do **BÊN THỨ BA** (chủ lao động, ngân hàng, đơn
  vị chi trả...) tự báo cáo thẳng cho IRS qua W-2/1098/1099/5498 — KHÔNG phải dữ liệu từ tờ
  khai của khách hàng.
- **"1040 Tax Return"**: bản PDF tờ khai 1040 THẬT đã chuẩn bị/nộp (do văn phòng/khách hàng tải
  lên CRM) — "nguồn gốc" của tờ khai, TRƯỚC khi IRS xử lý. Đây là 1 mục tài liệu RIÊNG trên CRM
  (khác hẳn TTS), đã có sẵn từ trước qua tính năng đọc link (mục "1040 Tax Return" trong popup).
- **TTS (Tax Return Transcript / Record of Account)**: dữ liệu IRS đã XỬ LÝ VÀ GHI NHẬN từ tờ
  khai — gồm AGI/Taxable income, các dòng thu nhập chi tiết (Wages/Interest/Dividends... — bản
  "Record of Account" ĐẦY ĐỦ có các trang chi tiết SAU trang 1 tóm tắt, đã xác nhận thật, xem
  mục 2 cũ), và bảng TRANSACTIONS theo mã (mã 806 = khớp "Federal income tax withheld" trên WIT).

Ý nghĩa nghiệp vụ từng cặp đối chiếu (đưa vào system prompt cho AI):
- **WIT vs 1040 Tax Return**: tờ khai đã chuẩn bị có khai ĐỦ/ĐÚNG thu nhập bên thứ ba báo cáo
  hay chưa (khai thiếu = rủi ro bị IRS truy thu).
- **1040 Tax Return vs TTS**: IRS xử lý/ghi nhận tờ khai có ĐÚNG với bản đã nộp hay không (lệch
  = lỗi nhập liệu/e-file, hoặc IRS tự điều chỉnh).
- **WIT vs TTS**: đối chiếu gián tiếp qua 1040 — hữu ích khi không có bản 1040 Tax Return.

**Đã xác nhận thật (2026-08-26)** qua khảo sát dữ liệu thật (1 hồ sơ, năm 2025, Wages): WIT
$68,069 = 1040 Tax Return $68,069 = TTS $68,069.00 — khớp tuyệt đối cả 3 tài liệu, xác nhận
Gemini đọc đúng và đối chiếu đúng cả 3 nguồn.

## 2. Kiến trúc HIỆN TẠI (đã triển khai, kiểm tra lại code trước khi tin 100%)

1. **`src/lib/crm-doc-compare.ts`**:
   - `extractPdfText(buffer)` — `pdfjs-dist` bản `legacy/build/pdf.js`, server-only (cần
     `serverExternalPackages: ["pdfjs-dist"]` trong `next.config.ts`, gotcha cũ về
     `require("canvas")` — xem comment trong file đó, KHÔNG xoá đoạn alias client-side đã có
     sẵn cho Notice Splitter). Dùng chung cho cả 3 loại tài liệu.
   - `SelectedDocEntry = {label, text}` — 1 tài liệu CỤ THỂ người dùng đã chọn, `label` đã gồm
     sẵn năm + tên người (vd `"2025 - Sanchez, Jose E"`, xây ở client) dùng thẳng làm tiêu đề
     khối trong prompt — KHÔNG còn truyền `year` riêng (mỗi tài liệu tự mang năm của chính nó).
   - `askCompareDocs({wit: SelectedDocEntry[], taxReturn: SelectedDocEntry | null, tts:
     SelectedDocEntry | null, history, message})` — `wit` là MẢNG (0-2 phần tử, ghép nhiều khối
     `[WIT - {label}]` riêng nếu có 2 người khai); `taxReturn`/`tts` mỗi cái `null` nếu người
     dùng không chọn loại đó → prompt tự chèn `"(Không có tài liệu này)"`. System instruction
     dặn AI: nếu có 2 khối WIT thì CỘNG DỒN trước khi so với 1040/TTS (trừ khi câu hỏi hỏi riêng
     1 người); nếu 1 loại không có thì để "—" ở đúng cột, KHÔNG suy đoán.
   - Dùng `@google/genai` (`GoogleGenAI` client, đọc `GEMINI_API_KEY`) —
     `ai.models.generateContent({model: "gemini-3.6-flash", contents, config: {systemInstruction,
     responseMimeType: "application/json", responseSchema}})` — **structured output**
     (`responseSchema` = `Type.ARRAY` of `Type.OBJECT{category, wit, taxReturn, tts, note}`, tất
     cả `Type.STRING`) — Gemini tự đảm bảo `response.text` LÀ JSON hợp lệ khớp schema, parse
     bằng `JSON.parse()` (có try/catch phòng hờ, lỗi parse thì trả về 1 dòng chứa nguyên văn
     text làm fallback, không throw).
   - `contents` là mảng `{role: "user"|"model", parts: [{text}]}` — SDK dùng `"model"` cho lượt
     AI (KHÁC Anthropic dùng `"assistant"` — đã tự map lại trong hàm). Mỗi lượt chat gửi lại
     TOÀN BỘ text các tài liệu ĐÃ CHỌN (API đơn giản `generateContent` không có cơ chế giữ
     context phía server cho luồng này — khác `interactions.create` mới hơn của cùng SDK có
     `previous_interaction_id`, nhưng bề mặt đó phức tạp hơn nhiều (agent/environment-oriented,
     xem `interactions.*` trong `node_modules/@google/genai/dist/genai.d.ts`) nên KHÔNG dùng cho
     nhu cầu chat đơn giản này). Lượt AI trong `history` gửi lại dạng
     `content: JSON.stringify(rows)` (KHÔNG phải văn xuôi) — Gemini đọc hiểu JSON làm ngữ cảnh
     bình thường.
   - `isGeminiConfigured()`/`GeminiConfigError` — pattern giống `AgentC3ConfigError`, thiếu
     `GEMINI_API_KEY` thì route tự trả 501 rõ ràng, không crash app.
2. **Route `POST /api/agentc3-import/compare-tts-wit-chat`** — nhận `{caseId, tts?: {url,label},
   taxReturn?: {url,label}, wit?: {url,label}[], message, history}` — client gửi THẲNG URL +
   label của từng file ĐÃ CHỌN (route KHÔNG tự tra `fetchTtsWitDatesByYear` nữa, KHÁC route
   `check-latest-tts` — route này chỉ tải/trích/gọi Gemini theo đúng URL nhận được).
   `fetchAgentC3FileBytes()` tự validate URL thuộc domain CRM (chặn SSRF) — không cần thêm lớp
   kiểm tra nào khác vì `canViewCase` đã gate quyền xem hồ sơ, và session CRM vốn dùng chung 1
   tài khoản công ty (không phải ranh giới riêng tư giữa các case). `wit` giới hạn `.slice(0,2)`
   (tối đa 2 file). **Validate 400** nếu số loại tài liệu có chọn (đếm `tts`/`taxReturn`/
   `wit.length>0` — mỗi loại tính 1, không tính số file) < 2 — thông báo "Chọn ít nhất 2 loại
   tài liệu (TTS/WIT/1040) để so sánh". `history` giữ tối đa 6 tin gần nhất — không lưu DB.
3. **UI** (`CompareChatSection` trong `crm-tts-wit-check-button.tsx`, ĐẶT Ở ĐẦU popup — trước
   `<div className="mt-4 grid grid-cols-2 ...">` chứa `DocGroup` TTS/WIT) — **3 trường chọn tài
   liệu** (`buildDocOptions()` duyệt CẢ 3 năm 2023-2025, gộp thành 1 danh sách phẳng
   `{url, label}[]`, label = `"{năm} - {tên người hoặc ngày}"`):
   - TTS: `<select>` đơn (1 file).
   - WIT: danh sách checkbox cuộn dọc (`max-h-20 overflow-y-auto`), tick tối đa 2 (`toggleWit()`
     tự khoá checkbox thứ 3 trở đi khi đã chọn đủ 2, không cảnh báo — chỉ disable).
   - 1040: `<select>` đơn (1 file).
   Nút Gửi/input chỉ bật khi `selectedTypeCount >= 2` (đếm SỐ LOẠI đã chọn ≥1 file, không phải
   tổng số file). Gõ trống rồi bấm Gửi → dùng `t("crmCompareChat.defaultMessage")` làm câu hỏi
   mặc định ("So sánh các tài liệu đã chọn, liệt kê chênh lệch chi tiết."). State UI dùng type
   `ChatEntry` riêng (KHÁC `CompareChatMessage` dây API) — tin user giữ `text` thô, tin assistant
   giữ SẴN `rows: AiCompareRow[]` đã parse để render bảng (`AiRowsTable`, 5 cột: Category | WIT |
   1040 | TTS | Note) trực tiếp không cần parse lại mỗi re-render — `toApiHistory()` chuyển
   `ChatEntry[]` → `CompareChatMessage[]` (nén rows thành JSON string) đúng lúc gửi API.

**Biến môi trường**: `GEMINI_API_KEY` — lấy tại `aistudio.google.com/apikey`, KHÔNG cần thẻ tín
dụng cho free tier (định dạng key thật dạng `AQ.xxxxx...`, KHÔNG phải `AIzaSy...` như bản cũ
hơn — đã tự nhầm 1 lần, người dùng gửi ảnh chụp dialog "API key details" của chính Google AI
Studio mới xác nhận đúng định dạng). Model đang dùng: **`gemini-3.6-flash`** — KHÔNG PHẢI
`gemini-2.5-flash` (đã thử, API trả lỗi 404 thật: *"This model models/gemini-2.5-flash is no
longer available to new users"*, Google tự khuyến nghị đổi sang `gemini-3.6-flash`, vẫn thuộc
free tier) — nếu gặp lại lỗi 404 tương tự trong tương lai, kiểm tra lại danh sách model free
tier hiện hành trước khi đổi bừa.

## 3. Đã verify với key thật (2026-08-25 → 2026-08-26)

- **2026-08-25 (văn xuôi, chỉ WIT-TTS)**: hỏi "So sánh Federal Income Tax Withheld", Gemini trả
  lời ĐÚNG khớp 100% với bảng regex lúc đó (WIT $5,713 vs TTS $5,715, lệch $2).
- **2026-08-26 (structured output, vẫn chỉ WIT-TTS)**: hỏi "Liệt kê tất cả các khoản chính đối
  chiếu được" — nhận đúng JSON 5 dòng khớp schema, VÀ tự phát hiện thêm 2 khoản lệch KHÔNG có
  trong bảng regex cũ (Unemployment compensation $450 trên WIT nhưng $0 trên TTS; Non-Employee
  Compensation $2,769 trên WIT vs Gross Receipts Schedule C $156 trên TTS).
- **2026-08-26 (sau khi mở rộng 3 tài liệu + xoá bảng regex)**: hỏi "So sánh Wages giữa WIT,
  1040 Tax Return và TTS" qua route thật (curl + session thật, hồ sơ dev tạm gán `clientLink`
  sang `BY309070`) — nhận đúng 1 dòng: WIT $68,069.00 = 1040 Tax Return $68,069 = TTS
  $68,069.00, note "Cả 3 tài liệu khớp nhau hoàn toàn" — xác nhận route mới tải + trích đúng
  CẢ 3 loại PDF (không chỉ 2 như trước) và AI đối chiếu đúng.
- **2026-08-26 (sau khi đổi sang 3 trường select tường minh)**: gọi route mới với payload
  `wit` = MẢNG 2 file (Sanchez + Nguyen, tự lấy URL thật từ `check-latest-tts`) +
  `taxReturn` = 1 file 1040 — KHÔNG chọn TTS. Kết quả: WIT (cộng dồn 2 file) = $68,069.00 khớp
  1040 = $68,069.00, TTS hiện đúng "—" (không chọn); tương tự Federal W/H: WIT $5,713.00 vs 1040
  $5,715.00 (lệch $2, TTS "—") — xác nhận đúng: (a) cộng dồn 2 file WIT hoạt động, (b) tài liệu
  không chọn hiện "—" thay vì lỗi, (c) so sánh chạy đúng dù CHỈ chọn 2/3 loại. Test riêng gửi
  payload chỉ 1 loại tài liệu (`taxReturn` only) → xác nhận route trả đúng 400 "Chọn ít nhất 2
  loại tài liệu...".
- `tsc --noEmit`/`eslint` sạch trên toàn bộ file mới/sửa sau mỗi lần đổi.

## 3b. Bug thật đã gặp trên production + đã sửa (2026-08-27)

Người dùng báo hồ sơ thật (CRM `BY4849`) thiếu tên trong dropdown TTS/WIT VÀ thiếu hẳn 2 năm
2023/2024 ở bảng "1040 Tax Return". Debug trực tiếp vào CRM thật (script `tsx` tạm, gọi thẳng
`fetchTtsWitDatesByYear()`/`fetchCrmFormContext()` với `AGENTC3_USERNAME`/`PASSWORD` ở
`.env.local` — CRM là hệ thống ngoài, không phụ thuộc app chạy ở dev hay production, tái hiện
được y hệt qua local) lộ ra **2 lỗi thật**, cả 2 đã sửa trong `agentc3-client.ts`:

1. **Mục "1040 Tax returns" gộp NHIỀU năm chung 1 tiêu đề, không có năm trong tiêu đề** — khác
   TTS/WIT luôn có năm trong tiêu đề mục (vd "Pitbulltax 2024 TTS"), CRM có 1 kiểu mục
   **"1040 Tax returns" (số nhiều, không năm)** gộp chung 2022/2023/2024 (xác nhận thật, nằm
   ngay TRƯỚC mục "2021 1040 Tax return" — mục riêng năm 2021, đang NGOÀI phạm vi
   `TARGET_YEARS` nên không lấy), năm chỉ đọc được qua chính TÊN FILE (vd "VIVIAN 2023.pdf").
   Code cũ chỉ đọc năm từ tiêu đề mục nên bỏ qua sạch 3 năm gộp chung này (2023/2024 "biến
   mất" khỏi bảng, 2025 vẫn còn vì có tiêu đề riêng "2025 1040 Tax return"). Đã sửa: nếu tiêu
   đề không có năm VÀ đang ở nhánh `isTaxReturn`, tự đọc năm từ tên file hiển thị (linkText).
2. **Tên người trong TTS/WIT bị mất/sai khi link tải đã bị "slugify"** — `extractPersonNameFromDocUrl`/
   `extractDocSubType` (tên cũ) đọc tên NGƯỜI từ chính `href` (đường link tải) — đúng với file
   tải qua `download_s3?key=...` (giữ nguyên dấu cách/phẩy trong key), nhưng SAI với file đã
   qua "processing" nội bộ CRM (`/uploads/pdfs/processing/...`, tên bị viết thường + đổi dấu
   cách/phẩy thành gạch ngang + thêm hậu tố epoch/mã khách hàng, vd
   "2023,ra,to,-vivian-9406-...-BY4849-Person1.pdf") — parse ra `null`/sai case, dropdown mất
   tên (rơi về timestamp) hoặc hiện "w&i"/"w&is" chữ thường không kèm tên. **Cách sửa**: đổi
   nguồn đọc từ `href` sang TEXT HIỂN THỊ của thẻ `<a>` (`linkEl.text().trim()`, đổi tên hàm
   thành `extractPersonNameFromFileName()`/`extractDocSubTypeFromFileName()`, nhận thẳng
   `fileName: string` thay vì `url: string`) — text hiển thị LUÔN giữ nguyên định dạng gốc có
   dấu cách/phẩy bất kể `href` đã bị biến đổi ra sao (đã xác nhận qua cả 2 kiểu file thật).

**Bài học chung khi debug tính năng đọc CRM ngoài**: **KHÔNG BAO GIỜ chỉ test với 1 hồ sơ mẫu
"đẹp"** (đủ dữ liệu, đúng định dạng chuẩn) rồi coi là đủ — CRM có nhiều "kiểu" upload khác nhau
tuỳ nguồn gốc file (tải trực tiếp qua `download_s3` vs đã qua "processing" nội bộ), và có thể
gộp nhiều năm chung 1 mục tiêu đề không báo trước. Khi người dùng báo lỗi ở 1 hồ sơ thật, LUÔN
xin link/ID khách hàng CRM thật đó để debug trực tiếp (không đoán/giả lập) — vì CRM là hệ thống
ngoài độc lập, gọi được y hệt từ máy local (`AGENTC3_USERNAME`/`PASSWORD` ở `.env.local`) mà
không cần đụng gì tới Vercel/production.

## 4. Giới hạn đã biết

- Không có OCR/fallback nếu CRM đổi định dạng PDF hoàn toàn khác — Gemini vẫn đọc được text lộn
  xộn ở mức độ nhất định (khác hẳn regex cứng đã xoá), nhưng vẫn phụ thuộc `extractPdfText` trả
  về text có nghĩa (PDF phải là dạng text thật, không phải ảnh scan — đã xác nhận đúng cho cả 3
  loại tài liệu CRM này).
- Nếu 1 năm có NHIỀU bản "1040 Tax Return"/TTS (hiếm, nhưng có thể xảy ra nếu khách sửa/nộp lại)
  route chỉ lấy bản `[0]` (mới nhất theo `fetchTtsWitDatesByYear`, đã sắp mới-nhất-trước) — WIT
  thì lấy TẤT CẢ (khử trùng theo người) vì WIT vốn nhiều người (Taxpayer+Spouse) là bình thường.
- Free tier Gemini có giới hạn request/phút không công khai rõ ràng (ẩn sau dashboard cá nhân) —
  nếu người dùng thật gặp lỗi rate limit khi dùng nhiều, đây là điểm cần điều tra đầu tiên.
