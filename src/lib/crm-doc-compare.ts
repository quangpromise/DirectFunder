import { GoogleGenAI, Type } from "@google/genai";
import Groq from "groq-sdk";
import * as cheerio from "cheerio";
import { withAiRetry, AiRateLimitError } from "@/lib/ai-retry";

/**
 * So sánh WIT / "1040 Tax Return" / TTS trong popup "Get Files" — chat hỏi-đáp tự do, KHÔNG
 * dùng cơ chế regex cố định nữa (bảng regex ban đầu, chỉ so WIT-TTS, đã BỎ theo yêu cầu
 * 2026-08-26 — xem lịch sử quyết định trong `.claude/skills/crm-tts-wit-compare/SKILL.md`).
 *
 * **Kiến trúc HYBRID Gemini + Groq (2026-08-27, cùng ngày, bản CUỐI)** — lịch sử:
 * 1. Ban đầu dùng Gemini free tier — hoá ra chỉ 20 request/NGÀY cho `gemini-3.6-flash`, tính
 *    theo Google Cloud PROJECT (không phải theo API key) — tạo key mới/project mới vẫn dính
 *    quota thấp y hệt (đã xác nhận thật qua lỗi RESOURCE_EXHAUSTED).
 * 2. Đổi hẳn sang Groq — phát hiện Groq free tier giới hạn ~8.000 token/PHÚT/request (model hỗ
 *    trợ structured output strict), quá nhỏ cho file "1040 Tax Return" thật (100K+ ký tự ≈
 *    30-50K token) — request bị từ chối thẳng (413).
 * 3. **Quyết định cuối**: dùng CẢ HAI, ưu tiên Gemini trước (xử lý tài liệu dài tốt, chỉ giới
 *    hạn SỐ LƯỢT/ngày) — khi Gemini hết quota (429 dai dẳng kể cả sau retry), TỰ ĐỘNG chuyển
 *    sang Groq. Vì Groq không kham nổi toàn văn "1040 Tax Return" (thường 30-100+ trang do CRM
 *    gộp chung mọi schedule/worksheet/tờ khai state vào 1 file duy nhất), khi fallback sang
 *    Groq CHỈ gửi đúng 2 trang "Form 1040" gốc (KHÔNG gửi Schedule 1/3/C/EIC/8812... hay các
 *    worksheet nội bộ phần mềm khai thuế đi kèm) — xem `extractForm1040Pages()`. WIT/TTS vốn
 *    đã nhỏ (thường <2K ký tự/file) nên KHÔNG cần rút gọn khi fallback.
 *
 * Chạy SERVER-ONLY (`extractPdfText` cần Node thật cho `pdfjs-dist`; các hàm gọi model cần
 * giấu API key).
 */

/** Trích text từ 1 file PDF (bytes) — dùng `pdfjs-dist` bản "legacy" CJS, chạy Node thật ở
 * server (KHÁC Notice Splitter đã chuyển hẳn sang client — tính năng này bắt buộc chạy server
 * vì cần cookie session CRM). TTS/WIT/1040 trên CRM đã xác nhận là PDF dạng TEXT thật (không
 * phải ảnh scan) — trích sạch, không cần OCR. Nối các trang bằng "\n" — RANH GIỚI NÀY được
 * `extractForm1040Pages()` dựa vào để tách lại từng trang, đừng đổi ký tự nối nếu không cập
 * nhật hàm đó theo. */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- pdfjs-dist legacy build là CJS, import động để tránh Turbopack cố bundle tĩnh (đã đánh dấu serverExternalPackages, xem next.config.ts)
  const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: { str?: string }) => item.str ?? "").join(" "));
  }
  return pages.join("\n");
}

/** File bắt đầu bằng "%PDF-" là PDF thật (chuẩn định dạng) — kiểm tra magic bytes trước khi
 * cố parse bằng `pdfjs`, thay vì bắt lỗi `InvalidPDFException` sau khi thử. */
