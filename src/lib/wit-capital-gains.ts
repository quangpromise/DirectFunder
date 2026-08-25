/**
 * Tự tách + cộng dồn các giao dịch 1099-B (bán chứng khoán) và 1099-DA (bán tài sản số/crypto)
 * TRONG CODE bằng regex xác định — thay vì bắt AI tự đọc + cộng hàng trăm dòng số liệu.
 *
 * **Lý do tồn tại (2026-08-27)**: người dùng báo AI không tổng hợp đúng Proceeds/Cost Basis/
 * Wash Sale của 1099-B/1099-DA khi WIT có nhiều giao dịch. Debug trực tiếp với 2 hồ sơ CRM thật
 * (`BY4849`: WIT Robinhood có ~90-250 giao dịch 1099-B lẫn 1099-DA (crypto); `BY306702`: WIT
 * Merrill Lynch có ĐÚNG 195 giao dịch 1099-B) xác nhận nguyên nhân thật: yêu cầu Gemini tự cộng
 * 195 dòng số liệu rải rác trong ~220K ký tự khiến request TIMEOUT thật (quá 50s) — LLM không
 * đáng tin cậy cho phép cộng hàng loạt quy mô lớn, bất kể prompt viết rõ đến đâu. Cách sửa đúng:
 * tính tổng bằng regex xác định (nhanh, chính xác 100%, đã verify khớp tay), rồi CHỈ đưa con số
 * đã tính sẵn vào prompt cho AI dùng thẳng khi đối chiếu với TTS — AI không cần tự cộng nữa.
 *
 * Cấu trúc thật đã khảo sát (2 broker khác nhau, cùng field name):
 * - 1099-B luôn có đủ 3 field dạng tiền: "Proceeds:", "Cost or Basis:" (LƯU Ý: có chữ "or" ở
 *   giữa — KHÁC "Cost Basis" 2 từ dính liền đã dùng nhầm trong CHAT_SYSTEM_INSTRUCTION bản
 *   trước), "Wash Sale Loss Disallowed:" — thứ tự/khoảng cách giữa các field CÓ THỂ khác nhau
 *   tuỳ broker (Merrill Lynch để gần nhau, Robinhood để xa hơn) nên KHÔNG dùng regex "3 field
 *   liên tiếp trong 1 cửa sổ ký tự cố định" (dễ bỏ sót) — thay vào đó TÁCH TỪNG RECORD theo ranh
 *   giới "Form 1099-B"/"Form 1099-DA" rồi tìm field TRONG PHẠM VI record đó.
 * - 1099-DA thường KHÔNG có "Cost or Basis" (ghi rõ "...Cost or Other Basis is NOT being
 *   reported to the IRS" — sàn crypto thường không biết giá vốn thật, nhất là khi chuyển ví/
 *   sàn khác) — chỉ có "Proceeds". Không có field Wash Sale (quy tắc wash sale hiện chưa áp
 *   dụng cho tài sản số theo hướng dẫn IRS hiện hành). Tách riêng "covered" (có Cost or Basis,
 *   tính được Gain) và "noncovered" (chỉ có Proceeds, không tính được Gain).
 */

export interface CapitalGainsRecord {
  formType: "1099-B" | "1099-DA";
  proceeds: number;
  /** null nếu record không báo cáo giá vốn (thường gặp ở 1099-DA "noncovered"). */
  costBasis: number | null;
  washSale: number;
}

export interface CapitalGainsBucket {
  count: number;
  totalProceeds: number;
  totalCostBasis: number;
  totalWashSale: number;
  /** Gain = totalProceeds + totalWashSale - totalCostBasis — CHỈ có ý nghĩa khi mọi record
   * trong bucket đều có costBasis (bucket "covered"). */
  gain: number;
}

