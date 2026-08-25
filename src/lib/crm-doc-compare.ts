import { GoogleGenAI, Type } from "@google/genai";
import { withGeminiRetry } from "@/lib/gemini-retry";

/**
 * So sánh WIT / "1040 Tax Return" / TTS trong popup "Get Files" — chat hỏi-đáp tự do dùng
 * **Gemini API (free tier)**, KHÔNG dùng cơ chế regex cố định nữa (bảng regex ban đầu, chỉ so
 * WIT-TTS, đã BỎ theo yêu cầu 2026-08-26 — xem lịch sử quyết định trong
 * `.claude/skills/crm-tts-wit-compare/SKILL.md`). Người dùng đã CHỦ ĐỘNG chọn free tier dù biết
 * dữ liệu gửi lên (bao gồm SSN/thu nhập khách hàng) sẽ bị Google dùng để cải thiện sản phẩm của
 * họ (đánh đổi đã xác nhận, xem SKILL.md — KHÔNG tự ý đổi sang bản trả phí mà không hỏi lại).
 * Chạy SERVER-ONLY (`extractPdfText` cần Node thật cho `pdfjs-dist`; `askCompareDocs` cần giấu
 * API key).
 */

/** Trích text từ 1 file PDF (bytes) — dùng `pdfjs-dist` bản "legacy" CJS, chạy Node thật ở
 * server (KHÁC Notice Splitter đã chuyển hẳn sang client — tính năng này bắt buộc chạy server
 * vì cần cookie session CRM). TTS/WIT/1040 trên CRM đã xác nhận là PDF dạng TEXT thật (không
 * phải ảnh scan) — trích sạch, không cần OCR. */
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

export class GeminiConfigError extends Error {}

function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!isGeminiConfigured()) {
    throw new GeminiConfigError("Chưa cấu hình GEMINI_API_KEY");
  }
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
Bạn sẽ nhận toàn văn TRÍCH TỪ các tài liệu PDF do người dùng CHỦ ĐỘNG CHỌN (qua dropdown/checkbox — mỗi khối có tiêu đề kèm năm + tên người, vd "[WIT - 2025 - Sanchez, Jose E]"). 1 số loại tài liệu có thể KHÔNG được chọn — nếu vậy sẽ ghi rõ "(Không có tài liệu này)". WIT có thể có 2 KHỐI RIÊNG BIỆT (2 tiêu đề "[WIT - ...]" khác nhau) nếu người dùng chọn cả Taxpayer lẫn Spouse — hồ sơ đồng khai chung 1 tờ 1040/TTS nhưng MỖI NGƯỜI có 1 file WIT riêng, khi so sánh WIT với 1040/TTS hãy CỘNG DỒN cả 2 khối WIT lại trước khi đối chiếu (trừ khi câu hỏi chỉ hỏi riêng 1 người):
- "WIT" (Wage and Income Transcript): dữ liệu do BÊN THỨ BA (chủ lao động, ngân hàng, đơn vị chi trả...) tự báo cáo thẳng cho IRS qua W-2/1098/1099/5498 — KHÔNG phải dữ liệu từ tờ khai của khách hàng.
- "1040 Tax Return": bản PDF tờ khai 1040 THẬT đã chuẩn bị/nộp (do văn phòng/khách hàng tải lên CRM) — đây là "nguồn gốc" của tờ khai, trước khi IRS xử lý.
- "TTS" (Tax Return Transcript / Record of Account): dữ liệu IRS đã XỬ LÝ VÀ GHI NHẬN từ tờ khai, gồm AGI/Taxable income, các dòng thu nhập chi tiết (Wages/Interest/Dividends...), và bảng TRANSACTIONS theo mã (mã 150 = tờ khai đã nộp, mã 806 = số thuế đã khấu trừ W-2/1099 được ghi nhận — khớp trực tiếp với "Federal income tax withheld" trên WIT).