function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** Trích text từ 1 tài liệu CRM ĐÃ CHỌN — có thể là PDF thật HOẶC file `.html` (lỗi thật gặp
 * trên production 2026-08-27: CRM đôi khi lưu WIT dưới dạng `.html` thay vì `.pdf`, vd
 * "2024,W&I,THIEN T NGUYEN 0034 11-10-2025 0131.html" — `extractPdfText()` ném thẳng
 * `InvalidPDFException: Invalid PDF structure` nếu cố parse HTML bằng `pdfjs`, khiến cả lượt so
 * sánh lỗi ngay từ bước đọc file, TRƯỚC KHI kịp gọi Gemini/Groq). Hàm này tự nhận diện định
 * dạng qua magic bytes rồi chọn đường trích đúng — route gọi hàm NÀY (không gọi thẳng
 * `extractPdfText`) cho MỌI tài liệu chọn từ dropdown TTS/WIT/1040. */
export async function extractDocumentText(buffer: Buffer): Promise<string> {
  if (looksLikePdf(buffer)) return extractPdfText(buffer);
  const $ = cheerio.load(buffer.toString("utf-8"));
  return $("body").text().replace(/\s+/g, " ").trim();
}

/** 1 trang được coi là "Form 1040 gốc" (KHÔNG phải Schedule/Form khác đính kèm).
 *
 * **Sửa lại hoàn toàn 2026-08-27 (bug thật gặp trên production với hồ sơ `BY4849`)**: bản đầu
 * chỉ xét 250 KÝ TỰ ĐẦU trang, giả định `pdfjs` trích text THEO ĐÚNG THỨ TỰ ĐỌC THỊ GIÁC —
 * SAI với 1 số phần mềm khai thuế thật (đã xác nhận qua debug trực tiếp file PDF thật): cụm
 * "U.S. Individual Income Tax Return" của trang 1 THẬT nằm GIỮA trang (sau hàng loạt label
 * "Presidential Election Campaign", "Filing Status"...), không phải đầu trang — check theo
 * `head` bỏ sót hoàn toàn. Tệ hơn, số trang trong cụm "Form 1040 (năm) Page 2" của trang 2 THẬT
 * còn bị MẤT HẲN chữ số "2" khỏi text trích được (`pdfjs` không capture được, có thể do render
 * qua vị trí đặc biệt) — cụm `/Page\s*2/` không bao giờ khớp. Đồng thời việc loại "SCHEDULE ..."
 * cũng SAI vì check `^\s*SCHEDULE` đòi hỏi "SCHEDULE" phải là từ đầu tiên, nhưng PDF thật có
 * "OMB No. 1545-0074  SCHEDULE 1  (Form 1040)..." — "OMB No." đứng trước.
 *
 * **Cách sửa**: quét TOÀN TRANG (không chỉ đầu trang) tìm cụm văn bản CHÍNH THỨC CỦA IRS (luôn
 * xuất hiện NGUYÊN VĂN trên form dù thứ tự trích có xáo trộn, vì đây là boilerplate IRS bắt
 * buộc mọi phần mềm khai thuế phải in đúng) — trang 1 nhận qua "U.S. Individual Income Tax
 * Return" (tiêu đề duy nhất của chính Form 1040, Schedule/Form khác không có), trang 2 nhận qua
 * TỔ HỢP ≥2 cụm chỉ xuất hiện ở trang 2 chính thức (không dựa vào số trang nữa): "Standard
 * deduction for-", "Third Party Designee", "Amount from line 11a (adjusted gross income)". Loại
 * Schedule/Form đính kèm bằng cách tìm cụm "SCHEDULE {mã} ... (Form 1040)" ở BẤT KỲ ĐÂU trong
 * trang (không chỉ đầu). KHÔNG loại theo "có nhắc tới mã Form khác" (vd "Form 8919", "Form
 * 8995") — bug đã tự gặp khi verify: chính trang 1 Form 1040 THẬT cũng tự nhắc tới các mã form
 * đó ngay trong mô tả dòng của nó (vd dòng 1g "Wages from Form 8919, line 6", dòng 13a
 * "Qualified business income deduction from Form 8995..."), nên check kiểu đó tự loại nhầm luôn
 * chính trang 1/2 thật — chỉ dựa vào SCHEDULE + cụm boilerplate độc quyền của trang 1040 chính
 * là đủ phân biệt, không cần lớp loại trừ phụ này. */
