---
name: crm-tts-wit-compare
description: How TTS (Tax Return Transcript / Record of Account) and WIT (Wage & Income Transcript) documents from the external CRM tax.agentc3.com are structured, and how the "Get Files" popup's AI chat ("So sánh WIT / TTS (AI)") compares them using Gemini free tier (gemini-3.5-flash-lite, ~1,500 req/day) with structured output — Groq fallback and "1040 Tax Return" comparison were both tried and removed 2026-08-27 (the raw "1040 Tax Return" file-links section itself, unrelated to AI comparison, still exists). Read this before touching src/lib/crm-doc-compare.ts, the compare-tts-wit-chat API route, or the compare UI inside src/components/crm-tts-wit-check-button.tsx — or before extending/debugging that feature.
---

# So sánh WIT / TTS trong popup "Get Files" (cột "Doc CRM")

Tính năng nằm trong popup có sẵn của nút "Get Files" (`CrmTtsWitCheckButton`, xem thêm lịch sử
tính năng đọc link TTS/WIT/1040/Other ở phần cuối `.claude/rules/deployment-database-sync.md`).
Popup vẫn hiện 4 khối link TTS/WIT/"1040 Tax Return"/Other để tải/xem file gốc (không đổi) —
chỉ tính năng SO SÁNH BẰNG AI ở đây mới CHỈ còn WIT/TTS. Đọc file này trước khi làm/sửa phần so
sánh.

