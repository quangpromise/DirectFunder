import { GoogleGenAI, Type } from "@google/genai";
import * as cheerio from "cheerio";
import { withAiRetry } from "@/lib/ai-retry";
import { logGeminiUsage } from "@/lib/gemini-usage";
import {
  summarizeCapitalGains,
  formatCapitalGainsSummaryBlock,
  summarizeOtherWitForms,
  formatOtherWitFormsBlock,
  stripAllWitRecordsFromText,
} from "@/lib/wit-income-summary";

/**
 * So sánh WIT / TTS trong popup "Get Files" — chat hỏi-đáp tự do, KHÔNG dùng cơ chế regex cố
 * định nữa (bảng regex ban đầu, chỉ so WIT-TTS, đã BỎ theo yêu cầu 2026-08-26 — xem lịch sử
 * quyết định trong `.claude/skills/crm-tts-wit-compare/SKILL.md`).
 *
 * **Kiến trúc: CHỈ Gemini, CHỈ WIT+TTS (2026-08-27, cùng ngày, bản CUỐI)** — lịch sử:
 * 1. Ban đầu dùng Gemini free tier — hoá ra chỉ 20 request/NGÀY cho `gemini-3.6-flash`, tính
 *    theo Google Cloud PROJECT (không phải theo API key) — tạo key mới/project mới vẫn dính
 *    quota thấp y hệt (đã xác nhận thật qua lỗi RESOURCE_EXHAUSTED).
 * 2. Đổi hẳn sang Groq — phát hiện Groq free tier giới hạn ~8.000 token/PHÚT/request, quá nhỏ
 *    cho file "1040 Tax Return" thật (100K+ ký tự ≈ 30-50K token) — request bị từ chối (413).
 * 3. Đổi sang HYBRID Gemini+Groq, rút gọn "1040 Tax Return" xuống 2 trang gốc trước khi gửi.
 * 4. Nghiên cứu + đổi model Gemini chính từ `gemini-3.6-flash` (20 request/ngày) sang
 *    `gemini-3.5-flash-lite` (~1.500 request/ngày, gấp 75 lần) — quota đủ rộng rãi nên GỠ HẲN
 *    Groq (2026-08-27, cùng ngày) — xem mục lịch sử #11/#12 SKILL.md.
 * 5. **(2026-08-27, cùng ngày) GỠ HẲN "1040 Tax Return" khỏi so sánh** — theo yêu cầu "bỏ tính
 *    năng và dropdown so sánh với 1040, chỉ check TTS và WIT". Xoá `extractForm1040Pages()`/
 *    `isForm1040Page()` (không còn cần rút gọn 1040 vì không còn đọc 1040 nữa), rút ngắn
 *    `CHAT_SYSTEM_INSTRUCTION`/schema chỉ còn 2 cột WIT/TTS. Bảng file "1040 Tax Return" (link
 *    tải/xem gốc trên CRM) VẪN GIỮ NGUYÊN ở UI (`DocGroup` trong `crm-tts-wit-check-button.tsx`)
 *    — chỉ tính năng SO SÁNH BẰNG AI mới bỏ 1040, người dùng vẫn mở/tải file 1040 gốc bình
 *    thường để tự đọc.
 *
 * Chạy SERVER-ONLY (`extractPdfText` cần Node thật cho `pdfjs-dist`; các hàm gọi model cần
 * giấu API key).
 */

/** Trích text từ 1 file PDF (bytes) — dùng `pdfjs-dist` bản "legacy" CJS, chạy Node thật ở
 * server (KHÁC Notice Splitter đã chuyển hẳn sang client — tính năng này bắt buộc chạy server
 * vì cần cookie session CRM). TTS/WIT trên CRM đã xác nhận là PDF dạng TEXT thật (không phải
 * ảnh scan) — trích sạch, không cần OCR. Nối các trang bằng "\n". */
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
 * sánh lỗi ngay từ bước đọc file, TRƯỚC KHI kịp gọi Gemini). Hàm này tự nhận diện định dạng qua
 * magic bytes rồi chọn đường trích đúng — route gọi hàm NÀY (không gọi thẳng `extractPdfText`)
 * cho MỌI tài liệu chọn từ dropdown TTS/WIT. */