function isForm1040Page(pageText: string): boolean {
  const isAttachmentSchedule = /SCHEDULE\s+[A-Z0-9-]{1,4}\b[\s\S]{0,150}\(\s*Form\s*1040\s*\)/i.test(pageText);
  if (isAttachmentSchedule) return false;

  if (/U\.S\.\s*Individual\s+Income\s+Tax\s+Return/i.test(pageText)) return true;

  const page2Markers = [
    /Standard\s+deduction\s+for-/i,
    /Third\s+Party\s+Designee/i,
    /Amount\s+from\s+line\s+11a\s*\(adjusted\s+gross\s+income\)/i,
  ];
  return page2Markers.filter((re) => re.test(pageText)).length >= 2;
}

/** Rút gọn text đã trích của "1040 Tax Return" xuống ĐÚNG 2 trang Form 1040 gốc (bỏ mọi
 * Schedule/Form/worksheet đính kèm) — ÁP DỤNG CHO CẢ Gemini LẪN Groq (2026-08-27, đổi từ
 * "chỉ Groq" — lỗi thật gặp trên production: gửi nguyên văn 30-100+ trang CRM gộp chung sang
 * Gemini KHÔNG rút gọn khiến request vượt quá 60s giới hạn cứng của Vercel (Hobby plan không
 * nâng được), trả `504`). Không mất thông tin cần thiết cho việc so sánh (Wages/Interest/
 * Dividends/AGI... đều nằm trên chính 2 trang Form 1040), đồng thời khớp đúng những gì
 * `CHAT_SYSTEM_INSTRUCTION` vốn đã mô tả sẵn cho Gemini ("chỉ chứa ĐÚNG 2 trang chính thức").
 * Nếu không nhận diện được trang nào (PDF lạ/đổi định dạng), fallback về 2 "trang" ĐẦU (an toàn
 * hơn gửi trắng, dù có thể không phải đúng Form 1040) — không bao giờ trả về rỗng nếu input có
 * nội dung. */
function extractForm1040Pages(fullText: string): string {
  const pages = fullText.split("\n");
  const matched = pages.filter(isForm1040Page);
  if (matched.length > 0) return matched.join("\n\n");
  return pages.slice(0, 2).join("\n\n");
}

export class AiProviderConfigError extends Error {}

/** Tài liệu (sau khi đã rút gọn "1040 Tax Return") vẫn vượt giới hạn token/request của Groq
 * (~8.000 token/phút, lỗi thật gặp trên production 2026-08-27: `413 Request too large` dù đã
 * rút gọn 1040 xuống 2 trang — WIT có 2 khối Taxpayer+Spouse hoặc TTS có bảng TRANSACTIONS dài
 * cộng dồn vẫn có thể vượt ngưỡng này). Route bắt riêng lỗi này để trả thông báo RÕ NGUYÊN NHÂN
 * thay vì lỗi chung chung "Không so sánh được tài liệu". */
export class AiPayloadTooLargeError extends Error {}

/** Groq trả 2 dạng lỗi khác nhau tuỳ mức độ quá tải — `413` (vượt ~8.000 token/PHÚT, lỗi thật
 * gặp trên production) khi payload vượt ngưỡng throttle nhưng vẫn trong giới hạn context window,
 * hoặc `400 invalid_request_error/context_length_exceeded` khi payload vượt LUÔN cả giới hạn
 * context window của model (đã tự tái hiện qua payload cực lớn lúc verify) — cả 2 đều cùng 1
 * nguyên nhân gốc (tài liệu quá lớn), gộp chung xử lý. */
