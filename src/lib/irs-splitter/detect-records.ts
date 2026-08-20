// Tách text của 1 file scan/OCR gộp nhiều thư IRS thành từng "record" (khoảng trang liên
// tiếp) theo đúng khách hàng, kèm best-effort tên/loại thư/tax year/cờ "gửi qua văn phòng"
// (care of) cho mỗi record.
//
// Các batch dùng để xây dựng logic này trộn lẫn nhiều mẫu thư/notice IRS khác nhau (CP504,
// CP521, CP523, CP2000D, CP22A, CP50/CP501, LT-series, "LTR ###C"...), quét qua OCR thường
// nhiễu (đọc sai số, mất/nhòe chữ, lẫn ký tự rác của mã vạch). Không có tín hiệu đơn lẻ nào
// đủ tin cậy để báo "trang này bắt đầu 1 khách hàng mới" trên mọi mẫu, nên module này kết
// hợp 3 tín hiệu độc lập, coi bất kỳ tín hiệu nào khớp là 1 ranh giới cứng:
//
//   1. Dòng "Page 1 of N" (đa số mẫu CP in dòng này).
//   2. 1 mã số ngắn xuất hiện ngay sau city/state/zip của địa chỉ văn phòng (vd
//      "...SAN JOSE CA 95112-1129  008919  Notice of intent...").
//   3. 1 mã số ngắn nằm trong dòng metadata mã vạch thư, CHỈ xuất hiện ở đúng trang đầu
//      (vd "008919.785725.335256.7278   1 MB 0.707   692").
//
// Đây là logic heuristic — với bản scan xấu, luôn cần soát lại (xem README gốc "Accuracy &
// review") trước khi coi tên/tax year là chính xác tuyệt đối.

import { DetectOptions, IrsNoticeRecord } from "./types";
import { DEFAULT_CARE_OF_ELIGIBLE_NOTICE_TYPES, isCareOfEligibleNoticeType } from "./care-of-eligibility";