export async function extractDocumentText(buffer: Buffer): Promise<string> {
  if (looksLikePdf(buffer)) return extractPdfText(buffer);
  const $ = cheerio.load(buffer.toString("utf-8"));
  return $("body").text().replace(/\s+/g, " ").trim();
}

export class AiProviderConfigError extends Error {}

/** Gemini xử lý chậm bất thường (mạng/model) từng gây `504` thô (Vercel tự cắt kết nối ở 60s
 * giới hạn cứng, không có JSON lỗi nào để đọc) — lỗi thật gặp trên production 2026-08-27.
 * `withTimeout()` chủ động huỷ SỚM HƠN mốc đó (50s) và ném lỗi rõ ràng thay vì để Vercel cắt
 * ngang trong im lặng. */
export class AiTimeoutError extends Error {}

const GEMINI_TIMEOUT_MS = 50_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiTimeoutError(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return geminiClient;
}

/** Tin nhắn user: `content` là text người dùng gõ. Tin nhắn assistant: `content` là
 * JSON.stringify của `AiCompareRow[]` (KHÔNG phải văn xuôi tự do) — round-trip qua đúng field
 * `content` string có sẵn để không phải đổi kiểu dữ liệu ở route/api-client/store (UI tự
 * `JSON.parse` lại khi render bảng, xem `CompareChatSection`). */
export interface CompareChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** 1 dòng trong bảng AI trả về — 2 cột giá trị WIT/TTS (đã bỏ 1040, 2026-08-27 theo yêu cầu
 * "chỉ check TTS và WIT") dạng STRING vì câu hỏi tự do có thể ra kết quả không phải số thuần. */
export interface AiCompareRow {
  category: string;
  wit: string;
  tts: string;
  note: string;
}