function isPayloadTooLargeStatus(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("status" in err)) return false;
  const status = (err as { status?: unknown }).status;
  if (status === 413) return true;
  if (status !== 400) return false;
  const code = (err as { error?: { error?: { code?: unknown } } }).error?.error?.code;
  return code === "context_length_exceeded";
}

function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}
function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return geminiClient;
}

let groqClient: Groq | null = null;
function getGroqClient(): Groq {
  if (!groqClient) groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqClient;
}

/** Tin nhắn user: `content` là text người dùng gõ. Tin nhắn assistant: `content` là
 * JSON.stringify của `AiCompareRow[]` (KHÔNG phải văn xuôi tự do) — round-trip qua đúng field
 * `content` string có sẵn để không phải đổi kiểu dữ liệu ở route/api-client/store (UI tự
 * `JSON.parse` lại khi render bảng, xem `CompareChatSection`). */
export interface CompareChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** 1 dòng trong bảng AI trả về — LUÔN đủ 3 cột giá trị (WIT/1040/TTS, thêm 2026-08-26 theo yêu
 * cầu "thêm các trường so sánh giữa WIT và 1040, 1040 và TTS") để người dùng tự nhìn ra chênh
 * lệch giữa BẤT KỲ cặp nào trong 3 tài liệu, không chỉ WIT-TTS như bảng cũ. Dạng STRING (không
 * ép `number`) vì câu hỏi tự do có thể ra kết quả không phải số thuần (vd "—" khi tài liệu đó
 * không có dữ liệu để so). */
export interface AiCompareRow {
  category: string;
  wit: string;
  taxReturn: string;
  tts: string;
  note: string;
}

