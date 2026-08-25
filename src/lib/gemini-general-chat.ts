import { GoogleGenAI } from "@google/genai";

/**
 * Chat AI TỰ DO (Gemini API free tier) — nút nổi "Trợ lý AI" hiện ở MỌI màn hình dashboard
 * (`gemini-chat-widget.tsx`, gắn trong `dashboard/layout.tsx`), KHÔNG gắn với hồ sơ/CRM nào —
 * khác hẳn `crm-doc-compare.ts` (chỉ so sánh WIT/1040/TTS của 1 hồ sơ cụ thể, trả bảng có cấu
 * trúc). Người dùng có thể hỏi bất kỳ điều gì. Dùng RIÊNG 1 client/lỗi cấu hình (không tái
 * dùng `GeminiConfigError`/client trong `crm-doc-compare.ts`) để 2 tính năng độc lập hoàn
 * toàn, sửa cái này không ảnh hưởng cái kia. Cùng đánh đổi dữ liệu-bị-dùng-để-train đã người
 * dùng xác nhận cho tính năng CRM (free tier), xem `.claude/skills/crm-tts-wit-compare/
 * SKILL.md` — áp dụng chung cho MỌI lần gọi Gemini free tier trong app này.
 */

export class GeminiChatConfigError extends Error {}

function isConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!isConfigured()) {
    throw new GeminiChatConfigError("Chưa cấu hình GEMINI_API_KEY");
  }
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export interface GeneralChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_INSTRUCTION = `Bạn là trợ lý AI tự do tích hợp trong phần mềm quản lý hồ sơ Direct Funder — trả lời BẤT KỲ câu hỏi nào người dùng hỏi, không giới hạn chủ đề, không nhất thiết liên quan tới hồ sơ khách hàng hay CRM. Trả lời ngắn gọn, đi thẳng vào trọng tâm, dễ đọc (dùng gạch đầu dòng khi liệt kê nhiều ý). Trả lời bằng tiếng Việt trừ khi người dùng hỏi bằng tiếng Anh. Nếu không chắc chắn về 1 thông tin, nói rõ là không chắc thay vì bịa.`;

/** Gọi Gemini trả lời 1 câu hỏi tự do — văn xuôi thường (KHÔNG structured output như
 * `askCompareDocs`, vì đây là chat tổng quát không có khuôn dạng bảng cố định nào phù hợp).
 * `history` là các lượt hỏi-đáp TRƯỚC (không gồm `message` mới nhất) — gửi lại nguyên văn mỗi
 * lần vì Gemini free tier không có cơ chế lưu context phía server cho luồng đơn giản này. */
export async function askGeneralChat(history: GeneralChatMessage[], message: string): Promise<string> {
  const ai = getClient();
  const contents = [
    ...history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: message }] },
  ];

  const response = await ai.models.generateContent({
    // "gemini-2.5-flash" đã ngừng cấp cho user mới (xác nhận thật — gọi API trả lỗi 404 kèm
    // khuyến nghị đổi sang model này) — vẫn thuộc free tier, xem crm-doc-compare.ts.
    model: "gemini-3.6-flash",
    contents,
    config: { systemInstruction: SYSTEM_INSTRUCTION },
  });

  return response.text ?? "";
}