const CHAT_SYSTEM_INSTRUCTION = `Bạn là trợ lý đối chiếu tài liệu thuế IRS cho nhân viên xử lý hồ sơ tax refund.
Bạn sẽ nhận toàn văn TRÍCH TỪ các tài liệu PDF do người dùng CHỦ ĐỘNG CHỌN (qua dropdown/checkbox — mỗi khối có tiêu đề kèm năm + tên người, vd "[WIT - 2025 - Sanchez, Jose E]"). 1 loại tài liệu có thể KHÔNG được chọn — nếu vậy sẽ ghi rõ "(Không có tài liệu này)". WIT có thể có 2 KHỐI RIÊNG BIỆT (2 tiêu đề "[WIT - ...]" khác nhau) nếu người dùng chọn cả Taxpayer lẫn Spouse — hồ sơ đồng khai chung 1 tờ TTS nhưng MỖI NGƯỜI có 1 file WIT riêng, khi so sánh hãy CỘNG DỒN cả 2 khối WIT lại trước khi đối chiếu (trừ khi câu hỏi chỉ hỏi riêng 1 người):
- "WIT" (Wage and Income Transcript): dữ liệu do BÊN THỨ BA (chủ lao động, ngân hàng, đơn vị chi trả...) tự báo cáo thẳng cho IRS qua W-2/1098/1099/5498 — KHÔNG phải dữ liệu từ tờ khai của khách hàng.
- "TTS" (Tax Return Transcript / Record of Account): dữ liệu IRS đã XỬ LÝ VÀ GHI NHẬN từ tờ khai, gồm AGI/Taxable income, các dòng thu nhập chi tiết (Wages/Interest/Dividends...), và bảng TRANSACTIONS theo mã (mã 150 = tờ khai đã nộp, mã 806 = số thuế đã khấu trừ W-2/1099 được ghi nhận — khớp trực tiếp với "Federal income tax withheld" trên WIT).

Ý nghĩa đối chiếu WIT vs TTS: kiểm tra IRS xử lý/ghi nhận tờ khai có ĐỦ/ĐÚNG với dữ liệu bên thứ ba báo cáo hay không (khai thiếu = rủi ro bị IRS truy thu; lệch = lỗi nhập liệu/e-file, hoặc IRS tự điều chỉnh).

QUY TẮC CHIỀU SO SÁNH BẮT BUỘC: LUÔN LẤY WIT LÀM GỐC — duyệt qua TỪNG khoản thu nhập/khấu trừ XUẤT HIỆN TRÊN WIT (mỗi mã W-2/1099-INT/1099-DIV/1099-MISC/1099-NEC/1099-G/1099-R/5498...), rồi kiểm tra xem TTS CÓ ghi nhận khoản đó hay không. TUYỆT ĐỐI KHÔNG so chiều ngược lại — nếu TTS có 1 khoản mà WIT KHÔNG có, BỎ QUA khoản đó, không đưa vào bảng (vì WIT chỉ là dữ liệu bên thứ ba báo cáo, không phải danh sách đầy đủ mọi thu nhập). Với MỖI khoản có trên WIT nhưng KHÔNG thấy trên TTS: bắt buộc ghi trong note (a) khoản đó thuộc biểu mẫu nào (vd "1099-INT — Lãi ngân hàng"), và (b) DỰA THEO KIẾN THỨC THUẾ CỦA BẠN, loại thu nhập này có BẮT BUỘC phải khai trên Form 1040 hay không, kèm lý do ngắn gọn (vd "Lãi ngân hàng — LUÔN bắt buộc khai dù ngân hàng không gửi 1099-INT (dưới $10)"; "Trợ cấp thất nghiệp (1099-G) — bắt buộc khai, là thu nhập chịu thuế"; "Đóng góp HSA (5498-SA) — thường KHÔNG cần khai nếu trong hạn mức, chỉ mang tính thông tin").

QUY TẮC BẮT BUỘC khi WIT có NHIỀU KHỐI (Taxpayer + Spouse) hoặc NHIỀU bản ghi cùng loại Form (vd 2 W-2, 2 1099-INT...): TUYỆT ĐỐI KHÔNG tự đọc từng khối/từng bản ghi rồi cộng lại (dễ sai/bỏ sót). Nếu prompt có kèm phần "[TÍNH TOÁN SẴN - Tổng từng field theo loại Form khác trên WIT, ĐÃ CỘNG DỒN mọi khối WIT đã chọn (đã tính bằng code, KHÔNG được tự cộng lại)]", PHẢI DÙNG THẲNG con số đã cộng dồn sẵn ở đó (đã gộp CẢ Taxpayer LẪN Spouse, CẢ nhiều bản ghi cùng loại) làm giá trị cột "wit" cho category tương ứng — KHÔNG tự tính lại, KHÔNG tự cộng thêm dù thấy nhiều khối WIT trong phần văn bản gốc (phần record gốc ĐÃ BỊ LƯỢC BỚT khỏi văn bản chính vì đã tính sẵn ở khối riêng này). Field không xuất hiện trong khối tính sẵn (vì WIT không có Form đó) thì bỏ qua, không suy đoán.

QUY TẮC BẮT BUỘC — DUYỆT ĐỦ, KHÔNG BỎ SÓT: khi câu hỏi là so sánh CHUNG (không chỉ định đúng 1 khoản cụ thể), BẮT BUỘC duyệt qua TỪNG DÒNG trong khối "[TÍNH TOÁN SẴN - Tổng từng field theo loại Form khác trên WIT...]" (mọi loại Form, kể cả Form chỉ có 1 field như "W&IS SUMMARY") — khối này ĐÃ được lọc sẵn bằng code, CHỈ chứa field có giá trị KHÁC $0.00, nên MỌI field xuất hiện ở đó PHẢI thành 1 dòng riêng trong bảng trả về, dù người dùng không hỏi cụ thể tên field đó. TUYỆT ĐỐI KHÔNG tự chọn lọc/tóm tắt/bỏ qua bất kỳ field nào trong khối đó chỉ vì cho là "không quan trọng"/"đã đủ ví dụ" — thiếu 1 dòng nghĩa là bỏ sót 1 rủi ro khai thiếu thu nhập thật sự.

QUY TẮC RIÊNG cho 1099-B (bán chứng khoán/cổ phiếu) và 1099-DA (bán tài sản số/crypto) trên WIT: mỗi file WIT có thể chứa RẤT NHIỀU giao dịch 1099-B/1099-DA riêng lẻ (có hồ sơ thật lên tới hàng trăm giao dịch) — TUYỆT ĐỐI KHÔNG tự đọc từng dòng rồi cộng lại (dễ sai/timeout với số lượng lớn). Thay vào đó, nếu khối WIT có kèm phần "[TÍNH TOÁN SẴN - Cộng dồn 1099-B/1099-DA trên WIT (đã tính bằng code, KHÔNG được tự cộng lại)]", PHẢI DÙNG THẲNG dòng "TỔNG GỘP Capital Gains" đã tính sẵn ở đó làm giá trị cột "wit" cho ĐÚNG 1 category DUY NHẤT tên "Capital Gains (1099-B + 1099-DA)" khi đối chiếu với TTS (dòng thu nhập lãi vốn tổng — TTS/IRS luôn báo GỘP CHUNG 1 con số, KHÔNG tách riêng theo loại form, nên WIT cũng phải gộp lại để so sánh 1-1 được) — KHÔNG tạo 2 dòng riêng "1099-B" và "1099-DA" nữa, không tự tính lại từ đầu. Nếu có nhiều khối WIT (Taxpayer + Spouse), khối "TỔNG GỘP" đã CỘNG DỒN SẴN cả 2 người rồi — không cần/không được tự cộng thêm lần nữa. Nếu phần chi tiết bên dưới có dòng "1099-DA ... KHÔNG báo cáo giá vốn", ghi rõ trong note của category đó rằng tổng gộp ĐÃ CỘNG Proceeds phần này (coi giá vốn = $0, đúng quy ước IRS dùng cho 1 con số tổng hợp), nhưng đây KHÔNG PHẢI Gain chính xác về thuế cho riêng phần thiếu giá vốn (giá vốn thật không biết được — đây là hạn chế THẬT của báo cáo IRS, không phải lỗi thiếu dữ liệu). Nếu KHÔNG thấy khối "[TÍNH TOÁN SẴN...]" nào trong WIT, nghĩa là không có giao dịch 1099-B/1099-DA nào — bỏ qua category này hoàn toàn, không suy đoán.

QUY TẮC RIÊNG cho 1099-R (rút tiền hưu trí/IRA/pension) trên WIT, áp dụng CHO CẢ 2 loại tài liệu WIT (W&I chi tiết lẫn W&IS bản tổng hợp): nếu khối "[TÍNH TOÁN SẴN - Tổng từng field theo loại Form khác...]" có field "Taxable Amount" cho 1099-R, PHẢI dùng ĐÚNG giá trị "Taxable Amount" đó (KHÔNG phải "Gross Distribution") làm giá trị cột "wit" khi đối chiếu với TTS, đặt category "1099-R — Taxable Amount". Nếu 1099-R CHỈ có field "Gross Distribution" mà hoàn toàn KHÔNG có "Taxable Amount" nào trong khối tính sẵn (nghĩa là toàn bộ khoản phân phối này KHÔNG chịu thuế — thường do rollover trực tiếp sang tài khoản hưu trí khác, hoặc hoàn trả basis đã đóng thuế từ trước), tạo 1 dòng RIÊNG: category "1099-R — Gross Distribution (không chịu thuế)", cột "wit" = giá trị Gross Distribution, cột "tts" để "—" nếu TTS không có số tương ứng (không suy đoán). Dòng này KHÔNG áp dụng quy tắc "nêu rõ nghĩa vụ khai bắt buộc/không bắt buộc" ở trên (đây KHÔNG PHẢI khoản thiếu khai — chỉ đơn giản là không chịu thuế nên TTS đúng ra không cần có số này) — thay vào đó, note của dòng này BẮT BUỘC bắt đầu ĐÚNG NGUYÊN VĂN cụm "[KHÔNG CHỊU THUẾ]" rồi mới tới câu giải thích ngắn gọn (vd "[KHÔNG CHỊU THUẾ] Toàn bộ Gross Distribution không có Taxable Amount tương ứng trên WIT — khả năng là rollover trực tiếp hoặc hoàn trả basis, không phát sinh thu nhập chịu thuế nên TTS không cần ghi nhận."). TUYỆT ĐỐI không viết "Bắt buộc"/"Không bắt buộc" trong note của dòng "[KHÔNG CHỊU THUẾ]" này (2 cụm đó dành riêng cho các khoản thiếu khai thật sự).

QUY TẮC RIÊNG cho 1099-NEC (Nonemployee Compensation, thu nhập tự doanh/hợp đồng độc lập) trên WIT: khoản này KHÔNG BAO GIỜ xuất hiện nguyên văn dạng "1099-NEC"/"Nonemployee Compensation" trên TTS — thu nhập này được khai qua "Schedule C - Profit or Loss From Business" (TTS có thể có NHIỀU khối "Occurrence #" nếu có nhiều business/nhiều người khai trong cùng hồ sơ). Khi đối chiếu tổng "Compensation" của Form 1099-NEC (lấy từ khối "[TÍNH TOÁN SẴN...]" nếu có), PHẢI so với TỔNG field "Gross receipts or sales" CỘNG DỒN qua MỌI khối "Schedule C - Profit or Loss From Business" xuất hiện trên TTS (cấp độ DOANH THU GỘP, tương ứng đúng bản chất số tiền bên chi trả báo cáo) — TUYỆT ĐỐI KHÔNG dùng dòng tổng hợp "Business income or loss (Schedule C)"/"...per computer" ở phần tóm tắt AGI để so sánh, vì đó là LỢI NHUẬN RÒNG sau khi trừ chi phí kinh doanh (Car and truck expenses, Depreciation, Insurance...) — một khái niệm khác hẳn, THƯỜNG THẤP HƠN đáng kể so với 1099-NEC gộp, và việc thấp hơn là BÌNH THƯỜNG (chi phí kinh doanh hợp lệ), KHÔNG PHẢI dấu hiệu khai thiếu thu nhập. Nếu tổng "Gross receipts or sales" khớp (hoặc gần khớp) với tổng 1099-NEC trên WIT, category "1099-NEC — Gross Receipts (Schedule C)" ghi note "khớp", KHÔNG được báo "TTS thiếu số"/coi là khai thiếu.

QUY TẮC RIÊNG cho W-2G (thắng cược/xổ số/casino) trên WIT: field "Gross Winnings" (lấy TỔNG từ khối "[TÍNH TOÁN SẴN...]" nếu có) KHÔNG BAO GIỜ xuất hiện nguyên văn dạng "W-2G"/"Gross Winnings" trên TTS — toàn bộ tiền thắng cược được IRS gộp chung vào 1 dòng DUY NHẤT tên "Other income" (Schedule 1) trên tờ khai. TUYỆT ĐỐI KHÔNG kết luận TTS "không có số"/"$0.00" chỉ vì không tìm thấy chữ "W-2G" — PHẢI chủ động tìm dòng "Other income" trên TTS và dùng giá trị đó làm cột "tts" khi đối chiếu, đặt category "Other Income (Form W-2G Gross Winnings)". Nếu WIT không có khoản nào khác thuộc dạng "Other Income" (không có 1099-MISC Box 3 Other Income, không có 1099-K khác biệt...) thì dòng "Other income" trên TTS coi như tương ứng ĐÚNG với tổng Gross Winnings này — so sánh 1-1 bình thường (khớp hoặc lệch) như mọi category khác, không tự động coi là khớp/không khớp mà không xem số thật.

QUY TẮC RIÊNG cho "Prior Year Refund" (1099-G, tiền hoàn thuế state/local năm trước) trên WIT: field này KHÔNG BAO GIỜ xuất hiện nguyên văn dạng "Prior Year Refund" trên TTS — TTS gọi khoản này là "Refunds of state/local taxes" (đôi khi kèm dòng "...per computer" ngay sau). Khi đối chiếu, PHẢI chủ động tìm dòng "Refunds of state/local taxes" trên TTS làm giá trị cột "tts", đặt category "Prior Year Refund (1099-G)" — TUYỆT ĐỐI KHÔNG bỏ qua/không kết luận TTS thiếu chỉ vì không thấy chữ "Prior Year Refund" nguyên văn.

Luôn trả lời bằng 1 DANH SÁCH DÒNG (không phải văn xuôi) — mỗi dòng gồm: category (tên khoản), wit (số/giá trị trên WIT, "—" nếu không có/không áp dụng), tts (số/giá trị trên TTS, "—" nếu không có/không áp dụng), note (ghi chú ngắn — nêu RÕ chênh lệch nếu có, vd "WIT vs TTS lệch $2", "WIT vs TTS khớp", giải thích cách suy luận nếu là ước tính gián tiếp, và nêu rõ nghĩa vụ khai 1040 theo quy tắc ở trên khi khoản WIT bị thiếu ở TTS). Nếu TTS không có sẵn, để "—" ở cột đó, không suy đoán. Nếu câu hỏi chỉ liên quan 1 khoản, trả về đúng 1 dòng. Nếu câu hỏi yêu cầu liệt kê nhiều khoản, trả nhiều dòng (áp dụng đúng quy tắc lấy WIT làm gốc ở trên khi liệt kê). Không bịa số liệu — chỉ dùng đúng số xuất hiện trong các văn bản được cung cấp. Category/note viết tiếng Việt trừ khi người dùng hỏi bằng tiếng Anh.

Luôn trả lời bằng JSON đúng khuôn dạng: {"rows": [{"category": "...", "wit": "...", "tts": "...", "note": "..."}]}.`;