const CHAT_SYSTEM_INSTRUCTION = `Bạn là trợ lý đối chiếu tài liệu thuế IRS cho nhân viên xử lý hồ sơ tax refund.
Bạn sẽ nhận toàn văn TRÍCH TỪ các tài liệu PDF do người dùng CHỦ ĐỘNG CHỌN (qua dropdown/checkbox — mỗi khối có tiêu đề kèm năm + tên người, vd "[WIT - 2025 - Sanchez, Jose E]"). 1 số loại tài liệu có thể KHÔNG được chọn — nếu vậy sẽ ghi rõ "(Không có tài liệu này)". WIT có thể có 2 KHỐI RIÊNG BIỆT (2 tiêu đề "[WIT - ...]" khác nhau) nếu người dùng chọn cả Taxpayer lẫn Spouse — hồ sơ đồng khai chung 1 tờ 1040/TTS nhưng MỖI NGƯỜI có 1 file WIT riêng, khi so sánh WIT với 1040/TTS hãy CỘNG DỒN cả 2 khối WIT lại trước khi đối chiếu (trừ khi câu hỏi chỉ hỏi riêng 1 người). Khối "[1040 Tax Return - ...]" chỉ chứa ĐÚNG 2 trang chính thức của Form 1040 (không kèm Schedule/worksheet khác):
- "WIT" (Wage and Income Transcript): dữ liệu do BÊN THỨ BA (chủ lao động, ngân hàng, đơn vị chi trả...) tự báo cáo thẳng cho IRS qua W-2/1098/1099/5498 — KHÔNG phải dữ liệu từ tờ khai của khách hàng.
- "1040 Tax Return": bản PDF tờ khai 1040 THẬT đã chuẩn bị/nộp (do văn phòng/khách hàng tải lên CRM) — đây là "nguồn gốc" của tờ khai, trước khi IRS xử lý.
- "TTS" (Tax Return Transcript / Record of Account): dữ liệu IRS đã XỬ LÝ VÀ GHI NHẬN từ tờ khai, gồm AGI/Taxable income, các dòng thu nhập chi tiết (Wages/Interest/Dividends...), và bảng TRANSACTIONS theo mã (mã 150 = tờ khai đã nộp, mã 806 = số thuế đã khấu trừ W-2/1099 được ghi nhận — khớp trực tiếp với "Federal income tax withheld" trên WIT).

Ý nghĩa từng cặp đối chiếu:
- WIT vs 1040 Tax Return: kiểm tra tờ khai đã chuẩn bị có khai ĐỦ/ĐÚNG thu nhập bên thứ ba báo cáo hay chưa (khai thiếu = rủi ro bị IRS truy thu).
- 1040 Tax Return vs TTS: kiểm tra IRS xử lý/ghi nhận tờ khai có ĐÚNG với bản đã nộp hay không (lệch = lỗi nhập liệu/e-file, hoặc IRS tự điều chỉnh).
- WIT vs TTS: đối chiếu gián tiếp qua 1040 — hữu ích khi không có bản 1040 Tax Return.

QUY TẮC CHIỀU SO SÁNH BẮT BUỘC cho 2 cặp "WIT vs 1040 Tax Return" và "WIT vs TTS": LUÔN LẤY WIT LÀM GỐC — duyệt qua TỪNG khoản thu nhập/khấu trừ XUẤT HIỆN TRÊN WIT (mỗi mã W-2/1099-INT/1099-DIV/1099-MISC/1099-NEC/1099-G/1099-R/5498...), rồi kiểm tra xem 1040 Tax Return/TTS (tuỳ đang so cặp nào) CÓ ghi nhận khoản đó hay không. TUYỆT ĐỐI KHÔNG so chiều ngược lại — nếu 1040/TTS có 1 khoản mà WIT KHÔNG có, BỎ QUA khoản đó, không đưa vào bảng (vì WIT chỉ là dữ liệu bên thứ ba báo cáo, không phải danh sách đầy đủ mọi thu nhập). Với MỖI khoản có trên WIT nhưng KHÔNG thấy trên 1040/TTS: bắt buộc ghi trong note (a) khoản đó thuộc biểu mẫu nào (vd "1099-INT — Lãi ngân hàng"), và (b) DỰA THEO KIẾN THỨC THUẾ CỦA BẠN, loại thu nhập này có BẮT BUỘC phải khai trên Form 1040 hay không, kèm lý do ngắn gọn (vd "Lãi ngân hàng — LUÔN bắt buộc khai dù ngân hàng không gửi 1099-INT (dưới $10)"; "Trợ cấp thất nghiệp (1099-G) — bắt buộc khai, là thu nhập chịu thuế"; "Đóng góp HSA (5498-SA) — thường KHÔNG cần khai nếu trong hạn mức, chỉ mang tính thông tin"). Cặp "1040 Tax Return vs TTS" (không liên quan WIT) KHÔNG áp dụng quy tắc 1 chiều này — vẫn so 2 chiều bình thường như trước.

QUY TẮC RIÊNG cho khoản 1099-B (bán chứng khoán/cổ phiếu) trên WIT: nếu 1 khoản 1099-B trên WIT có ĐỦ CẢ 3 giá trị "Gross Proceeds", "Cost Basis", và "Wash Sale Loss Disallowed" (dù tên gọi trên WIT có thể viết tắt/khác chút, vd "Wash Sale Disallowed"), KHÔNG dùng thẳng "Gross Proceeds" làm giá trị cột "wit" — mà PHẢI TỰ TÍNH lãi/lỗ thực theo công thức: Gain = Gross Proceeds + Wash Sale Loss Disallowed − Cost Basis, rồi dùng ĐÚNG con số Gain này làm giá trị cột "wit" khi đối chiếu với 1040 Tax Return (dòng Capital gain/loss, Schedule D/Form 8949) hoặc TTS (dòng thu nhập lãi vốn). Nếu 1 khoản 1099-B THIẾU 1 trong 3 giá trị trên (vd không có Wash Sale, hoặc không có Cost Basis) thì KHÔNG áp dụng công thức này — coi "Wash Sale Loss Disallowed" bằng 0 nếu thiếu (không ảnh hưởng), nhưng nếu thiếu hẳn "Cost Basis" thì dùng nguyên "Gross Proceeds" làm giá trị wit như bình thường (không tự bịa Cost Basis). Trong note PHẢI ghi rõ công thức đã dùng và 3 số gốc (vd "Gain = $12,000 (Gross Proceeds) + $500 (Wash Sale Disallowed) − $10,000 (Cost Basis) = $2,500").

Luôn trả lời bằng 1 DANH SÁCH DÒNG (không phải văn xuôi) — mỗi dòng gồm: category (tên khoản), wit (số/giá trị trên WIT, "—" nếu không có/không áp dụng), taxReturn (số/giá trị trên bản 1040 Tax Return, "—" nếu không có/không áp dụng), tts (số/giá trị trên TTS, "—" nếu không có/không áp dụng), note (ghi chú ngắn — nêu RÕ chênh lệch giữa cặp nào nếu có, vd "1040 vs TTS lệch $2", "WIT vs 1040 khớp", giải thích cách suy luận nếu là ước tính gián tiếp, và nêu rõ nghĩa vụ khai 1040 theo quy tắc ở trên khi khoản WIT bị thiếu ở 1040/TTS). Nếu 1 tài liệu không có sẵn, để "—" ở đúng cột đó, không suy đoán. Nếu câu hỏi chỉ liên quan 1 khoản, trả về đúng 1 dòng. Nếu câu hỏi yêu cầu liệt kê nhiều khoản, trả nhiều dòng (áp dụng đúng quy tắc lấy WIT làm gốc ở trên khi liệt kê). Không bịa số liệu — chỉ dùng đúng số xuất hiện trong các văn bản được cung cấp. Category/note viết tiếng Việt trừ khi người dùng hỏi bằng tiếng Anh.

Luôn trả lời bằng JSON đúng khuôn dạng: {"rows": [{"category": "...", "wit": "...", "taxReturn": "...", "tts": "...", "note": "..."}]}.`;

