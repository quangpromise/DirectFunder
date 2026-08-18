import { extractPageTexts } from "./extract-text";
import { detectRecords, DEFAULT_OPTIONS as DETECT_DEFAULTS } from "./detect-records";
import { splitPdf, buildFilename, sanitizeFilenamePart, DEFAULT_FILENAME_OPTIONS } from "./split-pdf";
import { DetectOptions, FilenameOptions, IrsNoticeRecord, SplitResultFile } from "./types";

export type { DetectOptions, FilenameOptions, IrsNoticeRecord, SplitResultFile };
export { buildFilename, sanitizeFilenamePart, DETECT_DEFAULTS, DEFAULT_FILENAME_OPTIONS };

/**
 * Đọc 1 file PDF scan/OCR gộp nhiều thư IRS và trả về các "record" (1 record = 1 khách
 * hàng), CHƯA tạo file PDF nào — dùng để hiện bảng soát/sửa (khoảng trang, tên, loại thư,
 * tax year, cờ "Not Update CRM") trước khi tách file thật, xem README.md gốc "Accuracy &
 * review": ranh giới trang gần như luôn đúng, nhưng tên/tax year đôi khi cần sửa tay do OCR
 * đọc nhầm.
 */
export async function analyzeIrsPdf(
  pdfData: Uint8Array | Buffer,
  options: DetectOptions = {}
): Promise<{ pageCount: number; records: IrsNoticeRecord[] }> {
  const pageTexts = await extractPageTexts(pdfData);
  const records = detectRecords(pageTexts, options);
  return { pageCount: pageTexts.length, records };
}

/**
 * Tách pdfData thành 1 file PDF cho mỗi record. records thường lấy từ analyzeIrsPdf(), có
 * thể đã sửa tay (khoảng trang, tên, tax year...).
 */
export async function splitIrsPdf(
  pdfData: Uint8Array | Buffer,
  records: IrsNoticeRecord[],
  filenameOptions: FilenameOptions = {}
): Promise<SplitResultFile[]> {
  return splitPdf(pdfData, records, filenameOptions);
}