export const DEFAULT_OPTIONS: Required<DetectOptions> = {
  // Địa chỉ văn phòng "in care of" in trên thư chưa được chuyển thẳng cho khách hàng. Chỉ
  // phần OCR đọc ổn định (không phải số nhà đầu, vốn là chỗ OCR hay đọc sai nhất) mới cần
  // khớp chính xác.
  officeStreet: "ZANKER RD STE 230",
  officeCity: "SAN JOSE",
  officeState: "CA",
  officeZipPrefix: "9", // chữ số đầu của ZIP văn phòng

  // Số ký tự lùi lại từ địa chỉ để tìm dấu hiệu "%" hoặc "C/O" (2 mẫu khác nhau nhưng cùng
  // ý nghĩa "gửi qua địa chỉ này thay vì thẳng khách hàng").
  careOfSearchWindow: 80,

  // Số ký tự tính từ sau city/state/zip văn phòng để tìm mã số record.
  idAfterAddressWindow: 80,

  careOfEligibleNoticeTypes: DEFAULT_CARE_OF_ELIGIBLE_NOTICE_TYPES,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordsToFuzzyPattern(phrase: string): string {
  return phrase.trim().split(/\s+/).map(escapeRegExp).join("\\s*");
}

interface Patterns {
  addressRe: RegExp;
  cityStateZipRe: RegExp;
  companyNameRe: RegExp;
}

function buildPatterns(opts: Required<DetectOptions>): Patterns {
  const street = wordsToFuzzyPattern(opts.officeStreet);
  const city = wordsToFuzzyPattern(opts.officeCity);
  const state = wordsToFuzzyPattern(opts.officeState);
  // Dòng "RA SOLUTIONS CORPORATION" (đôi khi viết tắt "CORP") luôn in NGAY DƯỚI tên khách
  // hàng, ngay trên địa chỉ văn phòng -- dùng làm ranh giới để cắt tên (xem extractName),
  // thay vì lấy mọi token ngay trước địa chỉ (sẽ dính luôn cụm này vào cuối tên).
  const companyFull = wordsToFuzzyPattern("RA SOLUTIONS CORPORATION");
  const companyAbbrev = wordsToFuzzyPattern("RA SOLUTIONS CORP");
  return {
    // vd /\d{3,4}\s*ZANKER\s*RD\s*STE\s*230/i -- số nhà cố ý lỏng (3-4 số) vì OCR hay đọc
    // sai chữ số đầu.
    addressRe: new RegExp(`\\d{3,4}\\s*${street}`, "i"),
    // vd /SAN\s*JOSE\s*CA\s*9\s*\d\s*\d\s*\d\s*\d.../i -- mỗi số zip nối \s* riêng để chịu
    // được OCR chèn khoảng trắng lạc giữa số.
    cityStateZipRe: new RegExp(
      `${city}\\s*${state}\\s*${opts.officeZipPrefix}\\s*\\d\\s*\\d\\s*\\d\\s*\\d[\\s.-]*\\d?\\s*\\d?\\s*\\d?\\s*\\d?`,
      "i"
    ),
    companyNameRe: new RegExp(`${companyFull}|${companyAbbrev}`, "i"),
  };
}

function extractIdFromMetaLine(content: string): string | null {
  // Dòng metadata mã vạch thư chỉ xuất hiện ở đúng trang đầu, vd
  // "008919.785725.335256.7278   1 MB 0.707   692" hoặc
  // "001034   .125586.369644.22435 1   MB   0.707   850".
  const m = content.match(/(\d{6})\s*[.+]\s*\d+\s*\.\s*\d+\s*\.\s*\d+\s+\d\s+[A-Z0-9]{2}\s+[\d.]+\s+\d+/);
  return m ? m[1] : null;
}

function extractIdAfterAddress(
  content: string,
  patterns: Patterns,
  window: number
): { id: string; addressStart: number } | null {
  const csz = content.match(patterns.cityStateZipRe);
  if (!csz || csz.index == null) return null;
  const after = content.slice(csz.index + csz[0].length, csz.index + csz[0].length + window);
  const re = /(\d{4,7})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(after)) !== null) {
    const precedingTrimmed = after.slice(0, m.index).replace(/\s+/g, "");
    // bỏ qua mảnh số điện thoại kiểu "800 = 829 = 3676" và năm kiểu "2026"
    if (precedingTrimmed.endsWith("=") || precedingTrimmed.endsWith("(")) continue;
    if (/^20\d{2}$/.test(m[1])) continue;
    if (/^(\d)\1+$/.test(m[1])) continue; // số lặp lại -- rác mã vạch/glyph
    return { id: m[1], addressStart: csz.index };
  }
  return null;
}

const NOISE_WORDS_CI =
  /^(rd|IRS|Notice:?|SB|WI|AB|MB|AV|BODC|BO|DC|TR|LTR|Aug|BQDC|Input|Op|OP|gl|FRESNO|Case|Reference|Taxpayer|number|date|Information|Action|Required|reply|refer|repjy|LIEN|NOBOD|IB|KO|CAF|Copy)$/i;
// chỉ lọc khi viết thường -- các từ này trùng chữ cái đầu tên thật ("A", "B", "E"...) khi
// viết hoa, phải giữ lại.
const NOISE_WORDS_LOWER_ONLY = /^(a|to|e|b|aa|ap|of|fa|in|id)$/;