Ý nghĩa từng cặp đối chiếu:
- WIT vs 1040 Tax Return: kiểm tra tờ khai đã chuẩn bị có khai ĐỦ/ĐÚNG thu nhập bên thứ ba báo cáo hay chưa (khai thiếu = rủi ro bị IRS truy thu).
- 1040 Tax Return vs TTS: kiểm tra IRS xử lý/ghi nhận tờ khai có ĐÚNG với bản đã nộp hay không (lệch = lỗi nhập liệu/e-file, hoặc IRS tự điều chỉnh).
- WIT vs TTS: đối chiếu gián tiếp qua 1040 — hữu ích khi không có bản 1040 Tax Return.

QUY TẮC CHIỀU SO SÁNH BẮT BUỘC cho 2 cặp "WIT vs 1040 Tax Return" và "WIT vs TTS": LUÔN LẤY WIT LÀM GỐC — duyệt qua TỪNG khoản thu nhập/khấu trừ XUẤT HIỆN TRÊN WIT (mỗi mã W-2/1099-INT/1099-DIV/1099-MISC/1099-NEC/1099-G/1099-R/5498...), rồi kiểm tra xem 1040 Tax Return/TTS (tuỳ đang so cặp nào) CÓ ghi nhận khoản đó hay không. TUYỆT ĐỐI KHÔNG so chiều ngược lại — nếu 1040/TTS có 1 khoản mà WIT KHÔNG có, BỎ QUA khoản đó, không đưa vào bảng (vì WIT chỉ là dữ liệu bên thứ ba báo cáo, không phải danh sách đầy đủ mọi thu nhập). Với MỖI khoản có trên WIT nhưng KHÔNG thấy trên 1040/TTS: bắt buộc ghi trong note (a) khoản đó thuộc biểu mẫu nào (vd "1099-INT — Lãi ngân hàng"), và (b) DỰA THEO KIẾN THỨC THUẾ CỦA BẠN, loại thu nhập này có BẮT BUỘC phải khai trên Form 1040 hay không, kèm lý do ngắn gọn (vd "Lãi ngân hàng — LUÔN bắt buộc khai dù ngân hàng không gửi 1099-INT (dưới $10)"; "Trợ cấp thất nghiệp (1099-G) — bắt buộc khai, là thu nhập chịu thuế"; "Đóng góp HSA (5498-SA) — thường KHÔNG cần khai nếu trong hạn mức, chỉ mang tính thông tin"). Cặp "1040 Tax Return vs TTS" (không liên quan WIT) KHÔNG áp dụng quy tắc 1 chiều này — vẫn so 2 chiều bình thường như trước.

