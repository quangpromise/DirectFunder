/**
 * Tự tách + cộng dồn TOÀN BỘ số liệu dạng tiền trên WIT (1099-B/1099-DA VÀ mọi loại Form khác —
 * W-2/1099-INT/1099-DIV/1099-G/1099-R/5498...) TRONG CODE bằng regex xác định — thay vì bắt AI
 * tự đọc + cộng qua nhiều record/nhiều khối WIT (Taxpayer + Spouse). File đổi tên 2026-08-27 từ
 * `wit-capital-gains.ts` (bản đầu CHỈ xử lý 1099-B/DA) sau khi mở rộng sang MỌI loại Form theo
 * yêu cầu "tương tự với DIV, 1099G hay bất cứ khoản tiền nào, nếu chung 1 form thì gộp làm 1 số
 * tổng" — xem `summarizeOtherWitForms()`/`formatOtherWitFormsBlock()`/`stripAllWitRecordsFromText()`
 * ở nửa sau file. 1099-B/DA vẫn xử lý RIÊNG (`summarizeCapitalGains()`) vì có công thức Gain đặc
 * thù (Proceeds + Wash Sale − Cost Basis) không áp dụng được cho các Form khác.
 *
 * **Lý do tồn tại (2026-08-27)**: người dùng báo AI không tổng hợp đúng Proceeds/Cost Basis/
 * Wash Sale của 1099-B/1099-DA khi WIT có nhiều giao dịch. Debug trực tiếp với 2 hồ sơ CRM thật
 * (`BY4849`: WIT Robinhood có ~90-250 giao dịch 1099-B lẫn 1099-DA (crypto); `BY306702`: WIT
 * Merrill Lynch có ĐÚNG 195 giao dịch 1099-B) xác nhận nguyên nhân thật: yêu cầu Gemini tự cộng
 * 195 dòng số liệu rải rác trong ~220K ký tự khiến request TIMEOUT thật (quá 50s) — LLM không
 * đáng tin cậy cho phép cộng hàng loạt quy mô lớn, bất kể prompt viết rõ đến đâu. Cách sửa đúng:
 * tính tổng bằng regex xác định (nhanh, chính xác 100%, đã verify khớp tay), rồi CHỈ đưa con số
 * đã tính sẵn vào prompt cho AI dùng thẳng khi đối chiếu với TTS — AI không cần tự cộng nữa.
 * Bug tương tự (không cộng đúng khi CÓ NHIỀU BẢN GHI cùng loại/nhiều khối WIT — vd 2 W-2, 2
 * 1099-INT) đã gặp lại với các Form khác 1099-B/DA, dẫn tới việc mở rộng module này (xem trên).
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
  /** Tổng GỘP 1099-B + 1099-DA (CẢ "covered" LẪN "noncovered") thành 1 con số Gain DUY NHẤT —
   * dùng làm giá trị cột "wit" khi đối chiếu trực tiếp với dòng Capital Gain tổng trên TTS/1040.
   *
   * **Công thức (sửa 2026-08-27, cùng ngày, sau khi người dùng đối chiếu với số IRS thật trong
   * "W&IS")**: `= (totalProceeds CỦA CẢ 1099-B lẫn 1099-DA, kể cả noncovered) + totalWashSale −
   * totalCostBasis (chỉ cộng cost basis THẬT SỰ có, coi phần thiếu = $0)`. Bản đầu loại HẲN
   * Proceeds của phần `noncoveredProceeds` ra khỏi công thức (coi như "không tính được nên bỏ
   * qua") — SAI theo đúng cách IRS tự tính: đã verify chéo với "W&IS" (bản tóm tắt IRS tính sẵn)
   * của hồ sơ thật `BY306702` — công thức bản đầu ra `-$63,138` trong khi IRS tự tính ra
   * `-$58,731`, lệch đúng bằng phần Proceeds `$4,434` của 1099-DA noncovered đã bị loại nhầm.
   * Đổi công thức (CỘNG Proceeds noncovered vào, KHÔNG trừ gì cho phần cost basis thiếu của nó)
   * ra `-$58,704` — lệch chỉ `$27`/`$3.29 triệu` (~0,05%, do 2/474 giao dịch bị bỏ sót lúc trích
   * — coi là sai số làm tròn chấp nhận được). **Lưu ý bản chất**: đây LÀ QUY ƯỚC IRS dùng cho 1
   * con số tổng hợp duy nhất, KHÔNG PHẢI số Gain "chính xác về thuế" cho riêng phần noncovered
   * (giá vốn thật của phần đó vẫn không biết được — có thể lãi/lỗ khác con số này) — ghi rõ ràng
   * này trong note khi trình bày (xem `formatCapitalGainsSummaryBlock`). */
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