export interface CapitalGainsSummary {
  form1099B: CapitalGainsBucket | null;
  /** 1099-DA tách 2 nhóm — "covered" tính được Gain như 1099-B, "noncoveredProceeds" chỉ có
   * tổng Proceeds (không tính được Gain vì thiếu giá vốn). */
  form1099DACovered: CapitalGainsBucket | null;
  form1099DANoncoveredProceeds: number | null;
  /** Tổng GỘP 1099-B + 1099-DA "covered" thành 1 con số Gain DUY NHẤT — dùng làm giá trị cột
   * "wit" khi đối chiếu trực tiếp với dòng Capital Gain tổng trên TTS/1040 (đã xác nhận thật:
   * TTS/IRS luôn báo GỘP CHUNG 1 con số, không tách riêng theo loại form — trước đây trả về 2
   * dòng "1099-B"/"1099-DA" riêng biệt khiến khó đối chiếu 1-1 với TTS, theo yêu cầu người dùng
   * "tổng của 1099B và 1099DA nên gộp lại"). CHƯA gồm phần `form1099DANoncoveredProceeds` (nếu
   * có) vì phần đó không tính được Gain thật do thiếu giá vốn — ghi chú riêng khi trình bày. */
  combinedGain: number;
}

function parseMoney(raw: string): number {
  return Number(raw.replace(/[$,]/g, ""));
}

/** Ranh giới ĐẦU MỖI record trong 1 file WIT — khớp "Form {mã form}" BẤT KỲ (không chỉ 1099-B/
 * DA) — vd "Form W-2", "Form 1099-INT", "Form 1099-DIV", "Form 1099-R", "Form 5498"... Dùng
 * ranh giới TỔNG QUÁT này (không chỉ 1099-B/DA) để xác định ĐÚNG điểm KẾT THÚC của mỗi record
 * 1099-B/DA — bug thật đã tự gặp khi verify: nếu chỉ tìm ranh giới "Form 1099-B"/"Form 1099-DA",
 * giao dịch 1099-B/DA CUỐI CÙNG trong file (không có giao dịch 1099-B/DA nào theo sau) bị coi
 * là kéo dài tới HẾT VĂN BẢN — nuốt mất mọi nội dung khác nằm SAU nó (đã xác nhận thật: 2 dòng
 * "Form 1099-INT" của hồ sơ `BY306702` nằm NGAY SAU giao dịch 1099-B cuối cùng, bị cắt mất hoàn
 * toàn theo cách cũ). */
/** Whitelist các mã Form THẬT xuất hiện làm tiêu đề 1 mục thu nhập trên WIT — KHÔNG dùng regex
 * tổng quát "Form + 4 chữ số bất kỳ" (bug thật đã tự gặp khi verify): mỗi giao dịch 1099-B tự
 * chứa câu tham chiếu nội bộ "...Applicable Check Box on Form 8949: Long term transaction..." —
 * "Form 8949" ở đây KHÔNG PHẢI tiêu đề 1 record mới, chỉ là 1 field mô tả bên trong chính record
 * 1099-B đó, nhưng regex tổng quát vẫn khớp nhầm thành ranh giới, cắt vụn record giữa chừng và
 * khiến phần còn lại (từ "Applicable..." tới hết record 1099-B thật) bị coi là thuộc "form 8949"
 * nên KHÔNG bị cắt bỏ (sót lại rất nhiều text thừa, ~181K/514K ký tự thay vì đúng ra chỉ còn vài
 * chục KB). Whitelist dưới đây chỉ gồm các mã Form THẬT là 1 LOẠI THU NHẬP/tài liệu độc lập trên
 * WIT (không phải form tham chiếu nội bộ như 8949/8814/4972...). */
const WIT_FORM_TYPES = [
  "W-2",
  "W-2G",
  "1099-B",
  "1099-DA",
  "1099-INT",
  "1099-DIV",
  "1099-R",
  "1099-NEC",
  "1099-MISC",
  "1099-G",
  "1099-K",
  "1099-C",
  "1099-OID",
  "1099-Q",
  "1099-SA",
  "1098",
  "1098-E",
  "1098-T",
  "5498",
  "5498-SA",
  "SSA-1099",
] as const;

function findFormBoundaries(text: string): { index: number; formType: string }[] {
  // Sắp xếp DÀI TỚI NGẮN trước khi ghép alternation — vd "1098-E" phải thử TRƯỚC "1098" (tiền
  // tố của nó), nếu không regex alternation sẽ khớp nhầm "1098" rồi dừng lại giữa "1098-E".
  const escaped = [...WIT_FORM_TYPES]
    .sort((a, b) => b.length - a.length)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const boundaryRe = new RegExp(`Form\\s+(${escaped})\\b`, "gi");
  const boundaries: { index: number; formType: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = boundaryRe.exec(text)) !== null) {
    boundaries.push({ index: m.index, formType: m[1].toUpperCase() });
  }
  return boundaries;
}