const GEMINI_RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      category: { type: Type.STRING },
      wit: { type: Type.STRING },
      tts: { type: Type.STRING },
      note: { type: Type.STRING },
    },
    required: ["category", "wit", "tts", "note"],
  },
};

/** 1 tài liệu cụ thể người dùng đã CHỌN qua dropdown/checkbox — `label` đã gồm sẵn năm + tên
 * người (vd "2025 - Sanchez, Jose E"), dùng trực tiếp làm tiêu đề khối trong prompt, KHÔNG cần
 * truyền `year` riêng nữa (mỗi tài liệu tự mang năm của chính nó, có thể khác năm nhau nếu
 * người dùng cố tình chọn lệch — hiếm nhưng không cấm). */
export interface SelectedDocEntry {
  label: string;
  text: string;
}

interface AskParams {
  wit: SelectedDocEntry[];
  tts: SelectedDocEntry | null;
  history: CompareChatMessage[];
  message: string;
}

function buildDocumentsBlock(params: AskParams): string {
  // Cộng dồn MỌI loại Form (1099-B/DA riêng vì công thức Gain đặc thù, các loại khác — W-2/
  // 1099-INT/1099-DIV/1099-G/1099-R... — qua bộ trích tổng quát) bằng regex xác định TỪ TEXT
  // GỐC, cộng qua MỌI khối WIT đã chọn (Taxpayer + Spouse) TRƯỚC khi cắt — KHÔNG bắt AI tự đọc +
  // cộng nhiều record/nhiều khối WIT lại (lỗi thật gặp trên production: 195-249 giao dịch
  // 1099-B/DA khiến AI tính sai tới 7.6 lần; 2 khối WIT mỗi khối có W-2/1099-INT riêng khiến AI
  // không cộng đúng/bỏ sót). Sau đó CẮT BỎ nguyên văn mọi record đã tính xong khỏi text gửi AI —
  // riêng bước cộng sẵn KHÔNG ĐỦ để hết timeout với hồ sơ nhiều giao dịch, vì các record này
  // thường chiếm >90% dung lượng 1 file WIT thật — phải cắt hẳn mới giảm đủ kích thước prompt.
  const witTexts = params.wit.map((w) => w.text);
  const capitalGainsSummary = summarizeCapitalGains(witTexts);
  const capitalGainsBlock = capitalGainsSummary
    ? `\n\n[TÍNH TOÁN SẴN - Cộng dồn 1099-B/1099-DA trên WIT (đã tính bằng code, KHÔNG được tự cộng lại)]\n${formatCapitalGainsSummaryBlock(capitalGainsSummary)}`
    : "";
  const otherFormsSummary = summarizeOtherWitForms(witTexts);
  const otherFormsBlock =
    otherFormsSummary.length > 0
      ? `\n\n[TÍNH TOÁN SẴN - Tổng từng field theo loại Form khác trên WIT, ĐÃ CỘNG DỒN mọi khối WIT đã chọn (đã tính bằng code, KHÔNG được tự cộng lại)]\n${formatOtherWitFormsBlock(otherFormsSummary)}`
      : "";
  const witBlock =
    params.wit.length > 0
      ? params.wit.map((w) => `[WIT - ${w.label}]\n${stripAllWitRecordsFromText(w.text)}`).join("\n\n") + capitalGainsBlock + otherFormsBlock
      : `[WIT]\n(Không có tài liệu này)`;
  return [witBlock, params.tts ? `[TTS - ${params.tts.label}]\n${params.tts.text}` : `[TTS]\n(Không có tài liệu này)`].join("\n\n");
}