Luôn trả lời bằng 1 DANH SÁCH DÒNG (không phải văn xuôi) — mỗi dòng gồm: category (tên khoản), wit (số/giá trị trên WIT, "—" nếu không có/không áp dụng), taxReturn (số/giá trị trên bản 1040 Tax Return, "—" nếu không có/không áp dụng), tts (số/giá trị trên TTS, "—" nếu không có/không áp dụng), note (ghi chú ngắn — nêu RÕ chênh lệch giữa cặp nào nếu có, vd "1040 vs TTS lệch $2", "WIT vs 1040 khớp", giải thích cách suy luận nếu là ước tính gián tiếp, và nêu rõ nghĩa vụ khai 1040 theo quy tắc ở trên khi khoản WIT bị thiếu ở 1040/TTS). Nếu 1 tài liệu không có sẵn, để "—" ở đúng cột đó, không suy đoán. Nếu câu hỏi chỉ liên quan 1 khoản, trả về đúng 1 dòng. Nếu câu hỏi yêu cầu liệt kê nhiều khoản, trả nhiều dòng (áp dụng đúng quy tắc lấy WIT làm gốc ở trên khi liệt kê). Không bịa số liệu — chỉ dùng đúng số xuất hiện trong các văn bản được cung cấp. Category/note viết tiếng Việt trừ khi người dùng hỏi bằng tiếng Anh.`;

const CHAT_RESPONSE_SCHEMA = {
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

/** 1 tài liệu cụ thể người dùng đã CHỌN qua dropdown/checkbox (thêm 2026-08-26 theo yêu cầu "3
 * trường select cho 3 loại TTS/WIT/1040... list tất cả tên đang có") — `label` đã gồm sẵn năm +
 * tên người (vd "2025 - Sanchez, Jose E"), dùng trực tiếp làm tiêu đề khối trong prompt, KHÔNG
 * cần truyền `year` riêng nữa (mỗi tài liệu tự mang năm của chính nó, có thể khác năm nhau nếu
 * người dùng cố tình chọn lệch — hiếm nhưng không cấm). */
export interface SelectedDocEntry {
  label: string;
  text: string;
}

/** Gọi Gemini so sánh các tài liệu ĐÃ CHỌN (WIT/1040 Tax Return/TTS), trả về DẠNG BẢNG
 * (structured output — `responseSchema`, KHÔNG phải văn xuôi tự do parse bằng tay). `history`
 * là các lượt chat TRƯỚC (không gồm `message` mới nhất, `content` của lượt assistant là JSON
 * rows đã stringify — gửi lại nguyên văn cho Gemini làm ngữ cảnh, model đọc hiểu được JSON bình
 * thường); mỗi lượt gửi lại toàn bộ text các tài liệu đã chọn (Gemini free tier không có cơ chế
 * lưu context phía server cho luồng đơn giản này). `wit` là MẢNG (thêm 2026-08-26 — WIT có thể
 * chọn 2 file vì có 2 người khai, Taxpayer + Spouse) — route gọi hàm này chịu trách nhiệm
 * tải/trích trước, hàm này chỉ lắp ráp prompt. */
export async function askCompareDocs(params: {
  wit: SelectedDocEntry[];
  taxReturn: SelectedDocEntry | null;
  tts: SelectedDocEntry | null;
  history: CompareChatMessage[];
  message: string;
}): Promise<AiCompareRow[]> {
  const ai = getGeminiClient();
  const witBlock =
    params.wit.length > 0
      ? params.wit.map((w) => `[WIT - ${w.label}]\n${w.text}`).join("\n\n")
      : `[WIT]\n(Không có tài liệu này)`;
  const documentsBlock = [
    witBlock,
    params.taxReturn ? `[1040 Tax Return - ${params.taxReturn.label}]\n${params.taxReturn.text}` : `[1040 Tax Return]\n(Không có tài liệu này)`,
    params.tts ? `[TTS - ${params.tts.label}]\n${params.tts.text}` : `[TTS]\n(Không có tài liệu này)`,
  ].join("\n\n");

  const contents = [
    { role: "user", parts: [{ text: `Đây là toàn văn các tài liệu:\n\n${documentsBlock}` }] },
    { role: "model", parts: [{ text: "Đã nhận đủ nội dung tài liệu, sẵn sàng đối chiếu theo yêu cầu." }] },
    ...params.history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: params.message }] },
  ];

  // Tự retry ngắn nếu Gemini free tier trả 429 (giới hạn tốc độ) — lỗi thật đã gặp trên
  // production, xem gemini-retry.ts.
  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      // "gemini-2.5-flash" đã ngừng cấp cho user mới (xác nhận thật 2026-08-25 — gọi API trả
      // lỗi 404 kèm khuyến nghị đổi sang model này) — vẫn thuộc free tier.
      model: "gemini-3.6-flash",
      contents,
      config: {
        systemInstruction: CHAT_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: CHAT_RESPONSE_SCHEMA,
      },
    })
  );

  const text = response.text ?? "[]";
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is AiCompareRow => Boolean(r) && typeof r === "object" && typeof (r as AiCompareRow).category === "string"
    );
  } catch {
    return [{ category: "—", wit: "—", taxReturn: "—", tts: "—", note: text.slice(0, 300) }];
  }
}
