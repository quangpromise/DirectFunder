---
name: crm-tts-wit-compare
description: How TTS (Tax Return Transcript / Record of Account), WIT (Wage & Income Transcript), and "1040 Tax Return" documents from the external CRM tax.agentc3.com are structured, and how the "Get Files" popup's AI chat ("So sánh WIT / 1040 / TTS (AI)") compares any pair of them using a HYBRID Gemini-then-Groq free-tier setup with structured output (Gemini first, auto-fallback to Groq when Gemini's daily quota is exhausted). Read this before touching src/lib/crm-doc-compare.ts, the compare-tts-wit-chat API route, or the compare UI inside src/components/crm-tts-wit-check-button.tsx — or before extending/debugging that feature.
---

# So sánh WIT / 1040 Tax Return / TTS trong popup "Get Files" (cột "Doc CRM")

Tính năng nằm trong popup có sẵn của nút "Get Files" (`CrmTtsWitCheckButton`, xem thêm lịch sử
tính năng đọc link TTS/WIT/1040/Other ở phần cuối `.claude/rules/deployment-database-sync.md`).
Đọc file này trước khi làm/sửa phần so sánh.

**Trạng thái hiện tại (2026-08-27, cập nhật cuối)**: CHỈ CÒN 1 cơ chế so sánh — khung chat
`CompareChatSection` ("So sánh WIT / 1040 / TTS (AI)"), đặt Ở ĐẦU popup (trước cả 3 khối link
TTS/WIT/1040/Other), dùng **HYBRID Gemini + Groq (2 provider free tier)** trả về DẠNG BẢNG
(structured output) với ĐỦ 3 cột giá trị **WIT | 1040 | TTS** cho mỗi hạng mục — cho phép người
dùng tự nhìn ra chênh lệch giữa BẤT KỲ cặp nào trong 3 tài liệu (WIT-1040, 1040-TTS, WIT-TTS),
không chỉ WIT-TTS như thiết kế ban đầu. **Ưu tiên Gemini, TỰ ĐỘNG fallback sang Groq khi Gemini
hết quota** — xem mục lịch sử #8 và mục 2 (kiến trúc hiện tại) bên dưới, ĐÂY LÀ THAY ĐỔI QUAN
TRỌNG NHẤT ngày 2026-08-27, đọc kỹ trước khi sửa `crm-doc-compare.ts`. **Bảng cố định thuần
regex (`CompareSection`, chỉ so WIT-TTS) đã BỊ XOÁ HOÀN TOÀN** 2026-08-26 theo yêu cầu người
dùng ("bỏ compare cũ đã tạo trước đó") — xem mục lịch sử bên dưới, KHÔNG khôi phục lại trừ khi
người dùng yêu cầu rõ ràng.

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

## 2. Kiến trúc HIỆN TẠI — HYBRID Gemini + Groq (đã triển khai, kiểm tra lại code trước khi tin 100%)