/** Schedule K-1 (thu nhập/lỗ từ hùn vốn công ty hợp danh, S-corp, uỷ thác) — KHÁC hẳn cấu trúc
 * tiêu đề "Form {mã}" của mọi loại trong `WIT_FORM_TYPES`, thay vào đó là "Schedule K-1 {mã Form
 * gốc}" (vd "Schedule K-1 1065", "Schedule K-1 1120-S") — lỗi thật gặp trên production: vì không
 * khớp bất kỳ ranh giới nào trong whitelist cũ, toàn bộ nội dung K-1 bị NUỐT vào record của Form
 * liền TRƯỚC rồi bị `stripAllWitRecordsFromText()` xoá sạch trước khi kịp gửi AI — K-1 hoàn toàn
 * biến mất khỏi so sánh dù có mặt rõ ràng trên WIT (đã xác nhận qua dữ liệu thật: hồ sơ có tới
 * 3/4 file WIT bị mất trắng nội dung K-1 sau bước strip, chỉ còn sót 1 file W&IS bản tóm tắt vì
 * quá ngắn nên strip không chạm tới).
 *
 * **Mở rộng 2026-08-28 (theo yêu cầu "review kỹ không bỏ lỡ bất cứ form nào dù không có chữ Form
 * đằng trước")**: thay vì giới hạn K-1 vào 1 whitelist mã cố định (dễ tái diễn đúng lỗi này với
 * 1 mã K-1 khác chưa từng gặp), nhánh "Schedule K-1 {mã}" giờ chấp nhận BẤT KỲ mã nào theo sau
 * (không whitelist) — cụm "Schedule K-1" đủ đặc thù/hiếm để không lo trùng với text mô tả nội bộ
 * của form khác (khác hẳn rủi ro đã gặp thật với "Form 8949" — 1 cụm 2 từ rất chung chung, dễ
 * xuất hiện làm text tham chiếu bên trong record 1099-B, xem whitelist `WIT_FORM_TYPES` phía
 * trên). **ĐÃ THỬ rồi BỎ**: 1 nhánh dự phòng "Schedule {bất kỳ}" (không bắt buộc "K-1" theo sau)
 * — tưởng sẽ bắt thêm được các loại Schedule khác chưa biết tên, nhưng verify lại phát hiện ngay
 * false-positive THẬT: chính bên trong 1 record "Schedule K-1 1065" có field nội bộ
 * "Schedule K-3:   Box is not   checked" (tham chiếu 1 lịch trình liên quan, KHÔNG PHẢI tiêu đề
 * mục mới) — nhánh chung khớp nhầm "Schedule K-3" thành 1 ranh giới MỚI, cắt vụn NGAY GIỮA record
 * K-1 1065 thật, khiến "Ordinary Income K-1: -$5,885.00" bị gán nhầm sang bucket "SCHEDULE K-3"
 * (đúng loại lỗi false-positive đã gặp với "Form 8949" trước đây, chỉ khác tên). Đã bỏ hẳn nhánh
 * này — CHỈ còn "Form {whitelist}" (an toàn) + "Schedule K-1 {mã bất kỳ}" (an toàn, đặc thù). Với
 * loại Form/Schedule HOÀN TOÀN chưa biết tên (không khớp cả 2 nhánh trên), dựa vào lớp AN TOÀN
 * ĐẾM TIỀN riêng trong `stripAllWitRecordsFromText()` (xem doc-comment ở đó) — không cắt bỏ đoạn
 * nào nếu chưa chắc đã trích hết số tiền trong đó, thay vì cố đoán thêm ranh giới mới dễ gây
 * false-positive như trên. */