/** Tách toàn văn WIT thành từng "record" giao dịch CHỈ thuộc 1099-B/1099-DA — mỗi record là
 * đoạn text từ 1 tiêu đề "Form 1099-B"/"Form 1099-DA" tới NGAY TRƯỚC ranh giới "Form {bất kỳ}"
 * tiếp theo (không chỉ 1099-B/DA — xem `findFormBoundaries`), đảm bảo không nuốt nhầm nội dung
 * của form khác nằm liền sau. */
function splitRecords(text: string): { formType: "1099-B" | "1099-DA"; segment: string }[] {
  const boundaries = findFormBoundaries(text);
  const records: { formType: "1099-B" | "1099-DA"; segment: string }[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    if (b.formType !== "1099-B" && b.formType !== "1099-DA") continue;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : text.length;
    records.push({ formType: b.formType, segment: text.slice(b.index, end) });
  }
  return records;
}

/** Trích TOÀN BỘ giao dịch 1099-B/1099-DA từ 1 khối text WIT (1 file — Taxpayer HOẶC Spouse).
 * Gọi riêng cho từng file WIT rồi cộng dồn ở tầng gọi nếu có nhiều khối (2 người). */
export function extractCapitalGainsRecords(text: string): CapitalGainsRecord[] {
  const records: CapitalGainsRecord[] = [];
  for (const { formType, segment } of splitRecords(text)) {
    const proceedsMatch = /Proceeds:\s*\$?([\d,]+\.\d{2})/i.exec(segment);
    if (!proceedsMatch) continue; // dòng tiêu đề không kèm số liệu (hiếm) -> bỏ qua, không bịa 0
    const costMatch = /Cost\s*or\s*Basis:\s*\$?([\d,]+\.\d{2})/i.exec(segment);
    const washMatch = /Wash\s*Sale\s*Loss\s*Disallowed:\s*\$?([\d,]+\.\d{2})/i.exec(segment);
    records.push({
      formType,
      proceeds: parseMoney(proceedsMatch[1]),
      costBasis: costMatch ? parseMoney(costMatch[1]) : null,
      washSale: washMatch ? parseMoney(washMatch[1]) : 0,
    });
  }
  return records;
}

function summarizeBucket(records: CapitalGainsRecord[]): CapitalGainsBucket {
  const totalProceeds = records.reduce((s, r) => s + r.proceeds, 0);
  const totalCostBasis = records.reduce((s, r) => s + (r.costBasis ?? 0), 0);
  const totalWashSale = records.reduce((s, r) => s + r.washSale, 0);
  return { count: records.length, totalProceeds, totalCostBasis, totalWashSale, gain: totalProceeds + totalWashSale - totalCostBasis };
}

/** Cộng dồn TOÀN BỘ giao dịch 1099-B/1099-DA từ 1 HOẶC NHIỀU khối WIT (Taxpayer + Spouse) thành
 * 1 bản tóm tắt duy nhất — dùng trực tiếp làm giá trị cột "wit" khi so sánh với TTS, KHÔNG bắt
 * AI tự cộng lại. Trả `null` nếu không tìm thấy giao dịch 1099-B/1099-DA nào (WIT không có mục
 * này — phổ biến, không phải lỗi). */
export function summarizeCapitalGains(texts: string[]): CapitalGainsSummary | null {
  const allRecords = texts.flatMap(extractCapitalGainsRecords);
  if (allRecords.length === 0) return null;

  const b = allRecords.filter((r) => r.formType === "1099-B");
  const daCovered = allRecords.filter((r) => r.formType === "1099-DA" && r.costBasis !== null);
  const daNoncovered = allRecords.filter((r) => r.formType === "1099-DA" && r.costBasis === null);

  const form1099B = b.length > 0 ? summarizeBucket(b) : null;
  const form1099DACovered = daCovered.length > 0 ? summarizeBucket(daCovered) : null;
  return {
    form1099B,
    form1099DACovered,
    form1099DANoncoveredProceeds: daNoncovered.length > 0 ? daNoncovered.reduce((s, r) => s + r.proceeds, 0) : null,
    combinedGain: (form1099B?.gain ?? 0) + (form1099DACovered?.gain ?? 0),
  };
}