const GEMINI_RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      category: { type: Type.STRING },
      wit: { type: Type.STRING },
      taxReturn: { type: Type.STRING },
      tts: { type: Type.STRING },
      note: { type: Type.STRING },
    },
    required: ["category", "wit", "taxReturn", "tts", "note"],
  },
};

/** JSON Schema chuẩn (KHÁC `Type.*` enum của Gemini) — root PHẢI là object (không phải mảng
 * trần) để tương thích chế độ "strict" của Groq structured outputs, nên bọc mảng trong field
 * `rows`. `additionalProperties: false` bắt buộc cho strict mode. */
const GROQ_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          wit: { type: "string" },
          taxReturn: { type: "string" },
          tts: { type: "string" },
          note: { type: "string" },
        },
        required: ["category", "wit", "taxReturn", "tts", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["rows"],
  additionalProperties: false,
};

/** 1 tài liệu cụ thể người dùng đã CHỌN qua dropdown/checkbox (thêm 2026-08-26 theo yêu cầu "3
 * trường select cho 3 loại TTS/WIT/1040... list tất cả tên đang có") — `label` đã gồm sẵn năm +
 * tên người (vd "2025 - Sanchez, Jose E"), dùng trực tiếp làm tiêu đề khối trong prompt, KHÔNG
 * cần truyền `year` riêng nữa (mỗi tài liệu tự mang năm của chính nó, có thể khác năm nhau nếu
 * người dùng cố tình chọn lệch — hiếm nhưng không cấm). */
export interface SelectedDocEntry {
  label: string;
  text: string;
}