function findFormBoundaries(text: string): { index: number; formType: string }[] {
  // Sắp xếp DÀI TỚI NGẮN trước khi ghép alternation — vd "1098-E" phải thử TRƯỚC "1098" (tiền
  // tố của nó), nếu không regex alternation sẽ khớp nhầm "1098" rồi dừng lại giữa "1098-E".
  const escapedForms = [...WIT_FORM_TYPES]
    .sort((a, b) => b.length - a.length)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  // "Wage & Income Summary" (thêm 2026-08-29, lỗi thật gặp trên production hồ sơ `BY309182`) —
  // bản "W&IS" (Wage & Income Summary, IRS tự tính sẵn theo TỪNG người, không tách theo Form)
  // trình bày dạng LIỆT KÊ PHẲNG các field cộng dồn ("Prior Year Refund:", "Unemployment
  // Compensation:"...) NGAY SAU 1 dòng tiêu đề duy nhất "Wage & Income Summary" — hoàn toàn
  // KHÔNG có tiêu đề "Form {mã}" nào (khác bản "W&I" chi tiết) nên trước đây `findFormBoundaries`
  // trả rỗng cho những file CHỈ có W&IS (không kèm W&I) → `summarizeOtherWitForms` bỏ qua
  // TOÀN BỘ file, AI phải tự đọc nguyên văn không có "TÍNH TOÁN SẴN" hỗ trợ, đọc SÓT field
  // "Prior Year Refund" dù vẫn bắt được "Unemployment Compensation" ngay cạnh đó (không ổn
  // định — đúng lý do cần tính sẵn bằng code thay vì tin AI tự đọc). Coi "Wage & Income Summary"
  // là 1 ranh giới form GIẢ ĐỊNH (formType "W&IS SUMMARY") để mọi field sau nó được trích + cộng
  // dồn đáng tin cậy giống mọi loại Form khác.
  const boundaryRe = new RegExp(
    `Form\\s+(${escapedForms})\\b|Schedule\\s+K-1\\s+([A-Za-z0-9][A-Za-z0-9-]{0,19})\\b|(Wage\\s*&\\s*Income\\s*Summary)`,
    "gi"
  );
  const boundaries: { index: number; formType: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = boundaryRe.exec(text)) !== null) {
    const formType = m[1] ? m[1].toUpperCase() : m[2] ? `K-1 ${m[2].toUpperCase()}` : "W&IS SUMMARY";
    boundaries.push({ index: m.index, formType });
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

/** Giống `splitRecords` nhưng trả segment cho MỌI loại ranh giới (không lọc riêng 1099-B/DA) —
 * dùng khi cần đọc nội dung của 1 loại boundary khác, vd "W&IS SUMMARY". */
function allBoundarySegments(text: string): { formType: string; segment: string }[] {
  const boundaries = findFormBoundaries(text);
  return boundaries.map((b, i) => {
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : text.length;
    return { formType: b.formType, segment: text.slice(b.index, end) };
  });
}

/** Đọc Proceeds/Cost or Basis/Wash Sale Loss Disallowed trong 1 đoạn text — dùng chung cho cả
 * 1 giao dịch 1099-B/DA thật LẪN khối "Wage & Income Summary" tổng hợp (xem lời gọi bên dưới).
 * Trả `null` nếu thiếu CẢ Proceeds LẪN Cost or Basis (không có số liệu nào để tính). */
function extractCapitalGainsFields(segment: string): { proceeds: number; costBasis: number | null; washSale: number } | null {
  // "(?<!Gross\s)" — khối "Wage & Income Summary" có CẢ "Gross Proceeds: $0.00" (tổng riêng cho
  // 1099-DA, thường $0 nếu không phát sinh) LẪN "Proceeds: $X.XX" (tổng 1099-B) — không có
  // lookbehind, regex khớp NHẦM vào "Proceeds:" nằm NGAY TRONG cụm "Gross Proceeds:" (đứng
  // trước trong text) thay vì field "Proceeds:" thật, đọc ra $0.00 sai hoàn toàn (bug thật gặp
  // khi verify tính năng "gộp Proceeds/Cost or Basis/Wash Sale cho W&IS", 2026-09-04).
  const proceedsMatch = /(?<!Gross\s)Proceeds:\s*\$?([\d,]+\.\d{2})/i.exec(segment);
  const costMatch = /Cost\s*or\s*Basis:\s*\$?([\d,]+\.\d{2})/i.exec(segment);
  // Bug thật gặp production (2026-09-04, hồ sơ BY307302): transcript IRS BỎ HẲN field "Proceeds:"
  // khi giá trị đúng là $0.00 (thay vì ghi "$0.00") — trước đây coi thiếu "Proceeds:" là "không
  // có số liệu" rồi BỎ QUA CẢ giao dịch (kể cả Cost or Basis thật sự có), khiến tổng Cost or
  // Basis/Wash Sale cộng dồn bị thiếu hẳn nhiều giao dịch so với số IRS tự tính trong "W&IS"
  // (đã xác nhận: hồ sơ này có 6 giao dịch 1099-B nhưng 4/6 KHÔNG có "Proceeds:", chỉ đúng 2
  // giao dịch có đủ cả 2 field từng được tính vào tổng). Chỉ bỏ qua thật nếu CẢ Proceeds LẪN
  // Cost or Basis đều không tìm thấy gì (không có số liệu nào để tính) — Proceeds thiếu thì coi
  // là $0 (đúng nghĩa transcript lược bỏ field bằng 0), không còn loại cả giao dịch.
  if (!proceedsMatch && !costMatch) return null;
  const washMatch = /Wash\s*Sale\s*Loss\s*Disallowed:\s*\$?([\d,]+\.\d{2})/i.exec(segment);
  return {
    proceeds: proceedsMatch ? parseMoney(proceedsMatch[1]) : 0,
    costBasis: costMatch ? parseMoney(costMatch[1]) : null,
    washSale: washMatch ? parseMoney(washMatch[1]) : 0,
  };
}

/** Trích TOÀN BỘ giao dịch 1099-B/1099-DA từ 1 khối text WIT (1 file — Taxpayer HOẶC Spouse).
 * Gọi riêng cho từng file WIT rồi cộng dồn ở tầng gọi nếu có nhiều khối (2 người).
 *
 * Bản "Wage & Income Summary" (W&IS, xem `findFormBoundaries`) KHÔNG có ranh giới "Form 1099-B"
 * riêng từng giao dịch như bản "W&I" chi tiết, nhưng IRS vẫn tự cộng sẵn TOÀN BỘ giao dịch
 * 1099-B/1099-DA trong năm thành đúng 3 field tổng "Proceeds"/"Cost or Basis"/"Wash Sale Loss
 * Disallowed" ngay trong khối liệt kê phẳng đó — trước đây 3 field này bị `summarizeOtherWitForms()`
 * cộng dồn như field tiền THƯỜNG (không áp dụng công thức Gain), hiện SAI lệch với "W&I" và
 * KHÔNG so sánh được đúng nghĩa với TTS (thấy riêng lẻ Proceeds/Cost or Basis thay vì 1 dòng
 * "Capital Gains" gộp đúng công thức) — sửa theo yêu cầu người dùng (2026-09-04): coi khối
 * "Wage & Income Summary" (nếu có) như 1 giao dịch TỔNG HỢP DUY NHẤT (formType "1099-B"), áp
 * dụng ĐÚNG công thức Gain giống hệt "W&I" chi tiết. `summarizeOtherWitForms()` loại bỏ riêng 3
 * field này khỏi bucket "W&IS SUMMARY" (xem `CAPITAL_GAINS_SUMMARY_LABELS`) để không hiện trùng
 * lặp dưới dạng field tiền thường nữa. */
export function extractCapitalGainsRecords(text: string): CapitalGainsRecord[] {
  const records: CapitalGainsRecord[] = [];
  for (const { formType, segment } of splitRecords(text)) {
    const fields = extractCapitalGainsFields(segment);
    if (fields) records.push({ formType, ...fields });
  }

  for (const boundary of allBoundarySegments(text)) {
    if (boundary.formType !== "W&IS SUMMARY") continue;
    const fields = extractCapitalGainsFields(boundary.segment);
    if (fields) records.push({ formType: "1099-B", ...fields });
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
  const noncoveredProceeds = daNoncovered.length > 0 ? daNoncovered.reduce((s, r) => s + r.proceeds, 0) : null;

  // Công thức khớp đúng cách IRS tự tính trong "W&IS" (đã verify chéo, xem doc-comment
  // `combinedGain` phía trên) — CỘNG Proceeds của CẢ phần noncovered vào, coi cost basis thiếu
  // = $0 (KHÔNG trừ gì cho phần đó, KHÔNG loại hẳn ra như bản đầu).
  const combinedGain =
    (form1099B?.totalProceeds ?? 0) +
    (form1099DACovered?.totalProceeds ?? 0) +
    (noncoveredProceeds ?? 0) +
    (form1099B?.totalWashSale ?? 0) +
    (form1099DACovered?.totalWashSale ?? 0) -
    (form1099B?.totalCostBasis ?? 0) -
    (form1099DACovered?.totalCostBasis ?? 0);

  return { form1099B, form1099DACovered, form1099DANoncoveredProceeds: noncoveredProceeds, combinedGain };
}

/** Dấu "-" đặt TRƯỚC "$" (vd "-$11,660.00" — cách IRS ghi K-1 lỗ) thay vì sau như số âm JS mặc
 * định in ra ("$-11,660.00") — khớp đúng định dạng gốc, tránh AI đọc nhầm cấu trúc lạ. */
function formatMoney(n: number): string {
  const formatted = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

/** 1 field dạng tiền cộng dồn theo nhãn (vd "Wages, Tips and Other Compensation"), gộp qua MỌI
 * record cùng loại Form trong MỌI khối WIT đã chọn (Taxpayer + Spouse). */
export interface WitFieldTotal {
  label: string;
  total: number;
  count: number;
}

export interface WitFormTypeSummary {
  formType: string;
  recordCount: number;
  fields: WitFieldTotal[];
}

/** Từ nối ngắn cho phép xuất hiện GIỮA 1 nhãn field thật (vd "Fair Market Value **of** Account",
 * "Wages, Tips **and** Other Compensation") mà không bị coi là điểm cắt. */
const LABEL_CONNECTOR_WORDS = new Set(["of", "or", "and", "the", "to", "from", "on", "in", "for", "a", "an", "per", "at", "no"]);

/** Từ HỢP LỆ dù chứa số/gạch ngang (thứ bị `isValidLabelWord` loại theo quy tắc chung, vì đó
 * thường là dấu hiệu mã tài khoản/CUSIP kiểu "Z60J03-1") — "K-1" là phần THẬT SỰ của tên field
 * (vd "Ordinary Income K-1" trên Schedule K-1) chứ không phải rác, nếu không whitelist riêng thì
 * `cleanLabel()` quét ngược từ CUỐI nhãn sẽ gặp "K-1" (từ cuối cùng) coi là rác đầu tiên gặp phải
 * rồi cắt bỏ TOÀN BỘ nhãn — bug thật đã tự gặp khi thêm hỗ trợ Schedule K-1 (2026-08-28):
 * `extractDollarFields()` trả rỗng cho MỌI field K-1 dù regex "{Nhãn}: $X.XX" đã khớp đúng, chỉ
 * vì bước làm sạch nhãn xoá sạch nhãn thật. */
const KNOWN_HYPHENATED_LABEL_WORDS = new Set(["K-1"]);

/** 1 "từ" trong nhãn field được coi HỢP LỆ nếu: chỉ gồm chữ cái + dấu câu thường gặp (KHÔNG chứa
 * chữ số/gạch ngang — loại được mã tài khoản/CUSIP kiểu "Z60J03-1"/"83Z45Y18TL0014550176" hay
 * lẫn vào, TRỪ các từ nằm trong `KNOWN_HYPHENATED_LABEL_WORDS`), VÀ (bắt đầu bằng chữ hoa — đúng
 * quy ước viết hoa đầu từ của nhãn IRS thật — HOẶC là từ nối ngắn trong whitelist). */
function isValidLabelWord(word: string): boolean {
  if (KNOWN_HYPHENATED_LABEL_WORDS.has(word)) return true;
  if (!/^[A-Za-z(),./&]+$/.test(word)) return false;
  const firstAlpha = word.match(/[A-Za-z]/)?.[0];
  if (!firstAlpha) return false;
  if (firstAlpha === firstAlpha.toUpperCase()) return true;
  return LABEL_CONNECTOR_WORDS.has(word.toLowerCase().replace(/[^a-z]/g, ""));
}

/** Cắt bỏ phần "rác" ở ĐẦU nhãn thô — bug thật đã tự gặp khi verify: field liền TRƯỚC không có
 * giá trị dạng tiền (vd "Submission Type: Original document") nên regex trích field không có
 * điểm dừng tự nhiên, "nuốt" luôn cụm "Original document" vào đầu nhãn field kế tiếp (ra
 * "Original document Wages, Tips and Other Compensation" thay vì đúng ra chỉ
 * "Wages, Tips and Other Compensation"), tương tự mã tài khoản/CUSIP đứng trước 1 field cũng bị
 * nuốt nhầm (vd "Z60J03-1 Fair Market Value of Account"). Quét NGƯỢC TỪ CUỐI nhãn thô, giữ lại
 * các từ HỢP LỆ liên tiếp (`isValidLabelWord`) — gặp từ đầu tiên KHÔNG hợp lệ thì dừng, chỉ lấy
 * phần từ SAU từ đó tới cuối làm nhãn thật. */
function cleanLabel(rawLabel: string): string {
  const words = rawLabel.trim().split(/\s+/);
  let startIdx = 0;
  for (let i = words.length - 1; i >= 0; i--) {
    if (!isValidLabelWord(words[i])) {
      startIdx = i + 1;
      break;
    }
  }
  return words.slice(startIdx).join(" ");
}

/** Trích MỌI field dạng "{Nhãn}: $X.XX" (hoặc "{Nhãn}: -$X.XX" — K-1 báo LỖ rất phổ biến, dấu
 * "-" đứng ngay trước "$") trong 1 đoạn record — TỔNG QUÁT, không cần biết trước tên field cụ
 * thể của từng loại Form (W-2 có "Wages, Tips and Other Compensation"/"Federal Income Tax
 * Withheld"/...; 1099-INT có "Interest"/...; 1099-DIV có "Ordinary Dividends"/"Qualified
 * Dividends"/...; 1099-G có "Unemployment Compensation"/...; K-1 có "Ordinary Income K-1"/...;
 * mỗi loại Form field khác nhau nhưng cùng 1 định dạng "Nhãn: $X.XX" nên dùng chung 1 regex
 * được). Nhãn thô trích xong luôn được lọc qua `cleanLabel()` để loại rác từ field liền trước
 * lẫn vào. */
function extractDollarFields(segment: string): { label: string; amount: number }[] {
  const re = /([A-Za-z][A-Za-z0-9,'()/\- ]{2,70}?):\s*(-?)\$([\d,]+\.\d{2})/g;
  const out: { label: string; amount: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    const label = cleanLabel(m[1]);
    const amount = parseMoney(m[3]);
    if (label) out.push({ label, amount: m[2] === "-" ? -amount : amount });
  }
  return out;
}

/** Field đã xử lý RIÊNG bằng công thức Gain của `extractCapitalGainsRecords()` khi xuất hiện
 * trong khối "Wage & Income Summary" phẳng (thêm 2026-09-04, theo yêu cầu người dùng "gộp tính
 * ra tổng Proceed, Cost or Basis, Wash of Sale như W&I") — loại khỏi bucket "W&IS SUMMARY" ở
 * đây để không hiện TRÙNG LẶP vừa dạng field tiền thường vừa trong dòng "Capital Gains" đã gộp
 * đúng công thức. */
const CAPITAL_GAINS_SUMMARY_LABELS = new Set(["Proceeds", "Cost or Basis", "Wash Sale Loss Disallowed"]);

/** Cộng dồn TOÀN BỘ field dạng tiền của MỌI loại Form khác 1099-B/1099-DA (đã có xử lý riêng ở
 * `summarizeCapitalGains` — công thức Gain đặc thù, không dùng cách cộng field trần này) — từ 1
 * HOẶC NHIỀU khối WIT (Taxpayer + Spouse), theo ĐÚNG nguyên tắc đã áp dụng cho 1099-B/DA: tính
 * SẴN trong code bằng regex xác định, KHÔNG bắt AI tự đọc + cộng nhiều record/nhiều khối WIT lại
 * (lỗi thật đã gặp: 2 file WIT mỗi file có W-2/1099-INT riêng, AI không cộng đúng hoặc bỏ sót).
 * Trả mảng RỖNG nếu WIT không có Form nào khác 1099-B/DA. */
export function summarizeOtherWitForms(texts: string[]): WitFormTypeSummary[] {
  const byFormType = new Map<string, { count: number; fields: Map<string, { total: number; count: number }> }>();

  for (const text of texts) {
    const boundaries = findFormBoundaries(text);
    for (let i = 0; i < boundaries.length; i++) {
      const b = boundaries[i];
      if (b.formType === "1099-B" || b.formType === "1099-DA") continue;
      const end = i + 1 < boundaries.length ? boundaries[i + 1].index : text.length;
      const segment = text.slice(b.index, end);
      let fields = extractDollarFields(segment);
      if (b.formType === "W&IS SUMMARY") fields = fields.filter((f) => !CAPITAL_GAINS_SUMMARY_LABELS.has(f.label));
      if (fields.length === 0) continue; // tiêu đề không kèm số liệu -> bỏ qua

      let bucket = byFormType.get(b.formType);
      if (!bucket) {
        bucket = { count: 0, fields: new Map() };
        byFormType.set(b.formType, bucket);
      }
      bucket.count++;
      for (const f of fields) {
        const existing = bucket.fields.get(f.label);
        if (existing) {
          existing.total += f.amount;
          existing.count++;
        } else {
          bucket.fields.set(f.label, { total: f.amount, count: 1 });
        }
      }
    }
  }

  // Loại bỏ field bằng $0.00 NGAY TỪ CODE (thêm 2026-08-29, theo yêu cầu "form hay tiền nào
  // bằng 0 thì không cần đưa vào bảng so sánh") — không giao việc lọc này cho AI (đã tự gặp
  // pattern AI KHÔNG ổn định khi tự quyết định lọc/bỏ field, xem mục lịch sử #32 SKILL.md: cùng
  // 1 câu hỏi, có lượt liệt kê hết cả field $0.00 dù prompt đã dặn bỏ qua) — loại quyết định này
  // khỏi tầm với của model, đảm bảo KHÔNG BAO GIỜ có field $0.00 trong khối gửi AI.
  return [...byFormType.entries()]
    .map(([formType, bucket]) => ({
      formType,
      recordCount: bucket.count,
      fields: [...bucket.fields.entries()]
        .filter(([, v]) => v.total !== 0)
        .map(([label, v]) => ({ label, total: v.total, count: v.count })),
    }))
    .filter((s) => s.fields.length > 0); // cả Form đó toàn field $0.00 -> bỏ hẳn dòng Form này
}

/** Định dạng `WitFormTypeSummary[]` thành khối text cho prompt — 1 dòng/loại Form, liệt kê từng
 * field đã cộng dồn. AI dùng thẳng các con số này khi đối chiếu với TTS, không tự cộng lại. */
export function formatOtherWitFormsBlock(summaries: WitFormTypeSummary[]): string {
  return summaries
    .map((s) => {
      const fieldsStr = s.fields.map((f) => `${f.label}: ${formatMoney(f.total)}${f.count > 1 ? ` (cộng dồn ${f.count} lần)` : ""}`).join(", ");
      return `Form ${s.formType} (${s.recordCount} bản ghi, đã CỘNG DỒN mọi khối WIT đã chọn): ${fieldsStr}.`;
    })
    .join("\n");
}

/** MỌI cụm "$X.XX" (kể cả có dấu "-" đứng trước, xem `extractDollarFields`) — dùng làm phép đếm
 * ĐỘC LẬP để kiểm chứng đã trích đủ hết số tiền trong 1 đoạn trước khi cắt, không dựa vào chính
 * `extractDollarFields` (nếu hàm đó có bug bỏ sót, dùng lại chính nó để tự kiểm tra sẽ không phát
 * hiện ra bug của chính nó). */
const DOLLAR_AMOUNT_RE = /-?\$[\d,]+\.\d{2}/g;

function countDollarAmounts(s: string): number {
  return (s.match(DOLLAR_AMOUNT_RE) ?? []).length;
}

/** Cắt bỏ TOÀN BỘ record của MỌI loại Form/Schedule khỏi 1 khối WIT — thay
 * `stripCapitalGainsRecordsFromText` (chỉ cắt 1099-B/DA) vì giờ MỌI loại Form đều đã được trích +
 * cộng dồn sẵn trong code (`summarizeCapitalGains`/`summarizeOtherWitForms`), không cần gửi
 * nguyên văn cho AI đọc lại nữa — giảm đáng kể kích thước prompt (đa số dung lượng 1 file WIT là
 * các record này). Nội dung KHÔNG khớp ranh giới nào (banner đầu file, dòng tổng số...) vẫn giữ
 * nguyên.
 *
 * **Lớp an toàn bổ sung (2026-08-28, theo yêu cầu "review kỹ không bỏ lỡ bất cứ form nào... trước
 * khi cắt và gửi AI")**: dù `findFormBoundaries()` đã mở rộng nhận diện thêm "Schedule K-1"/
 * "Schedule {bất kỳ}", vẫn có thể tồn tại 1 kiểu tiêu đề HOÀN TOÀN KHÁC mà code chưa từng biết
 * (không "Form "/không "Schedule "). Trước khi thật sự cắt bỏ 1 đoạn, ĐẾM LẠI ĐỘC LẬP số cụm
 * "$X.XX" có trong đúng đoạn đó và so với số cụm mà `extractDollarFields()` (hàm cộng dồn thật
 * dùng cho AI) đọc được — NẾU LỆCH (có tiền trong đoạn nhưng không được cộng dồn ở đâu cả), đoạn
 * đó KHÔNG được cắt — giữ nguyên văn gửi AI thay vì âm thầm mất dữ liệu (đánh đổi: AI phải tự đọc
 * thêm đúng phần chưa nhận diện được, thay vì mất trắng số liệu như bug K-1 đã gặp thật). */
export function stripAllWitRecordsFromText(text: string): string {
  const boundaries = findFormBoundaries(text);
  if (boundaries.length === 0) return text;

  const ranges = boundaries.map((b, i) => ({
    start: b.index,
    end: i + 1 < boundaries.length ? boundaries[i + 1].index : text.length,
  }));
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
    const segment = text.slice(r.start, r.end);
    const totalDollars = countDollarAmounts(segment);
    const capturedDollars = extractDollarFields(segment).length;
    if (totalDollars > 0 && capturedDollars < totalDollars) {
      // An toàn hơn mất dữ liệu — giữ nguyên đoạn này, không cắt, không thay bằng placeholder.
      result += segment;
    } else {
      result += " [ĐÃ LƯỢC BỚT các record gốc — xem tổng đã tính sẵn ở khối riêng bên dưới] ";
    }
    cursor = r.end;
  }
  result += text.slice(cursor);
  return result;
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
      )}. ĐÃ CỘNG vào TỔNG GỘP ở trên coi giá vốn = $0 (đúng quy ước IRS dùng cho 1 con số tổng hợp), nhưng giá vốn thật của phần này KHÔNG biết được nên đây KHÔNG PHẢI Gain chính xác về thuế cho riêng phần này.`
    );
  }
  return lines.join("\n");
}