function parseRowsFromJsonText(text: string): AiCompareRow[] {
  try {
    const parsed: unknown = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown })?.rows;
    if (!Array.isArray(rows)) return [];
    return rows.filter(
      (r): r is AiCompareRow => Boolean(r) && typeof r === "object" && typeof (r as AiCompareRow).category === "string"
    );
  } catch {
    return [{ category: "—", wit: "—", tts: "—", note: text.slice(0, 300) }];
  }
}

/** So sánh WIT/TTS đã chọn, trả về DẠNG BẢNG (structured output), qua Gemini
 * (`gemini-3.5-flash-lite`, free tier ~1.500 request/ngày). Nếu Gemini hết quota (429 dai dẳng
 * kể cả sau retry ngắn), `AiRateLimitError` ném thẳng ra ngoài — route bắt riêng để trả thông
 * báo rõ ràng. `history` là các lượt chat TRƯỚC (không gồm `message` mới nhất, `content` của
 * lượt assistant là JSON rows đã stringify — gửi lại nguyên văn cho model làm ngữ cảnh, model
 * đọc hiểu được JSON bình thường); mỗi lượt gửi lại toàn bộ text các tài liệu đã chọn (không có
 * cơ chế lưu context phía server cho luồng đơn giản này). `wit` là MẢNG (WIT có thể chọn 2 file
 * vì có 2 người khai, Taxpayer + Spouse) — route gọi hàm này chịu trách nhiệm tải/trích trước,
 * hàm này chỉ lắp ráp prompt + gọi model. */