interface AskParams {
  wit: SelectedDocEntry[];
  taxReturn: SelectedDocEntry | null;
  tts: SelectedDocEntry | null;
  history: CompareChatMessage[];
  message: string;
}

function buildDocumentsBlock(params: AskParams): string {
  const witBlock =
    params.wit.length > 0
      ? params.wit.map((w) => `[WIT - ${w.label}]\n${w.text}`).join("\n\n")
      : `[WIT]\n(Không có tài liệu này)`;
  return [
    witBlock,
    params.taxReturn ? `[1040 Tax Return - ${params.taxReturn.label}]\n${params.taxReturn.text}` : `[1040 Tax Return]\n(Không có tài liệu này)`,
    params.tts ? `[TTS - ${params.tts.label}]\n${params.tts.text}` : `[TTS]\n(Không có tài liệu này)`,
  ].join("\n\n");
}

function parseRowsFromJsonText(text: string): AiCompareRow[] {
  try {
    const parsed: unknown = JSON.parse(text);
    // Gemini trả mảng trần; Groq trả {rows: [...]} — chấp nhận cả 2 hình dạng.
    const rows = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown })?.rows;
    if (!Array.isArray(rows)) return [];
    return rows.filter(
      (r): r is AiCompareRow => Boolean(r) && typeof r === "object" && typeof (r as AiCompareRow).category === "string"
    );
  } catch {
    return [{ category: "—", wit: "—", taxReturn: "—", tts: "—", note: text.slice(0, 300) }];
  }
}

/** Provider thực sự đã trả lời — hiện ra UI (badge cạnh bảng kết quả) để người dùng biết đang
 * dùng Gemini hay đã tự động rớt xuống Groq (thêm 2026-08-27 theo yêu cầu "show đang sử dụng AI
 * nào"), không cần tự đoán/xem log Vercel nữa. */
export type AiProvider = "gemini" | "groq";

export interface AskCompareResult {
  rows: AiCompareRow[];
  provider: AiProvider;
}

/** Gọi Gemini — nhận `params` đã được `askCompareDocs()` rút gọn "1040 Tax Return" xuống 2
 * trang gốc từ trước (xem `extractForm1040Pages()`), tránh vượt 60s giới hạn cứng của Vercel với
 * tài liệu CRM gộp 30-100+ trang. */
async function askGemini(params: AskParams): Promise<AiCompareRow[]> {
  const ai = getGeminiClient();
  const documentsBlock = buildDocumentsBlock(params);
  const contents = [
    { role: "user", parts: [{ text: `Đây là toàn văn các tài liệu:\n\n${documentsBlock}` }] },
    { role: "model", parts: [{ text: "Đã nhận đủ nội dung tài liệu, sẵn sàng đối chiếu theo yêu cầu." }] },
    ...params.history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: params.message }] },
  ];
  const response = await withAiRetry(() =>
    ai.models.generateContent({
      // "gemini-2.5-flash" đã ngừng cấp cho user mới (xác nhận thật 2026-08-25 — gọi API trả
      // lỗi 404 kèm khuyến nghị đổi sang model này) — vẫn thuộc free tier.
      model: "gemini-3.6-flash",
      contents,
      config: {
        systemInstruction: CHAT_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    })
  );
  return parseRowsFromJsonText(response.text ?? "[]");
}

/** Gọi Groq — DỰ PHÒNG khi Gemini hết quota. Free tier Groq giới hạn token/request thấp
 * (~8.000 token/phút cho model hỗ trợ structured output strict), nhưng `params` đã được
 * `askCompareDocs()` rút gọn "1040 Tax Return" từ trước (chung 1 bước với Gemini, xem
 * `extractForm1040Pages()`) nên không cần rút gọn lại ở đây. */