**Trạng thái hiện tại (2026-08-27, cập nhật cuối — ĐÃ GỠ GROQ VÀ ĐÃ GỠ 1040 KHỎI SO SÁNH)**: CHỈ
CÒN 1 cơ chế so sánh — khung chat `CompareChatSection` ("So sánh WIT / TTS (AI)"), đặt Ở ĐẦU
popup (trước 4 khối link TTS/WIT/1040/Other), dùng **DUY NHẤT Gemini** (`gemini-3.5-flash-lite`,
free tier ~1.500 request/ngày) trả về DẠNG BẢNG (structured output) với 2 cột giá trị **WIT |
TTS** cho mỗi hạng mục. Bản đầu (2026-08-26) từng có 3 cột WIT/1040/TTS — người dùng yêu cầu bỏ
hẳn 1040 khỏi so sánh 2026-08-27 (xem mục lịch sử #14), CHỈ còn WIT-TTS.

**Lịch sử kiến trúc AI provider (đọc theo thứ tự để hiểu vì sao đi qua nhiều bước)**: Gemini
model flagship (`gemini-3.6-flash`, 20 req/ngày) → phát hiện quá thấp → đổi hẳn sang Groq →
phát hiện Groq TPM=8.000 quá nhỏ cho "1040 Tax Return" → đổi HYBRID (Gemini ưu tiên + Groq
fallback tự động) → nghiên cứu tìm ra `gemini-3.5-flash-lite` free tier ~1.500 req/ngày (gấp 75
lần model flagship) → **GỠ HẲN Groq** (2026-08-27, cùng ngày, quyết định CUỐI) vì quota Gemini
mới đủ rộng rãi, không còn cần dự phòng, đơn giản hoá code đáng kể (bỏ 2 bộ schema, 2 định dạng
message, lớp lỗi payload-too-large riêng của Groq). Xem mục lịch sử #8/#11/#12 bên dưới cho chi
tiết từng bước — các mục nói về Groq VẪN GIỮ NGUYÊN làm lịch sử tham khảo (đừng xoá), nhưng
**code hiện tại KHÔNG còn dùng Groq nữa** — nếu thấy comment/code nào còn nhắc `groq-sdk`/
`GROQ_API_KEY`/`askGroq`, đó là tàn dư cần dọn, báo lại ngay.

**Bảng cố định thuần regex (`CompareSection`, chỉ so WIT-TTS) đã BỊ XOÁ HOÀN TOÀN** 2026-08-26
theo yêu cầu người dùng ("bỏ compare cũ đã tạo trước đó") — xem mục lịch sử bên dưới, KHÔNG khôi
phục lại trừ khi người dùng yêu cầu rõ ràng.

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
   - **Cột "Chênh lệch" tự tính + tô màu THEO HƯỚNG WIT** (`computeDiff()`/`formatDiff()` trong
     `crm-tts-wit-check-button.tsx`, đổi màu 2026-08-27 theo yêu cầu "nếu WIT lớn hơn TTS/1040
     thì đỏ, còn lệch WIT nhỏ hơn thì xanh như khớp") — đọc số đầu tiên trong mỗi cột giá trị
     ĐANG HIỆN (bỏ dấu phẩy nghìn), số hiện ra vẫn là max-min (không đổi), nhưng MÀU giờ dựa vào
     `witIsHighest`: **đỏ** CHỈ khi có chọn cột WIT VÀ giá trị WIT là giá trị LỚN NHẤT trong các
     cột đang so (WIT báo thu nhập nhiều hơn tờ khai/IRS ghi nhận = rủi ro khai thiếu); **xanh**
     mọi trường hợp còn lại (khớp tuyệt đối, WIT bằng/thấp hơn, hoặc không chọn cột WIT nên
     không có gốc so sánh theo hướng này); "—" nếu <2 giá trị đọc được thành số (category không
     phải số, vd "Filing status").
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

8. **2026-08-27, VẪN CÙNG NGÀY — đổi provider LLM 3 LẦN LIÊN TIẾP, kết thúc ở kiến trúc HYBRID**
   (đây là thay đổi kiến trúc backend, KHÔNG đụng luồng UI mục 6/7 ở trên):
   - **8a. Gemini free tier hoá ra chỉ 20 request/NGÀY** cho `gemini-3.6-flash` — phát hiện qua
     lỗi thật `RESOURCE_EXHAUSTED`, `quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier,
     quotaValue: 20`. Quan trọng: quota này tính theo **Google Cloud PROJECT**, KHÔNG phải theo
     API key — tạo key mới trong CÙNG project vẫn dính y hệt quota đã cạn (đã tự thử, xác nhận
     thật), tạo PROJECT mới cũng chỉ được cấp LẠI đúng 20/ngày (không giải quyết được vấn đề tần
     suất dùng thật). Nguyên nhân cạn quota: tính năng "Trợ lý AI" (đã xoá, xem mục "[ĐÃ XOÁ]"ở
     trên) và tính năng so sánh ở đây CÙNG dùng 1 `GEMINI_API_KEY` cộng dồn request.
   - **8b. Thử đổi HẲN sang Groq** (`groq-sdk`, model `openai/gpt-oss-120b` — model DUY NHẤT hỗ
     trợ structured output "strict" cùng `gpt-oss-20b`) — phát hiện free tier Groq giới hạn
     **~8.000 token/PHÚT/request** cho các model đó — quá nhỏ cho file "1040 Tax Return" thật
     (CRM gộp chung TOÀN BỘ Schedule/Form/worksheet đính kèm vào 1 PDF, ví dụ thật đã gặp: 39
     trang, 133.216 ký tự ≈ 47.700 token) — request bị Groq từ chối thẳng (413 "Request too
     large... Limit 8000, Requested 47702"). Thử `groq/compound-mini` (TPM cao hơn hẳn, 70.000)
     vẫn bị từ chối bởi 1 giới hạn KHÁC ("413 Request Entity Too Large", có vẻ là cap kích thước
     request tuyệt đối chứ không chỉ TPM) — và model này thuộc nhóm "Agents"/không hỗ trợ
     structured output strict nên độ tin cậy JSON cũng kém hơn. Kết luận: Groq không kham nổi
     gửi NGUYÊN VĂN 1 tài liệu thuế dài mà không rút gọn trước.
   - **8c. Quyết định CUỐI — HYBRID, theo đúng yêu cầu người dùng** ("chỉ đọc form 1040, không
     đọc các form khác, và tích hợp Gemini vào, ưu tiên dùng Gemini, sau khi hết limit tự động
     chuyển sang Groq"): `askCompareDocs()` giờ thử Gemini TRƯỚC (xử lý tài liệu dài tốt, nhược
     điểm chỉ là SỐ LƯỢT/ngày) — nếu Gemini ném lỗi 429 dai dẳng (hết `withAiRetry` mà vẫn 429,
     tức `AiRateLimitError`), TỰ ĐỘNG fallback sang Groq. Vì Groq không kham nổi toàn văn "1040
     Tax Return", nhánh Groq CHỈ gửi đúng 2 TRANG "Form 1040" GỐC (bỏ mọi Schedule 1/3/C/EIC/
     8812/Form 8995/8867/8962/4562/8582/8879, các worksheet nội bộ phần mềm khai thuế, và cả
     tờ khai State/540 nếu CRM gộp chung) — xem `extractForm1040Pages()`/`isForm1040Page()`
     trong `crm-doc-compare.ts`, nhận diện qua tiêu đề đầu mỗi trang (trang 1: chứa "U.S.
     Individual Income Tax Return"; trang 2: bắt đầu "Form 1040 (năm) Page 2"; loại trừ mọi
     trang bắt đầu "SCHEDULE" hoặc "Form {số khác 1040}"). WIT/TTS vốn đã nhỏ (WIT thật đo được
     chỉ ~1-2K ký tự/file) nên KHÔNG rút gọn khi fallback. `withAiRetry()`/`AiRateLimitError`
     (đổi tên từ `withGeminiRetry`/`GeminiRateLimitError` trong `gemini-retry.ts` cũ, giờ ở
     `ai-retry.ts`, TRUNG LẬP theo provider) dùng CHUNG cho cả 2 nhánh gọi model.

   Đây là kiến trúc HIỆN TẠI, mô tả đầy đủ ở mục 2 dưới đây (mục 5 phía trên chỉ còn giá trị lịch
   sử, ĐỪNG code theo mô tả đó).

**[ĐÃ XOÁ 2026-08-27] Tính năng song song "Trợ lý AI"**: từng có 1 nút chat Gemini free tier TỰ
DO trên toolbar bảng Hồ sơ (cạnh "My Notes", KHÔNG gắn hồ sơ/CRM nào, client riêng
`src/lib/gemini-general-chat.ts`, route riêng `POST /api/ai-chat`) — đã **XOÁ HOÀN TOÀN** theo
yêu cầu người dùng sau khi liên tục gặp lỗi 429 (giới hạn tốc độ/quota free tier) trên
production ngay cả sau khi đã thêm retry (`withGeminiRetry`, xem mục dưới) — nghi ngờ quota
NGÀY (không phải phút) đã cạn do dùng chung 1 `GEMINI_API_KEY` cho cả 2 tính năng, retry ngắn
không giúp được. Đã xoá sạch: `src/components/ai-chat-dialog.tsx`,
`src/lib/gemini-general-chat.ts`, `src/app/api/ai-chat/`, action `askAiChat` (`api-client.ts`/
`app-store.ts`), i18n key `aiChat.*`, và 2 lần gọi `<AiChatDialog>` trong `cases/page.tsx`. Nếu
sau này cần lại 1 chat AI tự do tương tự, cân nhắc dùng **RIÊNG 1 API key khác** (không chung
với tính năng so sánh WIT/1040/TTS ở skill này) để tránh 2 tính năng cùng cạnh tranh 1 quota.

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

## 2. Kiến trúc HIỆN TẠI — CHỈ Gemini (đã gỡ Groq 2026-08-27, kiểm tra lại code trước khi tin 100%)

1. **`src/lib/crm-doc-compare.ts`**:
   - `extractPdfText(buffer)` — `pdfjs-dist` bản `legacy/build/pdf.js`, server-only (cần
     `serverExternalPackages: ["pdfjs-dist"]` trong `next.config.ts`, gotcha cũ về
     `require("canvas")` — xem comment trong file đó, KHÔNG xoá đoạn alias client-side đã có
     sẵn cho Notice Splitter). Dùng chung cho cả TTS/WIT. Nối các trang bằng `"\n"`.
   - `SelectedDocEntry = {label, text}` — 1 tài liệu CỤ THỂ người dùng đã chọn, `label` đã gồm
     sẵn năm + tên người (vd `"2025 - Sanchez, Jose E"`, xây ở client) dùng thẳng làm tiêu đề
     khối trong prompt.
   - `askCompareDocs({wit: SelectedDocEntry[], tts: SelectedDocEntry | null, history, message}):
     Promise<AiCompareRow[]>` — hàm DUY NHẤT route gọi, KHÔNG còn rút gọn/xử lý gì trước khi gọi
     Gemini (đã bỏ hẳn `taxReturn`/`extractForm1040Pages`/`isForm1040Page` — mục lịch sử #14,
     những hàm này CHỈ tồn tại để xử lý "1040 Tax Return", nay không cần nữa). Gọi thẳng
     `ai.models.generateContent()` với `@google/genai` (`GoogleGenAI` client, đọc
     `GEMINI_API_KEY`) — `model: "gemini-3.5-flash-lite"`, `responseSchema` = `Type.ARRAY` of
     `Type.OBJECT{category, wit, tts, note}` (**chỉ 2 cột giá trị**, không còn `taxReturn`).
     Model **đổi 2026-08-27** từ `gemini-3.6-flash` (flagship, chỉ 20 request/NGÀY free tier —
     xác nhận thật) sang `gemini-3.5-flash-lite` (free tier ~1.500 request/ngày, gấp 75 lần —
     xem mục lịch sử #11). `contents` là mảng `{role: "user"|"model", parts: [{text}]}` — SDK
     dùng `"model"` cho lượt AI. Bọc `withTimeout()` (50s, mục lịch sử #13) rồi `withAiRetry()`
     (`ai-retry.ts`, retry 429 ngắn hạn).
   - `parseRowsFromJsonText(text)` — parse mảng rows trần `[...]` từ Gemini (vẫn chấp nhận thêm
     hình dạng `{rows:[...]}` phòng hờ model trả sai định dạng).
   - `isGeminiConfigured()`/`AiProviderConfigError` — thiếu `GEMINI_API_KEY` thì route tự trả
     501 rõ ràng ("Chưa cấu hình GEMINI_API_KEY"), không crash app.
2. **Route `POST /api/agentc3-import/compare-tts-wit-chat`** — nhận `{caseId, tts?: {url,label},
   wit?: {url,label}[], message, history}` — client gửi THẲNG URL + label của từng file ĐÃ CHỌN
   (route KHÔNG tự tra `fetchTtsWitDatesByYear` nữa, KHÁC route `check-latest-tts` — route này
   chỉ tải/trích/gọi `askCompareDocs()` theo đúng URL nhận được).
   `fetchAgentC3FileBytes()` tự validate URL thuộc domain CRM (chặn SSRF) — không cần thêm lớp
   kiểm tra nào khác vì `canViewCase` đã gate quyền xem hồ sơ, và session CRM vốn dùng chung 1
   tài khoản công ty (không phải ranh giới riêng tư giữa các case). `wit` giới hạn `.slice(0,2)`
   (tối đa 2 file). **Validate 400** nếu THIẾU 1 trong 2 (`!tts || wit.length === 0`) — thông
   báo "Chọn đủ TTS và WIT để so sánh" (đổi từ "chọn ≥2/3 loại" khi còn 1040, mục lịch sử #14).
   `history` giữ tối đa 6 tin gần nhất — không lưu DB. Bắt `AiProviderConfigError` (501),
   `AiRateLimitError` (429, Gemini hết quota), `AiTimeoutError` (504, xử lý quá lâu).
3. **UI** (`CompareChatSection` trong `crm-tts-wit-check-button.tsx`, ĐẶT Ở ĐẦU popup — trước
   `<div className="mt-4 grid grid-cols-2 ...">` chứa `DocGroup` TTS/WIT) — **2 trường chọn tài
   liệu** (`buildDocOptions()` duyệt CẢ 3 năm 2023-2025, gộp thành 1 danh sách phẳng
   `{url, label}[]`, label = `"{năm} - {tên người hoặc ngày}"`):
   - TTS: `<select>` đơn (1 file).
   - WIT: dropdown dạng `<details>` CHỈ MỞ KHI BẤM (không hiện sẵn), tick tối đa 2
     (`toggleWit()` tự khoá checkbox thứ 3 trở đi khi đã chọn đủ 2, không cảnh báo — chỉ
     disable).
   Nút Gửi/input chỉ bật khi `ready = Boolean(ttsUrl) && witUrls.length > 0` (BẮT BUỘC cả 2, đổi
   2026-08-27 từ "chọn ≥2/3 loại" khi còn 1040 — mục lịch sử #14). Gõ trống rồi bấm Gửi → dùng
   `t("crmCompareChat.defaultMessage")` làm câu hỏi mặc định ("So sánh các tài liệu đã chọn,
   liệt kê chênh lệch chi tiết."). State UI dùng type `ChatEntry` riêng (KHÁC `CompareChatMessage`
   dây API) — tin user giữ `text` thô, tin assistant giữ SẴN `rows: AiCompareRow[]` + `columns`
   (cột nào đã chọn lúc hỏi) đã parse — bảng kết quả ĐẦY ĐỦ chỉ hiện ở popup "Kết quả phân tích
   AI" RIÊNG cạnh popup chính (khung chat trong popup "Doc CRM" giờ CHỈ hiện lại câu đã hỏi,
   không lặp lại bảng — xem mục 7 lịch sử quyết định). Bảng file "1040 Tax Return" (link tải/
   xem gốc, `DocGroup`) VẪN GIỮ NGUYÊN riêng biệt bên dưới, không liên quan khung chat này.

**Biến môi trường**: CHỈ CẦN `GEMINI_API_KEY` (đã gỡ `GROQ_API_KEY` 2026-08-27 — nếu vẫn còn để
trong `.env.local`/Vercel Environment Variables, vô hại (không đọc tới) nhưng nên dọn cho gọn):
- `GEMINI_API_KEY` — lấy tại `aistudio.google.com/apikey`, KHÔNG cần thẻ tín dụng cho free tier
  (định dạng key thật dạng `AQ.xxxxx...`, KHÔNG phải `AIzaSy...` như bản cũ hơn). Model đang
  dùng: **`gemini-3.5-flash-lite`** (đổi 2026-08-27 từ `gemini-3.6-flash`, xem mục lịch sử #11)
  — KHÔNG PHẢI `gemini-2.5-flash`/`gemini-2.5-flash-lite` (đã thử, API trả lỗi 404 thật: *"This
  model ... is no longer available to new users"*, gợi ý đổi sang bản 3.5/3.6). Free tier
  `gemini-3.6-flash` (flagship) chỉ **20 request/NGÀY, tính theo Google Cloud Project** (xem mục
  lịch sử #8a) — `gemini-3.5-flash-lite` (bản Lite đang dùng) được báo **~1.500 request/ngày**
  (gấp 75 lần, chưa xác nhận chắc 100% vì dữ liệu third-party — nếu vẫn hết quota bất thường,
  kiểm tra lại con số này). Thiếu biến này thì route tự trả 501 rõ ràng, không crash app.

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
- **2026-08-27 (kiến trúc hybrid Gemini→Groq)**: test trực tiếp `askCompareDocs()` với dữ liệu
  thật (WIT + "1040 Tax Return" 39 trang/133.216 ký tự của `BY309070`) — nhánh Gemini chạy
  thành công (đúng WIT $37,000 vs 1040 $68,069, note giải thích đúng 2 nguồn W-2 khác nhau).
  Test riêng nhánh Groq (gọi thẳng, KHÔNG qua `askCompareDocs`) với đúng payload đã rút gọn qua
  `extractForm1040Pages()` — thành công, KHÔNG còn bị 413 như khi gửi nguyên văn 133K ký tự.
  Đường fallback tự động (Gemini → Groq trong `askCompareDocs`) CHƯA verify trực tiếp bằng cách
  ép Gemini 429 thật (thử ép cạn quota bằng 25 lệnh gọi liên tiếp nhưng script bị timeout ở lệnh
  thứ 7, không kịp xác nhận) — độ tin cậy dựa trên: (a) cả 2 nhánh `askGemini`/`askGroq` đã
  verify RIÊNG LẺ hoạt động đúng, (b) logic rẽ nhánh (`try/catch instanceof AiRateLimitError`)
  đơn giản, đã qua `tsc`/`eslint` sạch. **Nếu sửa lại phần này, nên tự ép Gemini hết quota thật
  (gọi dồn dập `ai.models.generateContent` tới khi gặp 429) rồi gọi `askCompareDocs()` để xác
  nhận trực tiếp đường fallback, thay vì chỉ tin vào suy luận logic.**

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

3. **(Cùng ngày, phát hiện sau khi user báo lại "vẫn thiếu tên TTS 2023/2024" ở hồ sơ KHÁC —
   `BY306702`) Tên file KHÔNG PHẢI LÚC NÀO CŨNG có dấu phẩy tách Họ/Tên** — biến thể đã biết
   trước đó luôn có dạng "{năm},{loại},{Họ}, {Tên đệm} {số}..." (Ví dụ "Nguyen, Pyon Ngoc" —
   4 phần khi `split(",")`), nhưng hồ sơ này dùng "{năm},{loại},{Cụm tên KHÔNG phẩy} {số}..."
   (vd "2023,RA,CHAU T PHAM 0035 11-10-2025 0132.pdf" — chỉ 3 phần) — code cũ đòi `parts.length
   >= 4` nên trả `null` cho cả tên LẪN subtype (subtype `extractDocSubTypeFromFileName` cũng bị
   ảnh hưởng dây chuyền vì dùng chung ngưỡng `>= 4`, dù bản thân subtype chỉ cần `parts[1]`).
   **Cách sửa**: `extractPersonNameFromFileName()` giờ nhánh theo `parts.length` — `>= 4` giữ
   nguyên logic Họ,Tên cũ; đúng `3` thì áp cùng regex đuôi (`FILE_NAME_TRAILING_META`, đã tách
   hằng số dùng chung) trực tiếp lên `parts[2]`, GIỮ NGUYÊN cụm tên không cố tách Họ/Tên (không
   có tín hiệu nào để tách đúng thứ tự). `extractDocSubTypeFromFileName()` hạ ngưỡng xuống
   `parts.length >= 2` (đúng yêu cầu tối thiểu thật sự của nó). Verify lại `BY306702` sau sửa:
   2023/2024 TTS/WIT đều ra đúng tên ("THIEN T NGUYEN", "CHAU T PHAM"...); verify lại KHÔNG hồi
   quy trên `BY309070`/`BY4849` (2 hồ sơ đã verify trước đó, kết quả giữ nguyên y hệt).

**Bài học chung khi debug tính năng đọc CRM ngoài**: **KHÔNG BAO GIỜ chỉ test với 1 hồ sơ mẫu
"đẹp"** (đủ dữ liệu, đúng định dạng chuẩn) rồi coi là đủ — CRM có nhiều "kiểu" upload khác nhau
tuỳ nguồn gốc file (tải trực tiếp qua `download_s3` vs đã qua "processing" nội bộ), CÓ THỂ có
hoặc KHÔNG có dấu phẩy tách Họ/Tên trong tên file tuỳ hồ sơ, và có thể gộp nhiều năm chung 1 mục
tiêu đề không báo trước. Khi người dùng báo lỗi ở 1 hồ sơ thật, LUÔN xin link/ID khách hàng CRM
thật đó để debug trực tiếp (không đoán/giả lập) — vì CRM là hệ thống ngoài độc lập, gọi được y
hệt từ máy local (`AGENTC3_USERNAME`/`PASSWORD` ở `.env.local`) mà không cần đụng gì tới Vercel/
production. **Đã sửa 2 vòng liên tiếp cho đúng 2 hồ sơ khác nhau báo lỗi tương tự — nếu người
dùng báo lại LẦN 3 vẫn thiếu tên ở 1 hồ sơ khác, gần như chắc chắn còn 1 biến thể tên file thứ 3
chưa biết, lặp lại đúng quy trình debug này (xin link → dump raw title/linkText/url → tìm điểm
khác biệt so với 2 biến thể đã biết) thay vì đoán mò sửa lại code hiện có.**

4. **(2026-08-27, phát hiện sau khi triển khai hybrid Gemini+Groq) CRM lưu 1 số file WIT dưới
   dạng `.html` thay vì `.pdf`** — log production lộ `InvalidPDFException: Invalid PDF
   structure`, lỗi ngay ở BƯỚC ĐỌC FILE (trước khi kịp gọi Gemini/Groq), route trả về lỗi chung
   chung "Không so sánh được tài liệu". Đã xác nhận thật: `BY4849` có file WIT
   ("2025,W&I,TO, VIVIAN...html") mở ra là HTML thật (`<!DOCTYPE html>...`), không phải PDF —
   `extractPdfText()` cũ luôn cố parse mọi file bằng `pdfjs` nên crash ngay khi gặp file này.
   **Cách sửa**: thêm `extractDocumentText()` (dùng THAY `extractPdfText` tại route) — kiểm tra
   magic bytes `"%PDF-"` ở đầu file trước, PDF thật thì đi đường `pdfjs` như cũ, không phải thì
   trích text qua `cheerio` (`$("body").text()`, đã có sẵn dependency, dùng chung với
   `agentc3-client.ts`). Đã verify lại đúng file `.html` thật của `BY4849` — trích đúng
   506.818 ký tự nội dung WIT thật ("Wage and Income Transcript Request Date...").

5. **(2026-08-27) UI từng thêm badge báo AI nào vừa trả lời — ĐÃ GỠ LẠI cùng ngày khi gỡ Groq**
   — bản đầu theo yêu cầu "show đang sử dụng AI nào" (trước đó chỉ đoán được qua log Vercel),
   `askCompareDocs()` từng trả `{rows, provider: "gemini" | "groq"}` (kiểu `AskCompareResult`)
   xuyên suốt route → `api-client.ts` → `app-store.ts` → `crm-tts-wit-check-button.tsx`, UI hiện
   badge nhỏ (xanh dương "Gemini" / cam "Groq") cạnh tiêu đề popup "Kết quả phân tích AI". Sau
   khi gỡ hẳn Groq (mục lịch sử #12), badge chỉ còn hiện MỘT màu duy nhất mãi mãi — vô nghĩa,
   nên đã bỏ luôn cùng lúc: `askCompareDocs()` quay về trả `AiCompareRow[]` trần (không còn
   `AiProvider`/`AskCompareResult`/`AiProviderBadge`) — nếu cần biết AI nào trả lời trong tương
   lai (vd thêm lại 1 provider dự phòng khác), làm lại từ đầu thay vì cố khôi phục code cũ.

6. **(2026-08-27) Quy tắc tính Gain cho khoản 1099-B (bán chứng khoán) trên WIT** — theo yêu
   cầu "nếu có Gross Proceeds và Cost Basis và Wash Sale Disallowed thì lấy Gross Proceeds +
   Wash Sale Disallowed rồi trừ Cost Basis". Thêm 1 đoạn quy tắc riêng trong
   `CHAT_SYSTEM_INSTRUCTION` (`crm-doc-compare.ts`): khi 1 khoản 1099-B trên WIT có ĐỦ cả 3 giá
   trị này, model KHÔNG dùng thẳng Gross Proceeds làm giá trị cột "wit" mà tự tính
   `Gain = Gross Proceeds + Wash Sale Loss Disallowed − Cost Basis` rồi dùng số Gain đó để đối
   chiếu với 1040/TTS, ghi rõ công thức + 3 số gốc trong note. Thiếu Cost Basis → không áp dụng
   công thức (dùng nguyên Gross Proceeds, không tự bịa Cost Basis); thiếu Wash Sale → coi bằng
   0. Đã verify sống qua `askCompareDocs()` (script tạm, dữ liệu WIT giả lập Gross
   Proceeds=$12,000/Cost Basis=$10,000/Wash Sale=$500) — cột wit ra đúng "$2,500" (không phải
   "$12,000"), note ghi đúng công thức 3 số gốc, khớp đúng dòng Schedule D $2,500 giả lập trên
   1040.

7. **(2026-08-27, cùng ngày) Màu cột "Chênh lệch" khi cả WIT và 1040/TTS đều ÂM (Capital
   Gain/Loss lỗ)** — theo yêu cầu "nếu cả WIT và TTS/1040 đều là số âm... thì màu lệch sẽ là màu
   xanh". `computeDiff()` (`crm-tts-wit-check-button.tsx`) thêm 1 override: nếu MỌI giá trị đang
   so (WIT + các cột đã chọn) đều < 0, ép `witIsHighest = false` (xanh) dù WIT có là giá trị
   "cao nhất" (ít âm nhất) theo phép so max/min bình thường — vì với 1 khoản LỖ, "WIT ít âm hơn"
   không mang ý nghĩa rủi ro khai thiếu thu nhập như khoản thu nhập dương.
   **Đã tự phát hiện thêm 1 bug có sẵn từ trước khi verify quy tắc này**: `parseAmountLike()`
   dùng regex `-?\d[\d,]*...` — dấu "-" chỉ khớp nếu đứng NGAY TRƯỚC chữ số, nhưng AI thường trả
   tiền âm dạng `"-$900.00"` (dấu trừ cách chữ số 1 ký tự do đứng trước "$") hoặc ký hiệu kế toán
   `"($900.00)"` — cả 2 dạng này bị đọc nhầm thành SỐ DƯƠNG (mất dấu trừ), khiến toàn bộ logic
   phát hiện "cả 2 đều âm" (và cả logic tô đỏ/xanh cũ) sai âm thầm với mọi khoản lỗ trước đây.
   Đã sửa: tách rời việc tìm chữ số khỏi việc xét dấu — tìm phần TRƯỚC chữ số có chứa "-" hoặc
   "(" hay không để quyết định âm/dương, không còn dựa vào regex "-" đứng liền kề chữ số. Đã
   verify độc lập qua script tạm (sao y logic, không import trực tiếp vì hàm không export) với 6
   case (cả 2 âm dạng "-$"/dạng ngoặc kế toán/cả 2 dương/mixed/bằng nhau) — tất cả đúng kỳ vọng.

8. **(2026-08-27, cùng ngày) `504` thật trên production khi so sánh "1040 Tax Return"** —
   nguyên nhân: `askGemini()` trước đó nhận NGUYÊN VĂN "1040 Tax Return" (CRM gộp 30-100+ trang
   Schedule/worksheet vào 1 file, có thể 100K+ ký tự) không rút gọn như Groq — Gemini xử lý
   chậm dần theo độ dài prompt, vượt quá 60s giới hạn cứng của route (`maxDuration = 60`, gói
   Vercel Hobby không nâng được) → Vercel tự cắt kết nối, trả `504` (không phải lỗi code, không
   có JSON body nào để đọc `error`). **Cách sửa**: chuyển bước rút gọn `extractForm1040Pages()`
   (2 trang Form 1040 gốc, loại Schedule/worksheet) từ CHỈ-Groq sang ÁP DỤNG TẬP TRUNG trong
   `askCompareDocs()` TRƯỚC KHI gọi BẤT KỲ provider nào — vừa khớp đúng những gì
   `CHAT_SYSTEM_INSTRUCTION` vốn đã mô tả sẵn ("chỉ chứa ĐÚNG 2 trang chính thức", trước đây là
   mô tả SAI với nhánh Gemini), vừa giảm hẳn thời gian xử lý. Đã verify sống: dựng 1 bundle giả
   (trang 1 + 1 trang Schedule C rác lặp 500 dòng + trang 2) — kết quả `taxReturn` đúng khớp số
   liệu ở trang 1/2 thật, Schedule C rác bị loại hoàn toàn, không còn ảnh hưởng thời gian xử lý.
9. **(2026-08-27, cùng ngày) `413`/`400 context_length_exceeded` thật từ Groq dù đã rút gọn
   1040** — WIT có 2 khối (Taxpayer+Spouse) hoặc TTS có bảng TRANSACTIONS dài vẫn có thể cộng
   dồn vượt ~8.000 token/phút của Groq (413), hoặc vượt LUÔN giới hạn context window nếu cực lớn
   (400 `context_length_exceeded`) — trước đây route bắt lỗi này vào nhánh chung chung "Không so
   sánh được tài liệu — thử lại sau", không rõ nguyên nhân. Thêm `AiPayloadTooLargeError`
   (`crm-doc-compare.ts`, `isPayloadTooLargeStatus()` nhận diện CẢ 2 dạng lỗi trên) — route trả
   status `413` kèm message rõ ràng gợi ý bớt tài liệu/đợi Gemini reset quota. Đã verify sống cả
   2 nhánh: payload cực lớn (3 khối ~150K ký tự) → Groq trả `400 context_length_exceeded` →
   đúng `AiPayloadTooLargeError`; đã xác nhận qua code review `status === 413` cũng khớp cùng 1
   nhánh xử lý (không tái hiện được đúng ngưỡng 413 chính xác qua script tạm vì phụ thuộc kích
   thước request rơi đúng khoảng giữa "vượt TPM" và "vượt context window", nhưng logic kiểm tra
   đơn giản `status === 413` nên rủi ro sai thấp).

10. **(2026-08-27, cùng ngày) Bug THẬT khiến "phân tích sai 1040" — `isForm1040Page()` viết lại
    hoàn toàn** — người dùng báo hồ sơ `BY4849` "check WIT với 1040 không trả đúng kết quả
    1040". Debug trực tiếp file 1040 THẬT của hồ sơ này (phần mềm khai thuế "Thuc Tran Agency")
    lộ ra **`pdfjs` KHÔNG trích text theo đúng thứ tự đọc thị giác** với PDF của phần mềm này —
    cụm "U.S. Individual Income Tax Return" (tiêu đề trang 1 thật) nằm GIỮA trang (sau một loạt
    label "Presidential Election Campaign", "Filing Status"...), không phải đầu trang như bản cũ
    giả định (`head = pageText.slice(0, 250)`). Tệ hơn: chữ số "2" trong cụm "Form 1040 (năm)
    Page 2" của trang 2 thật **bị MẤT HẲN** khỏi text trích được (`pdfjs` không capture được, có
    thể do vị trí render đặc biệt của số trang) — cụm `/Page\s*2/` không bao giờ khớp. Việc loại
    "SCHEDULE ..." cũng SAI vì PDF thật có "OMB No. 1545-0074  SCHEDULE 1  (Form 1040)..." — OMB
    đứng trước SCHEDULE, không khớp `^\s*SCHEDULE`. **Hậu quả thật**: KHÔNG trang nào khớp →
    `extractForm1040Pages()` fallback về "2 trang ĐẦU của file" — với hồ sơ này đó là trang bìa
    HOÁ ĐƠN + THƯ GIỚI THIỆU (hoàn toàn không phải Form 1040!) — AI nhận nhầm nội dung này thay
    vì Form 1040 thật, giải thích đúng triệu chứng "phân tích sai 1040" người dùng báo.
    **Cách sửa**: quét TOÀN TRANG (không chỉ đầu trang) tìm cụm boilerplate IRS chính thức (luôn
    nguyên văn dù thứ tự trích xáo trộn) — trang 1 nhận qua "U.S. Individual Income Tax Return"
    (chỉ Form 1040 mới có), trang 2 nhận qua TỔ HỢP ≥2 cụm riêng của trang 2 ("Standard deduction
    for-"/"Third Party Designee"/"Amount from line 11a (adjusted gross income)"), KHÔNG còn dựa
    vào số trang. Loại Schedule qua "SCHEDULE {mã} ... (Form 1040)" ở BẤT KỲ ĐÂU trong trang.
    **Đã tự gặp thêm 1 bug lúc verify**: ban đầu thêm lớp loại trừ phụ theo mã Form phụ thường
    gặp (8995/8962/8919...) — SAI, vì chính trang 1 Form 1040 THẬT cũng tự NHẮC tới các mã đó
    trong mô tả dòng của nó (vd dòng 1g "Wages from Form 8919, line 6") → tự loại nhầm luôn
    chính trang cần giữ. Đã bỏ lớp này, chỉ giữ loại trừ SCHEDULE. Verify sống: tải đúng file
    1040 thật (23 "trang"/dòng sau split, PDF 1.2MB) của `BY4849` — kết quả CHỈ đúng 2 trang
    (trang 4 và 5, đúng là Form 1040 thật) được chọn, mọi trang Schedule 1/2/1-A/B/C/D/SE/8995/
    8962 khác đều bị loại đúng.
    **Phát hiện thêm (KHÔNG phải bug, chỉ là giới hạn đã biết)**: 1 file WIT `.html` của hồ sơ
    này dài **506.818 ký tự** (transcript IRS thật, dữ liệu hợp lệ — mỗi field WIT đều có nhãn
    mô tả rất dài dòng) — nếu Gemini hết quota (fallback sang Groq) VÀ WIT lớn cỡ này, vẫn có
    thể dính `AiPayloadTooLargeError` dù 1040 đã rút gọn đúng, vì Groq giới hạn ~8.000
    token/phút cho TOÀN BỘ request kể cả không có 1040. Chưa cần xử lý thêm (thông báo lỗi đã
    rõ nguyên nhân) — chỉ xảy ra khi Gemini hết quota NGÀY hôm đó, Gemini bình thường xử lý được
    document lớn cỡ này không vấn đề gì.

11. **(2026-08-27, cùng ngày) Nghiên cứu + đổi model Gemini chính — 20 request/ngày → ~1.500
    request/ngày** — theo yêu cầu "nghiên cứu có AI nào free phân tích được 1040 mà request
    nhiều lần và token không". Đã tra cứu (WebSearch nhiều nguồn đối chiếu + WebFetch tài liệu
    chính thức Google, dữ liệu third-party nên có thể lệch nhẹ theo thời gian) và VERIFY SỐNG:
    `gemini-2.5-flash`/`gemini-2.5-flash-lite` đã ngừng cấp cho user mới (404, gợi ý đổi sang
    bản 3.5/3.6). Gọi thật `gemini-3.5-flash-lite` — hoạt động đúng, trả structured output khớp
    schema y hệt `gemini-3.6-flash` — free tier model này được nhiều nguồn báo cùng con số
    **~1.500 request/ngày, 15 request/phút** (so với 20 request/NGÀY của `gemini-3.6-flash` —
    gấp 75 lần). Groq (`llama-3.3-70b-versatile`, TPM=12.000) có TPM cao hơn `gpt-oss-120b`
    (8.000) nhưng KHÔNG hỗ trợ `strict:true` — không đáng đánh đổi vì lợi ích chính nằm ở
    Gemini, không phải Groq (Groq vẫn chỉ là dự phòng). Đã đổi `askGemini()` sang
    `gemini-3.5-flash-lite`, verify sống qua `askCompareDocs()` đầy đủ — trả đúng
    `provider: "gemini"`, kết quả structured đúng. **Đánh đổi đã biết**: "Flash-Lite" là bản nhẹ
    hơn "Flash" thường, chất lượng suy luận có thể thấp hơn 1 chút — chấp nhận được cho tác vụ
    đối chiếu số liệu (không cần suy luận phức tạp), người dùng đã xác nhận đổi qua
    AskUserQuestion.

12. **(2026-08-27, cùng ngày, ngay sau mục #11) GỠ HẲN Groq** — người dùng yêu cầu thẳng "gỡ bỏ
    groq" ngay sau khi đổi model Gemini thành công. Lý do hợp lý: quota Gemini mới (~1.500
    request/ngày) đủ rộng rãi nên khả năng cần fallback gần như bằng 0, giữ Groq chỉ còn là code
    phức tạp không cần thiết (2 bộ response schema khác hình dạng, 2 định dạng message
    Gemini-style/OpenAI-style, lớp lỗi `AiPayloadTooLargeError` riêng cho Groq 413/400, dependency
    `groq-sdk`). Đã xoá SẠCH: `askGroq()`, `GROQ_RESPONSE_SCHEMA`, `isGroqConfigured()`/
    `getGroqClient()`, `AiPayloadTooLargeError`/`isPayloadTooLargeStatus()`, import `Groq` từ
    `groq-sdk` (+ `npm uninstall groq-sdk`), `AiProvider`/`AskCompareResult`/badge UI (mục #5).
    `askCompareDocs()` giờ CHỈ gọi `askGemini()` thẳng, trả `AiCompareRow[]` trần — không còn
    try/catch fallback provider nào. Route (`compare-tts-wit-chat/route.ts`) bỏ nhánh bắt
    `AiPayloadTooLargeError`. `api-client.ts`/`app-store.ts`/`cases/page.tsx` bỏ field `provider`
    khỏi kiểu trả về. `.env.example` bỏ đoạn `GROQ_API_KEY`. Đã verify sống qua `askCompareDocs()`
    (script tạm, dữ liệu WIT/1040 giả lập) — vẫn trả đúng kết quả structured, không còn field
    `provider`. `tsc --noEmit`/`eslint` sạch trên toàn bộ file liên quan. **Không cần bước
    production nào** (không đổi schema/feature-permission) — chỉ cần deploy code; nếu
    `GROQ_API_KEY` còn sót trong Vercel Environment Variables, có thể xoá cho gọn (vô hại nếu để
    lại, code không đọc tới nữa).

13. **(2026-08-27, cùng ngày, sau mục #12) `504` thật tái xuất SAU KHI đã gỡ Groq — thêm timeout
    nội bộ** — người dùng báo lại đúng "So sánh WIT/1040/TTS" vẫn `504`. Debug lại với ĐÚNG file
    WIT thật 500K+ ký tự của `BY4849` (đã dùng ở mục #10) qua model MỚI (`gemini-3.5-flash-lite`)
    — kết quả chỉ mất **~8.6 giây**, xa dưới 60s giới hạn Vercel, tức KHÔNG PHẢI do kích thước tài
    liệu như nghi ngờ ban đầu. Kết luận: lần `504` này nhiều khả năng là 1 request chậm bất
    thường (mạng/model, không lặp lại ổn định) — dù chưa xác định được nguyên nhân gốc chính
    xác, đã thêm lớp phòng thủ: `withTimeout()` (`crm-doc-compare.ts`, mới) bọc quanh lời gọi
    Gemini, tự huỷ SỚM ở **50 giây** (dưới mốc 60s Vercel cắt cứng) và ném `AiTimeoutError` với
    thông báo rõ ràng ("Gemini xử lý quá lâu — thử lại, hoặc chọn ít tài liệu hơn") thay vì để
    Vercel tự cắt kết nối trong im lặng (`504` thô, không có JSON lỗi nào để đọc — đúng triệu
    chứng người dùng gặp). Route bắt riêng `AiTimeoutError` → trả status `504` kèm message rõ.
    Đã verify độc lập logic `withTimeout()` (script tạm, promise nhanh/chậm giả lập) — cả 2 case
    đúng kỳ vọng (resolve bình thường khi nhanh hơn timeout; reject đúng `AiTimeoutError` khi
    chậm hơn). **Giới hạn còn lại**: đây là lưới an toàn cho TRẢI NGHIỆM (lỗi rõ ràng thay vì
    504 thô), KHÔNG giải quyết được nguyên nhân gốc nếu Gemini thật sự chậm — nếu người dùng báo
    lại lỗi timeout LẶP LẠI nhiều lần (không phải 1 lần đơn lẻ), cần điều tra sâu hơn (có thể do
    1 combo tài liệu cụ thể lớn hơn hẳn ca đã test, hoặc Gemini free tier có độ trễ cao hơn vào
    giờ cao điểm).

14. **(2026-08-27, cùng ngày, sau mục #13) GỠ HẲN "1040 Tax Return" khỏi tính năng so sánh —
    chỉ còn WIT + TTS** — người dùng yêu cầu thẳng "bỏ tính năng và dropdown so sánh với 1040,
    chỉ check TTS và WIT". Đây là thay đổi PHẠM VI (không phải bug/hiệu năng như mục #10/#13),
    làm gọn hẳn tính năng vì 1040 vốn là nguồn phức tạp nhất (PDF CRM gộp 30-100+ trang, cần
    `extractForm1040Pages()`/`isForm1040Page()` riêng để lọc đúng 2 trang gốc — cả 2 hàm này đã
    **XOÁ SẠCH** cùng lúc, không còn lý do tồn tại). Thay đổi xuyên suốt:
    - `crm-doc-compare.ts`: `AiCompareRow`/`AskParams`/`GEMINI_RESPONSE_SCHEMA` bỏ field
      `taxReturn`, chỉ còn `{category, wit, tts, note}`. `CHAT_SYSTEM_INSTRUCTION` viết lại ngắn
      gọn — bỏ hẳn phần "3 tài liệu"/"3 cặp đối chiếu", chỉ còn 1 cặp WIT vs TTS (quy tắc "LUÔN
      LẤY WIT LÀM GỐC" và công thức Gain 1099-B GIỮ NGUYÊN, chỉ đổi đối tượng so sánh từ
      "1040/TTS" thành "TTS"). Xoá `extractForm1040Pages()`/`isForm1040Page()`.
    - Route (`compare-tts-wit-chat/route.ts`): bỏ field `taxReturn` khỏi body, validate đổi từ
      "chọn ≥2/3 loại" thành "PHẢI có cả TTS lẫn WIT" (`!tts || wit.length === 0` → 400).
    - `api-client.ts`/`app-store.ts`/`cases/page.tsx`: bỏ `taxReturn` khỏi mọi type khai báo của
      `compareTtsWitChat`.
    - `crm-tts-wit-check-button.tsx`: `CompareChatSection` bỏ hẳn `<select>` "1040" (giờ chỉ còn
      2 ô TTS/WIT, `grid-cols-3` → `grid-cols-2`), `CompareColumns` bỏ `taxReturn`, `ready` đổi
      từ "chọn ≥2/3" thành `Boolean(ttsUrl) && witUrls.length > 0` (bắt buộc CẢ 2), `AiRowsTable`
      bỏ cột "1040". **Bảng file "1040 Tax Return" (link tải/xem gốc trên CRM, `DocGroup`) VẪN
      GIỮ NGUYÊN** dưới popup — chỉ tính năng SO SÁNH BẰNG AI mới bỏ 1040, người dùng vẫn mở/tải
      file 1040 gốc bình thường qua đúng khu vực đó để tự đọc, không mất chức năng xem file.
    - i18n (`crmCompareChat.title`/`crmCompare.missingDocs`, VI+EN): bỏ nhắc "1040".
    - Đã verify sống qua `askCompareDocs()` (script tạm, dữ liệu WIT+TTS giả lập) — trả đúng
      2 cột `wit`/`tts`, không còn `taxReturn`. `tsc --noEmit`/`eslint` sạch toàn bộ file liên
      quan. **Không cần bước production nào** (không đổi schema/feature-permission) — chỉ cần
      deploy code.

15. **(2026-08-27, cùng ngày, sau mục #14) Tự tách/cộng dồn 1099-B và 1099-DA BẰNG CODE thay vì
    bắt AI tự đọc + cộng — module mới `src/lib/wit-capital-gains.ts`** — người dùng hỏi "tại sao
    khi đọc WIT đầu W&I không thể tổng hợp tiền proceeds, cost basis và wash sale của 1099-B
    hoặc 1099-DA". Debug trực tiếp với 2 hồ sơ CRM thật:
    - `BY306702` (2024, THIEN T NGUYEN, WIT Merrill Lynch): **195 giao dịch 1099-B riêng lẻ**
      trong 1 file. Yêu cầu AI tự cộng → request **TIMEOUT thật** (quá 50s). Tính tay bằng regex
      → Gain thật = **$24,557.00** (Tổng Proceeds $1,097,696 + Tổng Wash Sale $84,358 − Tổng
      Cost or Basis $1,157,497).
    - `BY4849` (2025, VIVIAN TO, WIT Robinhood): **249 giao dịch 1099-B** — trước đây (mục #6,
      lúc còn dùng model `gemini-3.6-flash`) AI TỰ tính ra "$382,909.50", trong khi số ĐÚNG (tính
      lại bằng regex) là **$50,000.00** — **sai lệch 7.6 LẦN**, bằng chứng cụ thể AI không đáng
      tin cậy khi tự cộng hàng loạt giao dịch quy mô lớn, bất kể model/prompt viết rõ đến đâu.
    - **Nguyên nhân gốc thứ 2**: field tên thật trên WIT là `"Cost or Basis:"` (có chữ "or" ở
      giữa) — KHÁC "Cost Basis" 2 từ dính liền đã dùng trong `CHAT_SYSTEM_INSTRUCTION` các bản
      trước (mục #6). Field "Wash Sale Loss Disallowed:" đúng như đã dùng.
    - **Nguyên nhân gốc thứ 3**: 1099-DA (bán tài sản số/crypto, form IRS mới) CHƯA TỪNG được
      nhắc trong prompt trước đây (chỉ nói "1099-B") — cấu trúc THẬT của 1099-DA khác hẳn: phần
      lớn KHÔNG có field "Cost or Basis" dạng số tiền (ghi rõ *"...Cost or Other Basis is NOT
      being reported to the IRS"* — sàn crypto thường không biết giá vốn thật, nhất là khi
      chuyển ví/sàn khác) — chỉ có "Proceeds", không tính được Gain chính xác.

    **Cách sửa (giải pháp đúng, không phải vá prompt)**: viết `src/lib/wit-capital-gains.ts` —
    tách TỪNG giao dịch 1099-B/1099-DA theo ranh giới `"Form 1099-B"`/`"Form 1099-DA"` (tiêu đề
    lặp lại ở đầu MỖI giao dịch, xác nhận 1:1 qua debug thật — KHÔNG dùng regex "3 field trong 1
    cửa sổ ký tự cố định" vì khoảng cách giữa Proceeds/Cost or Basis/Wash Sale khác nhau tuỳ
    broker), trích 3 field trong PHẠM VI từng giao dịch, cộng dồn bằng `summarizeCapitalGains()`
    (tách riêng bucket 1099-B, 1099-DA "covered" có giá vốn, 1099-DA "noncovered" chỉ có
    Proceeds). Route/`crm-doc-compare.ts` gọi hàm này TRƯỚC khi build prompt, chèn kết quả vào 1
    khối `"[TÍNH TOÁN SẴN - Cộng dồn 1099-B/1099-DA trên WIT (đã tính bằng code, KHÔNG được tự
    cộng lại)]"` — sửa `CHAT_SYSTEM_INSTRUCTION` bắt AI **DÙNG THẲNG** con số Gain đã tính sẵn ở
    đó, không tự đọc/cộng lại.
    **Bug thật đã tự gặp lúc verify (rất quan trọng, đọc trước khi tưởng chỉ cần thêm khối tính
    sẵn là đủ)**: sau khi thêm khối "[TÍNH TOÁN SẴN...]" nhưng VẪN gửi kèm nguyên văn toàn bộ
    195 giao dịch gốc, request **VẪN TIMEOUT** — vì các giao dịch 1099-B/1099-DA chiếm >90%
    dung lượng 1 file WIT thật (vd 195K/217K ký tự), vấn đề không chỉ là "AI có phải tự cộng hay
    không" mà còn là **THỜI GIAN GEMINI ĐỌC HẾT INPUT khổng lồ**. Đã sửa thêm
    `stripCapitalGainsRecordsFromText()` (cùng file) — CẮT HẲN nguyên văn các giao dịch đã tính
    xong khỏi text gửi AI (giữ nguyên mọi thu nhập khác: W-2/1099-INT/1099-DIV/1099-R/1099-NEC/
    1099-MISC/5498...), chèn 1 dòng đánh dấu ngắn tại vị trí đã cắt.
    **Đã verify sống đầy đủ, cả 2 lớp (tính đúng + tốc độ)**:
    - `summarizeCapitalGains()` độc lập: `BY306702` ra đúng $24,557.00 (khớp 100% số tính tay);
      `BY4849` ra $50,000.00 (1099-B) + $152,319.00 Proceeds (1099-DA noncovered).
    - `askCompareDocs()` đầy đủ (sau khi thêm `stripCapitalGainsRecordsFromText`): `BY306702`
      (195 giao dịch) chỉ mất **1.4 giây** (trước đó timeout >50s), AI trả đúng `$24,557.00`
      khớp TTS giả lập. `BY4849` (249 giao dịch 1099-B + nhiều 1099-DA) mất **~3 giây**, AI trả
      đúng 2 dòng riêng biệt (1099-B `$50,000.00`, 1099-DA `$152,319.00 (Proceeds)` kèm giải
      thích rõ giới hạn thiếu giá vốn) — không còn gộp nhầm/sai số.
    `tsc --noEmit`/`eslint` sạch. **Không cần bước production nào** (không đổi schema/feature-
    permission) — chỉ cần deploy code.

16. **(2026-08-27, cùng ngày, sau mục #15) 3 bug tiếp theo phát hiện khi test với hồ sơ 2 người
    thật (`BY306702`, Thien Nguyen + Chau Pham, Married Filing Joint) — gộp 1099-B/DA thành 1
    dòng, phát hiện + sửa bug "nuốt mất 1099-INT" khi cắt text** — người dùng báo "check TTS với
    W&I ra kết quả không giống W&IS", "tổng của 1099B và 1099DA nên gộp lại", "cũng không có
    1099-INT".
    - **Phát hiện kiến trúc quan trọng**: "W&I" và "W&IS" KHÔNG PHẢI Taxpayer/Spouse — là **2
      LOẠI SẢN PHẨM KHÁC NHAU** của cùng 1 người: "W&I" = Wage & Income Transcript CHI TIẾT (mọi
      W-2/1099 riêng lẻ), "W&IS" = "Wage & Income **Summary**" — bản TÓM TẮT do CHÍNH IRS tính
      sẵn (chỉ ~1-1.2KB, có field `"Wages:"`/`"Interest:"`/`"Proceeds:"`/`"Cost or Basis:"`/
      `"Wash Sale Loss Disallowed:"` đã cộng dồn toàn bộ payer). Đã dùng nó làm NGUỒN ĐỐI CHỨNG
      để verify code: lấy `"W&I"` chi tiết của Thien Nguyen (2025, 472 giao dịch 1099-B) chạy
      qua `summarizeCapitalGains()` → Cost or Basis $3,418,070.00 khớp CHÍNH XÁC, Wash Sale
      $66,605.00 khớp CHÍNH XÁC, Proceeds lệch chỉ $27/$3.29M (~0.0008%, sai số làm tròn không
      đáng kể) so với số IRS tự tính sẵn trong "W&IS" — xác nhận code trích đúng. **"Kết quả
      khác nhau giữa W&I và W&IS"** người dùng báo là ĐÚNG NHƯ THIẾT KẾ (không phải bug) — 2
      dropdown WIT hiện liệt kê PHẲNG cả "W&I" lẫn "W&IS" như thể ngang hàng, người dùng dễ chọn
      nhầm 1 người dùng "W&I" + người kia dùng "W&IS" (2 định dạng khác nhau) hoặc so trực tiếp
      2 định dạng của CÙNG 1 người — bản chất khác định dạng nên số liệu trình bày khác nhau là
      bình thường, KHÔNG sửa gì ở đây (chưa đủ thời gian làm UI cảnh báo/ưu tiên chọn 1 định
      dạng — có thể làm sau nếu người dùng yêu cầu).
    - **Bug #1 — gộp 1099-B + 1099-DA thành 1 dòng DUY NHẤT** (theo yêu cầu trực tiếp): thêm
      field `combinedGain` vào `CapitalGainsSummary` (`= form1099B.gain + form1099DACovered.gain`,
      CHƯA gồm phần `noncoveredProceeds` vì không tính được Gain thật) — `CHAT_SYSTEM_INSTRUCTION`
      đổi từ "2 category `Capital Gains (1099-B)`/`Capital Gains (1099-DA)`" thành ĐÚNG 1
      category `"Capital Gains (1099-B + 1099-DA)"`, dùng thẳng `combinedGain`. Lý do: TTS/IRS
      luôn báo GỘP CHUNG 1 con số duy nhất (không tách theo loại form), tách riêng khiến không
      so sánh 1-1 được với TTS.
    - **Bug #2 (NGHIÊM TRỌNG, tự phát hiện khi verify — đây là bug thật khiến "không có
      1099-INT")**: `stripCapitalGainsRecordsFromText()` bản đầu chỉ tìm ranh giới
      `"Form 1099-B"`/`"Form 1099-DA"` — record 1099-B/DA CUỐI CÙNG trong file (không có giao
      dịch 1099-B/DA nào theo sau) bị coi là "kéo dài tới HẾT VĂN BẢN", NUỐT MẤT mọi nội dung
      nằm sau nó. Xác nhận thật: 2 dòng `"Form 1099-INT"` của `BY306702` (Thien Nguyen, lãi US
      Treasury $667 + Robinhood $37 = $704) nằm NGAY SAU giao dịch 1099-B cuối cùng — bị cắt mất
      hoàn toàn (text sau cắt chỉ còn 1.701/514.864 ký tự, mất luôn cả 1099-INT thay vì giữ lại).
      **Cách sửa**: `findFormBoundaries()` mới — nhận diện ranh giới theo BẤT KỲ mã Form nào
      trong 1 WHITELIST cố định (`WIT_FORM_TYPES`: W-2/1099-B/1099-DA/1099-INT/1099-DIV/1099-R/
      1099-NEC/1099-MISC/1099-G/1099-K/1099-C/1099-OID/1099-Q/1099-SA/1098[-E/-T]/5498[-SA]/
      SSA-1099), không chỉ 1099-B/DA — mỗi record 1099-B/DA giờ kết thúc ĐÚNG tại ranh giới Form
      TIẾP THEO (bất kỳ loại nào), không tràn sang nội dung khác. **Bug lồng #2b phát hiện ngay
      khi sửa #2**: thử dùng regex TỔNG QUÁT "Form + 4 chữ số bất kỳ" (không whitelist) trước —
      SAI vì mỗi record 1099-B tự chứa câu tham chiếu nội bộ *"...Applicable Check Box on **Form
      8949**: Long term transaction..."* — "Form 8949" bị hiểu nhầm thành ranh giới mới, cắt vụn
      record giữa chừng, khiến phần còn lại của record 1099-B thật (từ "Applicable..." tới hết)
      bị coi thuộc "form 8949" nên KHÔNG bị cắt bỏ (kết quả: chỉ giảm còn 181K/514K ký tự thay vì
      đúng ra ~4-20K). Đổi hẳn sang whitelist các mã Form THẬT LÀ 1 loại thu nhập độc lập (không
      gồm "8949"/"8814"/"4972" — các form chỉ được THAM CHIẾU nội bộ, không phải tiêu đề record)
      mới hết bug. Verify lại: text sau cắt còn ĐÚNG 3.837/514.864 ký tự, giữ nguyên "1099-INT".
    - **Verify sống đầy đủ cuối cùng** (`BY306702`, 2 người, WIT "W&I" + TTS thật, hỏi "So sánh
      Wages, Taxable interest, Capital Gains"): **Wages (W-2)** gộp đúng cả 2 người ($74,202 WIT
      = $37,547 Chau + $36,655 Thien, vs $74,203 TTS, lệch $1 do làm tròn). **Taxable interest
      (1099-INT)** GIỜ ĐÃ HIỆN ĐÚNG ($704 WIT = $667 US Treasury + $37 Robinhood, vs $38 TTS,
      lệch $666 — phát hiện thật quan trọng, trước đây hoàn toàn bị bỏ sót). **Capital Gains
      (1099-B + 1099-DA)** đúng 1 dòng gộp ($-63,138 WIT vs $-3,000 TTS, AI tự giải thích đúng
      luật giới hạn khấu trừ lỗ vốn $3.000/năm — Capital Loss Carryover). Mất ~37 giây (vẫn dưới
      50s timeout). `tsc --noEmit`/`eslint` sạch. **Không cần bước production nào**.

17. **(2026-08-27, cùng ngày, sau mục #16) Sửa công thức `combinedGain` — người dùng tự đối
    chiếu số IRS thật trong "W&IS" lộ ra sai số lớn** — người dùng tính tay Capital Gain gộp cả
    2 người từ "W&IS" ra `-$58,731`, trong khi tool trả về `-$63,138` (dùng "W&I") — hỏi thẳng
    tại sao lệch. Nguyên nhân: `combinedGain` bản đầu (mục #16) = `form1099B.gain +
    form1099DACovered.gain`, **LOẠI HẲN** Proceeds của phần 1099-DA "noncovered" ($4,434.00,
    không có giá vốn) ra khỏi công thức — coi như "không tính được nên bỏ qua hoàn toàn". Verify
    lại bằng cách trừ 2 số IRS thật (Cost or Basis/Wash Sale đã khớp CHÍNH XÁC qua mục #16, chỉ
    còn nghi Proceeds): `$63,138 − $58,731 = $4,407` ≈ đúng bằng `$4,434` Proceeds noncovered bị
    loại nhầm (chênh $27 là sai số làm tròn đã biết từ trước). **Kết luận**: IRS tự tính "Capital
    Gains" trên "W&IS" theo quy ước **CỘNG Proceeds của CẢ phần noncovered vào, coi giá vốn
    thiếu = $0** (KHÔNG loại bỏ hẳn) — verify công thức mới: `(Proceeds 1099-B + Proceeds
    1099-DA CẢ covered LẪN noncovered) + Wash Sale − Cost Basis (chỉ cộng phần THẬT SỰ có)` =
    `$3,288,327 + $4,434 + $66,605 − $3,418,070 = -$58,704` — lệch chỉ `$27`/`$3,29 triệu`
    (~0,05%, sai số làm tròn đã biết) so với số IRS thật `-$58,731`. Đã sửa `combinedGain` trong
    `summarizeCapitalGains()` theo đúng công thức mới, cập nhật note trong
    `formatCapitalGainsSummaryBlock()`/`CHAT_SYSTEM_INSTRUCTION` ghi rõ: tổng gộp ĐÃ CỘNG phần
    noncovered (coi giá vốn = $0, đúng quy ước IRS cho 1 con số tổng hợp), nhưng KHÔNG PHẢI Gain
    chính xác về thuế cho RIÊNG phần đó (giá vốn thật vẫn không biết được). Verify sống lại toàn
    luồng: `summarizeCapitalGains()` độc lập ra đúng `-$58,704.00`; `askCompareDocs()` đầy đủ
    (BY306702, WIT "W&I" 2 người + TTS thật) trả đúng 1 dòng `"Capital Gains (1099-B +
    1099-DA)"` = `$-58,704.00` vs TTS `$-3,000.00`, AI tự giải thích đúng luật giới hạn khấu trừ
    lỗ vốn — mất ~21.6 giây. `tsc --noEmit`/`eslint` sạch. **Không cần bước production nào**.

18. **(2026-08-27, cùng ngày, sau mục #17) Tổng quát hoá — gộp MỌI loại Form (không chỉ
    1099-B/DA), đổi tên file `wit-capital-gains.ts` → `wit-income-summary.ts`** — người dùng báo
    "lỗi quan trọng, khi cả 2 file WIT&I có 2 thông tin thì gộp thành 1 số, ví dụ 2 file có 2
    INT và 2 W2 thì gộp chung lại", rồi tổng quát hoá thêm "tương tự với DIV, 1099G hay bất cứ
    khoản tiền nào, nếu chung 1 form thì gộp làm 1 số tổng". Trước đó chỉ 1099-B/DA được tính
    sẵn trong code (mục #15-#17) — mọi Form khác (W-2/1099-INT/1099-DIV/1099-G/1099-R/5498...)
    vẫn để AI tự đọc + cộng qua nhiều bản ghi/nhiều khối WIT, đúng bug đã biết trước đó (LLM
    không đáng tin cậy khi tự cộng hàng loạt).
    - **Thiết kế TỔNG QUÁT** (không cần biết trước tên field cụ thể của từng loại Form):
      `findFormBoundaries()` (đã có sẵn từ mục #16) tách MỌI record theo whitelist `WIT_FORM_TYPES`
      — mới `extractDollarFields()` trích MỌI field dạng `"{Nhãn}: $X.XX"` trong 1 record (không
      cần biết trước nhãn — W-2 có "Wages, Tips and Other Compensation", 1099-INT có "Interest",
      1099-DIV có "Ordinary Dividends"/"Qualified Dividends", 1099-G có "Prior Year Refund",
      5498 có "Fair Market Value of Account"... đều bắt được bằng 1 regex chung). `summarizeOtherWitForms()`
      cộng dồn TỪNG field theo TỪNG loại Form, qua MỌI khối WIT đã chọn (Taxpayer + Spouse) — trả
      `WitFormTypeSummary[]`. 1099-B/DA VẪN xử lý riêng (`summarizeCapitalGains`, không đổi) vì
      có công thức Gain đặc thù không áp dụng chung được.
    - **Bug thật tự phát hiện khi verify (nhãn field bị dính rác)**: field liền TRƯỚC 1 field có
      giá trị `$` nhưng bản thân KHÔNG có `$` (vd `"Submission Type: Original document"`) không
      tạo điểm dừng tự nhiên cho regex — nhãn trích ra bị nuốt luôn cụm đó (`"Original document
      Wages, Tips and Other Compensation"` thay vì đúng ra chỉ `"Wages, Tips and Other
      Compensation"`), tương tự mã tài khoản/CUSIP đứng trước field cũng bị nuốt nhầm (vd
      `"Z60J03-1 Fair Market Value of Account"`). **Cách sửa**: `cleanLabel()` — quét NGƯỢC TỪ
      CUỐI nhãn thô, giữ các từ HỢP LỆ liên tiếp (`isValidLabelWord()`: chỉ gồm chữ cái + dấu câu
      thường gặp — loại được mã số/CUSIP chứa chữ số — VÀ bắt đầu chữ hoa hoặc là từ nối ngắn
      trong whitelist như "of"/"and"/"or"), gặp từ đầu tiên không hợp lệ thì dừng, chỉ giữ phần
      SAU đó làm nhãn thật.
    - **`stripAllWitRecordsFromText()`** (thay `stripCapitalGainsRecordsFromText` cũ, đã xoá) —
      cắt bỏ record của MỌI loại Form trong whitelist (không chỉ 1099-B/DA), vì giờ MỌI loại đã
      được trích + cộng sẵn trong code. Đã verify: file WIT thật 514.864 ký tự (Thien Nguyen)
      giảm còn **288 ký tự**; file 1.740 ký tự (Chau Pham) còn **301 ký tự**.
    - `CHAT_SYSTEM_INSTRUCTION` thêm 1 đoạn quy tắc mới (trước đoạn 1099-B/DA riêng): nếu prompt
      có khối `"[TÍNH TOÁN SẴN - Tổng từng field theo loại Form khác trên WIT, ĐÃ CỘNG DỒN mọi
      khối WIT đã chọn (đã tính bằng code, KHÔNG được tự cộng lại)]"`, PHẢI DÙNG THẲNG con số đã
      cộng sẵn (đã gộp cả Taxpayer/Spouse, cả nhiều bản ghi cùng loại), không tự tính lại.
    - **Đổi tên file** `wit-capital-gains.ts` → `wit-income-summary.ts` (`git mv`, cập nhật 1 nơi
      import duy nhất trong `crm-doc-compare.ts`) — phản ánh đúng phạm vi mới, không còn chỉ về
      capital gains.
    - **Verify sống đầy đủ** (`BY306702`, WIT "W&I" 2 người + TTS thật, hỏi "So sánh Wages,
      Taxable interest, Dividends, và Capital Gains"): **Wages** gộp đúng 1 dòng `$74,202.00` (=
      $37,547 Chau + $36,655 Thien) vs TTS `$74,203.00`. **Taxable Interest** đúng `$704.00` (=
      $667 US Treasury + $37 Robinhood, CẢ 2 bản ghi CÙNG 1 người Thien) vs TTS `$38.00`.
      **Ordinary Dividends** — category MỚI lần đầu xuất hiện đúng — `$83.00` vs TTS `$84.00`.
      **Capital Gains** vẫn đúng `$-58,704.00` vs TTS `$-3,000.00` (không hồi quy so mục #17).
      Mất **~17.4 giây**. `tsc --noEmit`/`eslint` sạch. **Không cần bước production nào** (không
      đổi schema/feature-permission).

## 4. Giới hạn đã biết

- Không có OCR/fallback nếu CRM đổi định dạng PDF hoàn toàn khác — Gemini vẫn đọc được text lộn
  xộn ở mức độ nhất định (khác hẳn regex cứng đã xoá), nhưng vẫn phụ thuộc `extractPdfText` trả
  về text có nghĩa (PDF phải là dạng text thật, không phải ảnh scan — đã xác nhận đúng cho cả 3
  loại tài liệu CRM này).
- Nếu 1 năm có NHIỀU bản "1040 Tax Return"/TTS (hiếm, nhưng có thể xảy ra nếu khách sửa/nộp lại)
  route chỉ lấy bản `[0]` (mới nhất theo `fetchTtsWitDatesByYear`, đã sắp mới-nhất-trước) — WIT
  thì lấy TẤT CẢ (khử trùng theo người) vì WIT vốn nhiều người (Taxpayer+Spouse) là bình thường.
- **Free tier Gemini model flagship (`gemini-3.6-flash`) chỉ 20 request/NGÀY (không phải chỉ
  giới hạn phút) — ĐÃ GẶP THẬT trên production (2026-08-27)** — xem mục lịch sử #8/#11. Đã đổi
  model sang `gemini-3.5-flash-lite` (~1.500 request/ngày) thay vì tiếp tục dựa vào Groq dự
  phòng (Groq ĐÃ GỠ HẲN, xem mục lịch sử #12) — nếu vẫn hết quota NGÀY thật sự dù đã đổi model
  (429 dai dẳng kể cả sau retry của `withAiRetry()`), `AiRateLimitError` ném thẳng ra route,
  người dùng thấy lỗi rõ ràng "đang bị giới hạn tốc độ — thử lại sau", KHÔNG còn tự động chuyển
  provider nào khác. Tính năng "Trợ lý AI" (chat tự do, KHÔNG liên quan compare) đã xoá hẳn ở
  bước trung gian (xem mục "[ĐÃ XOÁ 2026-08-27]" đầu file) để giảm tải quota Gemini — quyết định
  đó VẪN ĐÚNG, không liên quan gì tới việc gỡ Groq (2 vấn đề độc lập).