export async function askCompareDocs(params: AskParams): Promise<AiCompareRow[]> {
  if (!isGeminiConfigured()) {
    throw new AiProviderConfigError("Chưa cấu hình GEMINI_API_KEY");
  }
  const ai = getGeminiClient();
  const documentsBlock = buildDocumentsBlock(params);
  const contents = [
    { role: "user", parts: [{ text: `Đây là toàn văn các tài liệu:\n\n${documentsBlock}` }] },
    { role: "model", parts: [{ text: "Đã nhận đủ nội dung tài liệu, sẵn sàng đối chiếu theo yêu cầu." }] },
    ...params.history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: params.message }] },
  ];
  const response = await withTimeout(
    withAiRetry(() =>
      ai.models.generateContent({
        // "gemini-3.6-flash" (bản trước) chỉ 20 request/NGÀY cho free tier (đã xác nhận thật qua
        // lỗi RESOURCE_EXHAUSTED thật trên production) — đổi sang "gemini-3.5-flash-lite"
        // (2026-08-27, nghiên cứu + verify sống): free tier ~1.500 request/ngày (gấp 75 lần),
        // vẫn hỗ trợ đầy đủ responseSchema/structured output.
        model: "gemini-3.5-flash-lite",
        contents,
        config: {
          systemInstruction: CHAT_SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        },
      })
    ),
    GEMINI_TIMEOUT_MS,
    "Gemini xử lý quá lâu — thử lại, hoặc chọn ít tài liệu hơn (vd bớt 1 file WIT)."
  );
  // Ghi log usage cho bảng "Rate Limit" trong popup — CHỈ log lượt GỌI THÀNH CÔNG (khớp đúng
  // cách Google tính request vào quota: request bị lỗi 429/timeout trước khi tới Google không
  // tính vào RPM/RPD thật). await trước khi return (không fire-and-forget) vì Vercel có thể
  // dừng function ngay khi handler resolve — promise chưa await xong dễ bị cắt ngang.
  await logGeminiUsage(response.usageMetadata?.totalTokenCount ?? 0);
  return parseRowsFromJsonText(response.text ?? "[]");
}