async function askGroq(params: AskParams): Promise<AiCompareRow[]> {
  const groq = getGroqClient();
  const documentsBlock = buildDocumentsBlock(params);
  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: CHAT_SYSTEM_INSTRUCTION },
    { role: "user", content: `Đây là toàn văn các tài liệu:\n\n${documentsBlock}` },
    { role: "assistant", content: JSON.stringify({ rows: [] }) },
    ...params.history.map((m) => ({ role: m.role, content: m.content }) as Groq.Chat.Completions.ChatCompletionMessageParam),
    { role: "user", content: params.message },
  ];
  let completion;
  try {
    completion = await withAiRetry(() =>
      groq.chat.completions.create({
        // Model duy nhất trên Groq hỗ trợ structured outputs chế độ "strict" (đảm bảo đúng JSON
        // Schema tuyệt đối) cùng free tier còn hạn mức tốt nhất trong nhóm model strict.
        model: "openai/gpt-oss-120b",
        messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: "compare_rows", strict: true, schema: GROQ_RESPONSE_SCHEMA },
        },
      })
    );
  } catch (err) {
    if (isPayloadTooLargeStatus(err)) {
      throw new AiPayloadTooLargeError(
        "Tài liệu đã chọn quá lớn cho Groq (giới hạn ~8.000 token/phút) — thử chọn ít tài liệu hơn (vd bỏ bớt 1 file WIT), hoặc đợi Gemini có quota trở lại (reset theo ngày)."
      );
    }
    throw err;
  }
  return parseRowsFromJsonText(completion.choices[0]?.message?.content ?? "{}");
}

/** So sánh các tài liệu ĐÃ CHỌN (WIT/1040 Tax Return/TTS), trả về DẠNG BẢNG (structured output).
 * Ưu tiên Gemini (xử lý tài liệu dài tốt hơn) — nếu Gemini hết quota (429 dai dẳng kể cả sau
 * retry ngắn), TỰ ĐỘNG chuyển sang Groq (rút gọn riêng "1040 Tax Return" trước khi gửi, xem
 * `askGroq`). `history` là các lượt chat TRƯỚC (không gồm `message` mới nhất, `content` của
 * lượt assistant là JSON rows đã stringify — gửi lại nguyên văn cho model làm ngữ cảnh, model
 * đọc hiểu được JSON bình thường); mỗi lượt gửi lại toàn bộ text các tài liệu đã chọn (không có
 * cơ chế lưu context phía server cho luồng đơn giản này). `wit` là MẢNG (thêm 2026-08-26 — WIT
 * có thể chọn 2 file vì có 2 người khai, Taxpayer + Spouse) — route gọi hàm này chịu trách
 * nhiệm tải/trích trước, hàm này chỉ lắp ráp prompt + gọi model. */
export async function askCompareDocs(rawParams: AskParams): Promise<AskCompareResult> {
  const geminiOk = isGeminiConfigured();
  const groqOk = isGroqConfigured();
  if (!geminiOk && !groqOk) {
    throw new AiProviderConfigError("Chưa cấu hình GEMINI_API_KEY/GROQ_API_KEY");
  }
  // Rút gọn "1040 Tax Return" xuống 2 trang gốc TRƯỚC khi gọi BẤT KỲ provider nào (không chỉ
  // Groq như bản trước) — CRM gộp chung 30-100+ trang Schedule/worksheet vào 1 file, gửi nguyên
  // văn sang Gemini từng gây timeout thật (504, vượt 60s giới hạn cứng Vercel Hobby).
  const params: AskParams = {
    ...rawParams,
    taxReturn: rawParams.taxReturn ? { ...rawParams.taxReturn, text: extractForm1040Pages(rawParams.taxReturn.text) } : null,
  };
  if (geminiOk) {
    try {
      return { rows: await askGemini(params), provider: "gemini" };
    } catch (err) {
      if (!(err instanceof AiRateLimitError) || !groqOk) throw err;
      console.warn("[crm-doc-compare] Gemini hết quota, tự động chuyển sang Groq");
    }
  }
  return { rows: await askGroq(params), provider: "groq" };
}