1. **`src/lib/crm-doc-compare.ts`**:
   - `extractPdfText(buffer)` — `pdfjs-dist` bản `legacy/build/pdf.js`, server-only (cần
     `serverExternalPackages: ["pdfjs-dist"]` trong `next.config.ts`, gotcha cũ về
     `require("canvas")` — xem comment trong file đó, KHÔNG xoá đoạn alias client-side đã có
     sẵn cho Notice Splitter). Dùng chung cho cả 3 loại tài liệu. **Nối các trang bằng `"\n"`**
     (`pages.join("\n")`) — ranh giới này `extractForm1040Pages()` DỰA VÀO để tách lại từng
     trang, đừng đổi ký tự nối nếu không cập nhật hàm đó theo.
   - `SelectedDocEntry = {label, text}` — 1 tài liệu CỤ THỂ người dùng đã chọn, `label` đã gồm
     sẵn năm + tên người (vd `"2025 - Sanchez, Jose E"`, xây ở client) dùng thẳng làm tiêu đề
     khối trong prompt — KHÔNG còn truyền `year` riêng (mỗi tài liệu tự mang năm của chính nó).
   - `askCompareDocs({wit: SelectedDocEntry[], taxReturn: SelectedDocEntry | null, tts:
     SelectedDocEntry | null, history, message})` — hàm DUY NHẤT route gọi, tự quyết định gọi
     Gemini hay Groq bên trong (route/UI không biết/không cần biết đang dùng provider nào):
     ```ts
     export async function askCompareDocs(params) {
       const geminiOk = isGeminiConfigured(), groqOk = isGroqConfigured();
       if (!geminiOk && !groqOk) throw new AiProviderConfigError(...);
       if (geminiOk) {
         try { return await askGemini(params); }
         catch (err) {
           if (!(err instanceof AiRateLimitError) || !groqOk) throw err;
           console.warn("[crm-doc-compare] Gemini hết quota, tự động chuyển sang Groq");
         }
       }
       return askGroq(params);
     }
     ```
     Chỉ fallback khi lỗi CHÍNH XÁC là `AiRateLimitError` (429 dai dẳng kể cả sau retry) — lỗi
     Gemini khác (400/403/500...) ném thẳng ra ngoài, KHÔNG âm thầm chuyển Groq (tránh che giấu
     lỗi thật không liên quan quota). Nếu chỉ 1 trong 2 provider có key, dùng đúng provider đó
     (không cố gọi provider thiếu key).
   - `askGemini(params)` — gửi NGUYÊN VĂN đầy đủ mọi tài liệu (không rút gọn) vì Gemini xử lý
     tài liệu dài tốt. Dùng `@google/genai` (`GoogleGenAI` client, đọc `GEMINI_API_KEY`) —
     `ai.models.generateContent({model: "gemini-3.6-flash", contents, config: {systemInstruction,
     responseMimeType: "application/json", responseSchema}})` — **structured output**
     (`responseSchema` = `Type.ARRAY` of `Type.OBJECT{category, wit, taxReturn, tts, note}`).
     `contents` là mảng `{role: "user"|"model", parts: [{text}]}` — SDK dùng `"model"` cho lượt
     AI (KHÁC Groq/OpenAI-style dùng `"assistant"`).
   - `askGroq(params)` — DỰ PHÒNG, chỉ chạy khi Gemini hết quota. **Rút gọn riêng field
     `taxReturn.text`** qua `extractForm1040Pages()` trước khi gửi (WIT/TTS gửi nguyên văn, vốn
     đã nhỏ) — Groq free tier giới hạn token/request thấp hơn nhiều so với Gemini (xem mục lịch
     sử #8b). Dùng `groq-sdk` (`Groq` client, đọc `GROQ_API_KEY`), model **`openai/gpt-oss-120b`**
     (model DUY NHẤT cùng `gpt-oss-20b` hỗ trợ `response_format: {type:"json_schema",
     json_schema:{strict:true, schema}}` — "strict" đảm bảo JSON đúng schema tuyệt đối). Root
     schema PHẢI là `type:"object"` (không phải mảng trần như Gemini) — bọc mảng rows trong
     field `rows: {"rows":[...]}`, `additionalProperties:false` bắt buộc cho strict mode. Messages
     dùng role `"assistant"` cho lượt AI (chuẩn OpenAI-style, KHÔNG cần tự map như Gemini).
   - `extractForm1040Pages(fullText)`/`isForm1040Page(pageText)` — tách `fullText` lại thành
     từng trang qua `split("\n")` (khớp ranh giới `extractPdfText` đã nối), giữ lại CHỈ trang
     khớp: trang 1 (chứa cụm `"U.S. Individual Income Tax Return"` gần đầu trang) hoặc trang 2
     tiếp theo (bắt đầu `"Form 1040 (năm) Page 2"`) — loại trừ mọi trang bắt đầu bằng
     `"SCHEDULE"` hoặc `"Form {số khác 1040}"` (dù trang đó CÓ nhắc "Form 1040" ở đâu đó, vd
     "SCHEDULE 1 ... (Form 1040)" — chỉ trang có "Form 1040" LÀ TIÊU ĐỀ CHÍNH CỦA CHÍNH NÓ mới
     được giữ). Không khớp trang nào → fallback lấy 2 "trang" ĐẦU (an toàn hơn gửi rỗng, dù có
     thể không đúng thật là Form 1040 nếu PDF đổi cấu trúc hoàn toàn khác).
   - `parseRowsFromJsonText(text)` — dùng CHUNG cho cả 2 nhánh, chấp nhận CẢ 2 hình dạng JSON
     (Gemini trả mảng trần `[...]`, Groq trả `{"rows":[...]}`) — `Array.isArray(parsed) ?
     parsed : parsed?.rows`.
   - `isGeminiConfigured()`/`isGroqConfigured()`/`AiProviderConfigError` — thiếu CẢ HAI
     `GEMINI_API_KEY`/`GROQ_API_KEY` thì route tự trả 501 rõ ràng ("Chưa cấu hình
     GEMINI_API_KEY/GROQ_API_KEY"), không crash app. Có ít nhất 1 trong 2 là chạy được.
   - `withAiRetry()`/`AiRateLimitError` (`src/lib/ai-retry.ts`, đổi tên từ `withGeminiRetry`/
     `GeminiRateLimitError` trong `gemini-retry.ts` cũ — giờ TRUNG LẬP theo provider, chỉ cần
     lỗi có `status === 429`) — dùng CHUNG cho cả `askGemini`/`askGroq`, tự retry tối đa 2 lần
     (1.5s rồi 3s) trước khi ném `AiRateLimitError` — đây chính là tín hiệu `askCompareDocs()`
     dùng để quyết định có fallback Groq hay không.
2. **Route `POST /api/agentc3-import/compare-tts-wit-chat`** — nhận `{caseId, tts?: {url,label},
   taxReturn?: {url,label}, wit?: {url,label}[], message, history}` — client gửi THẲNG URL +
   label của từng file ĐÃ CHỌN (route KHÔNG tự tra `fetchTtsWitDatesByYear` nữa, KHÁC route
   `check-latest-tts` — route này chỉ tải/trích/gọi `askCompareDocs()` theo đúng URL nhận được,
   KHÔNG biết/không cần biết cuối cùng dùng Gemini hay Groq).
   `fetchAgentC3FileBytes()` tự validate URL thuộc domain CRM (chặn SSRF) — không cần thêm lớp
   kiểm tra nào khác vì `canViewCase` đã gate quyền xem hồ sơ, và session CRM vốn dùng chung 1
   tài khoản công ty (không phải ranh giới riêng tư giữa các case). `wit` giới hạn `.slice(0,2)`
   (tối đa 2 file). **Validate 400** nếu số loại tài liệu có chọn (đếm `tts`/`taxReturn`/
   `wit.length>0` — mỗi loại tính 1, không tính số file) < 2 — thông báo "Chọn ít nhất 2 loại
   tài liệu (TTS/WIT/1040) để so sánh". `history` giữ tối đa 6 tin gần nhất — không lưu DB. Bắt
   `AiProviderConfigError` (501, thay `GeminiConfigError`/`GroqConfigError` cũ) và
   `AiRateLimitError` (429, thay `GeminiRateLimitError` cũ — giờ CÓ THỂ đến từ Groq nếu CẢ 2
   provider cùng hết quota, không chỉ Gemini).
3. **UI** (`CompareChatSection` trong `crm-tts-wit-check-button.tsx`, ĐẶT Ở ĐẦU popup — trước
   `<div className="mt-4 grid grid-cols-2 ...">` chứa `DocGroup` TTS/WIT) — **3 trường chọn tài
   liệu** (`buildDocOptions()` duyệt CẢ 3 năm 2023-2025, gộp thành 1 danh sách phẳng
   `{url, label}[]`, label = `"{năm} - {tên người hoặc ngày}"`):
   - TTS: `<select>` đơn (1 file).
   - WIT: dropdown dạng `<details>` CHỈ MỞ KHI BẤM (không hiện sẵn), tick tối đa 2
     (`toggleWit()` tự khoá checkbox thứ 3 trở đi khi đã chọn đủ 2, không cảnh báo — chỉ
     disable).
   - 1040: `<select>` đơn (1 file).
   Nút Gửi/input chỉ bật khi `selectedTypeCount >= 2` (đếm SỐ LOẠI đã chọn ≥1 file, không phải
   tổng số file). Gõ trống rồi bấm Gửi → dùng `t("crmCompareChat.defaultMessage")` làm câu hỏi
   mặc định ("So sánh các tài liệu đã chọn, liệt kê chênh lệch chi tiết."). State UI dùng type
   `ChatEntry` riêng (KHÁC `CompareChatMessage` dây API) — tin user giữ `text` thô, tin assistant
   giữ SẴN `rows: AiCompareRow[]` + `columns` (cột nào đã chọn lúc hỏi) đã parse — bảng kết quả
   ĐẦY ĐỦ chỉ hiện ở popup "Kết quả phân tích AI" RIÊNG cạnh popup chính (khung chat trong popup
   "Doc CRM" giờ CHỈ hiện lại câu đã hỏi, không lặp lại bảng — xem mục 7 lịch sử quyết định).

**Biến môi trường**: cần ÍT NHẤT 1 trong 2, khuyến khích có CẢ HAI để hybrid hoạt động đúng
thiết kế:
- `GEMINI_API_KEY` — lấy tại `aistudio.google.com/apikey`, KHÔNG cần thẻ tín dụng cho free tier
  (định dạng key thật dạng `AQ.xxxxx...`, KHÔNG phải `AIzaSy...` như bản cũ hơn). Model đang
  dùng: **`gemini-3.6-flash`** — KHÔNG PHẢI `gemini-2.5-flash` (đã thử, API trả lỗi 404 thật:
  *"This model models/gemini-2.5-flash is no longer available to new users"*). **Free tier chỉ
  20 request/NGÀY, tính theo Google Cloud Project** (xem mục lịch sử #8a) — đây là lý do CẦN có
  Groq làm dự phòng, không phải lỗi cấu hình.
- `GROQ_API_KEY` — lấy tại `console.groq.com`, cũng không cần thẻ tín dụng. Model đang dùng:
  **`openai/gpt-oss-120b`** (xem lý do chọn ở mục kiến trúc phía trên) — free tier giới hạn
  ~8.000 token/phút/request (xem mục lịch sử #8b), đây là lý do CẦN rút gọn "1040 Tax Return"
  trước khi gửi Groq.

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

5. **(2026-08-27) UI thêm badge báo AI nào vừa trả lời** — theo yêu cầu "show đang sử dụng AI
   nào" (trước đó chỉ đoán được qua log Vercel, xem dòng `console.warn` trong `askCompareDocs`).
   `askCompareDocs()` giờ trả `{rows, provider: "gemini" | "groq"}` (kiểu `AskCompareResult`)
   thay vì mảng trần — xuyên suốt route → `api-client.ts` → `app-store.ts` →
   `crm-tts-wit-check-button.tsx` đều thêm field `provider`. UI hiện badge nhỏ (xanh dương
   "Gemini" / cam "Groq") cạnh tiêu đề popup "Kết quả phân tích AI" (`AiProviderBadge`, đặt cạnh
   `crmCompareChat.analysisTitle`). Đã verify trực tiếp qua `askCompareDocs()` (script tạm, key
   Gemini còn quota) — trả đúng `provider: "gemini"`. Không verify được nhánh `"groq"` qua code
   thật (cần Gemini hết quota thật để trigger fallback) — chỉ verify bằng đọc code (`askGroq()`
   luôn được gọi kèm `provider: "groq"` ở đúng 1 nơi trong `askCompareDocs`, không có đường nào
   khác gán sai). Nếu 1 hồ sơ đang chọn 2/3 loại tài liệu mà thấy badge "Groq", nghĩa là Gemini
   đã hết 20 request/ngày hôm đó (dấu hiệu duy nhất người dùng cần để biết, không cần hỏi lại
   log Vercel nữa).

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

## 4. Giới hạn đã biết

- Không có OCR/fallback nếu CRM đổi định dạng PDF hoàn toàn khác — Gemini vẫn đọc được text lộn
  xộn ở mức độ nhất định (khác hẳn regex cứng đã xoá), nhưng vẫn phụ thuộc `extractPdfText` trả
  về text có nghĩa (PDF phải là dạng text thật, không phải ảnh scan — đã xác nhận đúng cho cả 3
  loại tài liệu CRM này).
- Nếu 1 năm có NHIỀU bản "1040 Tax Return"/TTS (hiếm, nhưng có thể xảy ra nếu khách sửa/nộp lại)
  route chỉ lấy bản `[0]` (mới nhất theo `fetchTtsWitDatesByYear`, đã sắp mới-nhất-trước) — WIT
  thì lấy TẤT CẢ (khử trùng theo người) vì WIT vốn nhiều người (Taxpayer+Spouse) là bình thường.
- **Free tier Gemini chỉ 20 request/NGÀY (không phải chỉ giới hạn phút) — ĐÃ GẶP THẬT trên
  production (2026-08-27), đã giải quyết bằng kiến trúc hybrid** — xem mục lịch sử #8 và mục 2
  (kiến trúc hiện tại) ở trên cho lời giải đầy đủ. Tóm tắt: `withAiRetry()` (`ai-retry.ts`, đổi
  tên từ `withGeminiRetry`/`gemini-retry.ts`) xử lý rate-limit NGẮN HẠN (RPM, retry 1.5s/3s);
  khi hết quota NGÀY thật sự (429 dai dẳng), `askCompareDocs()` TỰ ĐỘNG chuyển sang Groq thay vì
  chỉ báo lỗi cho người dùng — không còn cảnh "chờ 1 phút vẫn lỗi" như trước. Tính năng "Trợ lý
  AI" (chat tự do, KHÔNG liên quan compare) đã xoá hẳn ở bước trung gian (xem mục "[ĐÃ XOÁ
  2026-08-27]" đầu file) để giảm tải quota Gemini trước khi quyết định hybrid — quyết định đó
  VẪN ĐÚNG, không cần khôi phục lại chỉ vì giờ đã có Groq dự phòng (2 vấn đề độc lập: tính năng
  "Trợ lý AI" bị xoá vì KHÔNG CẦN THIẾT/tốn quota vô ích, không phải vì kỹ thuật không giải
  quyết được).