/** Cắt bỏ TOÀN BỘ đoạn text 1099-B/1099-DA khỏi 1 khối WIT — giữ nguyên mọi nội dung khác
 * (W-2/1099-INT/1099-DIV/1099-R/1099-NEC/1099-MISC/5498...). Đây là bước RÚT GỌN PROMPT bắt
 * buộc, không chỉ "tiện": đã tự gặp thật — dù `summarizeCapitalGains()` đã tính sẵn Gain, gửi
 * KÈM nguyên văn 195-249 giao dịch (chiếm >90% dung lượng file WIT thật đã khảo sát, vd
 * 195K/217K ký tự) vẫn khiến request Gemini TIMEOUT (input quá lớn, không liên quan gì tới việc
 * AI có phải tự cộng hay không — vấn đề là THỜI GIAN GEMINI ĐỌC HẾT INPUT). Trả về text đã cắt,
 * chèn 1 dòng đánh dấu ngắn tại vị trí đã cắt để AI biết còn dữ liệu (không hiểu nhầm là không
 * có 1099-B/DA nào — số liệu thật đã nằm ở khối "[TÍNH TOÁN SẴN...]" riêng). */
export function stripCapitalGainsRecordsFromText(text: string): string {
  const boundaries = findFormBoundaries(text);
  const ranges: { start: number; end: number }[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    if (b.formType !== "1099-B" && b.formType !== "1099-DA") continue;
    ranges.push({ start: b.index, end: i + 1 < boundaries.length ? boundaries[i + 1].index : text.length });
  }
  if (ranges.length === 0) return text;

  // Gộp các range liền kề thành khối lớn để chỉ chèn 1 dòng đánh dấu / khối liên tục, không lặp
  // lại placeholder cho từng giao dịch riêng lẻ.
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }

  let result = "";
  let cursor = 0;
  for (const r of merged) {
    result += text.slice(cursor, r.start);
    result += " [ĐÃ LƯỢC BỚT các giao dịch 1099-B/1099-DA gốc — xem tổng đã tính sẵn ở khối riêng bên dưới] ";
    cursor = r.end;
  }
  result += text.slice(cursor);
  return result;
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Định dạng `CapitalGainsSummary` thành 1 khối text NGẮN GỌN, dễ đọc để chèn vào prompt gửi
 * AI — AI chỉ cần ĐỌC và DÙNG THẲNG các con số Gain đã tính sẵn ở đây (không tự cộng lại), xem
 * hướng dẫn tương ứng đã thêm trong `CHAT_SYSTEM_INSTRUCTION` (`crm-doc-compare.ts`). */
export function formatCapitalGainsSummaryBlock(summary: CapitalGainsSummary): string {
  const lines: string[] = [];
  lines.push(
    `TỔNG GỘP Capital Gains (1099-B + 1099-DA, DÙNG CON SỐ NÀY làm giá trị cột "wit" để đối chiếu với TTS — TTS luôn báo 1 con số gộp, không tách riêng theo loại form): ${formatMoney(summary.combinedGain)}.`
  );
  if (summary.form1099B) {
    const b = summary.form1099B;
    lines.push(
      `  - Chi tiết 1099-B (bán chứng khoán): ${b.count} giao dịch — Tổng Proceeds ${formatMoney(b.totalProceeds)}, Tổng Cost or Basis ${formatMoney(
        b.totalCostBasis
      )}, Tổng Wash Sale Loss Disallowed ${formatMoney(b.totalWashSale)} → Gain = ${formatMoney(b.gain)}.`
    );
  }
  if (summary.form1099DACovered) {
    const d = summary.form1099DACovered;
    lines.push(
      `  - Chi tiết 1099-DA (bán tài sản số/crypto, CÓ báo cáo giá vốn): ${d.count} giao dịch — Tổng Proceeds ${formatMoney(
        d.totalProceeds
      )}, Tổng Cost or Basis ${formatMoney(d.totalCostBasis)}, Tổng Wash Sale ${formatMoney(d.totalWashSale)} → Gain = ${formatMoney(d.gain)}.`
    );
  }
  if (summary.form1099DANoncoveredProceeds !== null) {
    lines.push(
      `  - 1099-DA (bán tài sản số/crypto, KHÔNG báo cáo giá vốn — sàn không biết Cost Basis): Tổng Proceeds ${formatMoney(
        summary.form1099DANoncoveredProceeds
      )}. KHÔNG tính được Gain chính xác vì thiếu giá vốn, CHƯA gộp vào tổng ở trên — chỉ dùng Proceeds làm tham khảo.`
    );
  }
  return lines.join("\n");
}