function isNoiseToken(t: string): boolean {
  return (
    /^[Iijl1.,'"•=#@:+-]+$/.test(t) ||
    t.length > 15 ||
    /\d/.test(t) ||
    NOISE_WORDS_CI.test(t) ||
    NOISE_WORDS_LOWER_ONLY.test(t) ||
    t.includes("•")
  );
}

function extractName(content: string, patterns: Patterns): { name: string | null; hasCareOf: boolean } {
  const addrMatch = content.match(patterns.addressRe);
  if (!addrMatch || addrMatch.index == null) return { name: null, hasCareOf: false };
  const addrIdx = addrMatch.index;

  // Ranh giới MẶC ĐỊNH của tên là ngay trước dòng "RA SOLUTIONS CORPORATION" (nếu tìm thấy
  // trước địa chỉ) -- đây chính là "hàng nằm ngay trên chữ RA SOLUTIONS CORPORATION" mà tên
  // khách hàng cần lấy. Không tìm thấy (OCR đọc hỏng cụm này) thì lùi về cách cũ, cắt ngay
  // trước địa chỉ.
  const companyMatch = content.slice(0, addrIdx).match(patterns.companyNameRe);
  let boundaryIdx = companyMatch && companyMatch.index != null ? companyMatch.index : addrIdx;

  let hasCareOf = false;
  const pctIdx = content.lastIndexOf("%", boundaryIdx);
  if (pctIdx > -1 && boundaryIdx - pctIdx < DEFAULT_OPTIONS.careOfSearchWindow) {
    boundaryIdx = pctIdx;
    hasCareOf = true;
  }
  const coMatch = content.slice(Math.max(0, boundaryIdx - 60), boundaryIdx).match(/C[/\\]?[0O]\s*RA/i);
  if (coMatch && coMatch.index != null) {
    const coIdx = Math.max(0, boundaryIdx - 60) + coMatch.index;
    if (coIdx < boundaryIdx) boundaryIdx = coIdx;
    hasCareOf = true;
  }

  // Bỏ qua 2 loại boilerplate nằm giữa vùng header/mã vạch đầu trang và tên khách hàng
  // thật: dòng metadata mã vạch thư, và (với thư "LTR ###C") mã văn phòng ngắn kiểu
  // "BO DC : SB".
  const metaLine = content.match(/\d{6}[.+]\d+\s*\.\s*\d+\s*\.\s*\d+\s+\d\s+[A-Z0-9]{2}\s+[\d.]+\s+\d+/);
  const officeCode = content.match(/B[O0]\s*DC\s*:?\s*[A-Z]{1,3}\b/i);
  let startIdx = 0;
  if (metaLine && metaLine.index != null && metaLine.index < boundaryIdx)
    startIdx = Math.max(startIdx, metaLine.index + metaLine[0].length);
  if (officeCode && officeCode.index != null && officeCode.index < boundaryIdx)
    startIdx = Math.max(startIdx, officeCode.index + officeCode[0].length);
  if (startIdx > boundaryIdx) startIdx = 0;

  const tokens = content
    .slice(startIdx, boundaryIdx)
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const tail = tokens.filter((t) => !isNoiseToken(t)).slice(-8);
  return { name: tail.join(" ").trim() || null, hasCareOf };
}

function extractNoticeType(content: string): string | null {
  let m = content.match(/IRS Notice:?\s*(CP\d+[A-Z]?)/i);
  if (m) return m[1].toUpperCase();
  m = content.match(/\b(CP\d+[A-Z]?)\s+[Nn]otice/i);
  if (m) return m[1].toUpperCase();
  // OCR đôi khi tách rời chữ số cuối của mã, vd "Notice   CP52   1" nghĩa là "CP521"
  m = content.match(/[Nn]otice\s+CP\s*(\d{2,3})\s+(\d)\b/);
  if (m) return "CP" + m[1] + m[2];
  m = content.match(/[Nn]otice\s+(CP\d{2,4}[A-Z]?)/i);
  if (m) return m[1].toUpperCase();
  m = content.match(/\bLT\s?(\d{2,4})\b/i);
  if (m) return "LT" + m[1];
  m = content.match(/LTR\s*(\d{2,4})\s*([A-Z])?/i);
  if (m) return "LTR" + m[1] + (m[2] || "C").toUpperCase();
  // Dòng thư "Letter ####C" -- chỉ khớp đúng 3 mã cụ thể (2273C/2840C/4458C) thay vì bắt bất
  // kỳ số 4 chữ số + "C" nào (tránh khớp nhầm số/mã khác xuất hiện đâu đó trong thư), có
  // hoặc không có chữ "Letter" đứng trước (đã gặp cả 2 dạng trong thư thật).
  m = content.match(/(?:Letter\s+)?(2273|2840|4458)C\b/i);
  if (m) return "LTR" + m[1] + "C";
  return null;
}

function extractTaxYear(content: string): string | null {
  let m = content.match(/Tax\s+[Yy]ear[:\s]*\s*(\d{4})/);
  if (m) return m[1];
  m = content.match(/(\d{4})\s+Tax\s+[Yy]ear/i);
  if (m) return m[1];
  m = content.match(/Tax\s+period[s]?\s*:?\s*(?:[A-Za-z]*\s*)?(\d{4})/i);
  if (m) return m[1];
  m = content.match(/20\d{2}12\s*30\s*1/); // vd "202512 30 1" -> tax period 2025
  if (m) return m[0].slice(0, 4);
  // footer trang tiếp theo khi nhãn/giá trị in tách dòng, vd
  // "Page 2 of 8  SB  CP523  2025  August 10, 2026"
  m = content.match(/\bSB\s+CP\d+[A-Z]?\s+(\d{4})\b/);
  if (m) return m[1];
  return null;
}

/**
 * @param pageTexts text từng trang, theo thứ tự (xem extract-text.ts)
 * @returns startPage/endPage 1-indexed, bao gồm cả 2 đầu.
 */
export function detectRecords(pageTexts: string[], options: DetectOptions = {}): IrsNoticeRecord[] {
  const opts: Required<DetectOptions> = { ...DEFAULT_OPTIONS, ...options };
  const patterns = buildPatterns(opts);
  const numPages = pageTexts.length;

  const records: IrsNoticeRecord[] = [];
  let current: IrsNoticeRecord | null = null;

  for (let i = 1; i <= numPages; i++) {
    const content = pageTexts[i - 1] || "";
    const idInfo = extractIdAfterAddress(content, patterns, opts.idAfterAddressWindow);
    const metaId = extractIdFromMetaLine(content);
    const pageOfMatch = content.match(/Page\s+(\d+)\s+o[fF]\s+(\d+|[Il])/i);
    const isPageOne = !!pageOfMatch && pageOfMatch[1] === "1";

    const isNewById = !!idInfo && (!current || idInfo.id !== current.id);
    const isNewByMeta = !!metaId && (!current || metaId !== current.id);
    const isNew = isNewById || isPageOne || isNewByMeta;

    if (isNew) {
      if (current) {
        current.endPage = i - 1;
        current.pageCount = current.endPage - current.startPage + 1;
        records.push(current);
      }
      const { name, hasCareOf } = extractName(content, patterns);
      current = {
        id: idInfo ? idInfo.id : metaId || `p${i}`,
        startPage: i,
        endPage: 0,
        pageCount: 0,
        noticeType: extractNoticeType(content),
        name,
        hasCareOf,
        taxYear: extractTaxYear(content),
      };
    }
    // else: trang tiếp nối -- gộp vào record hiện tại
  }
  if (current) {
    current.endPage = numPages;
    current.pageCount = current.endPage - current.startPage + 1;
    records.push(current);
  }

  // pass 2: 1 số trang đầu thiếu thông tin (taxYear/noticeType/name) chỉ xuất hiện ở trang
  // tiếp nối của cùng record đó
  for (const rec of records) {
    let fullText = "";
    for (let p = rec.startPage; p <= rec.endPage; p++) fullText += (pageTexts[p - 1] || "") + " ";
    if (!rec.taxYear) rec.taxYear = extractTaxYear(fullText);
    if (!rec.noticeType) rec.noticeType = extractNoticeType(fullText);
    if (!rec.name) {
      const { name } = extractName(fullText, patterns);
      rec.name = name;
    }
  }

  // Chỉ nhóm loại thư nằm trong opts.careOfEligibleNoticeTypes (Quản lý thêm/xoá được qua
  // NoticeSplitterCareOfManager, mặc định DEFAULT_CARE_OF_ELIGIBLE_NOTICE_TYPES) mới thật sự
  // cần đánh dấu "Not Update CRM" -- áp dụng SAU pass 2 (lúc noticeType đã hoàn thiện từ cả
  // trang đầu lẫn trang tiếp nối), không phải lúc tạo record ban đầu.
  for (const rec of records) {
    if (rec.hasCareOf && !isCareOfEligibleNoticeType(rec.noticeType, opts.careOfEligibleNoticeTypes)) {
      rec.hasCareOf = false;
    }
  }

  return records;
}
