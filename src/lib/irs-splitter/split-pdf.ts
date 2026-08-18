import { PDFDocument } from "pdf-lib";
import { FilenameOptions, IrsNoticeRecord, SplitResultFile } from "./types";

export const DEFAULT_FILENAME_OPTIONS: Required<FilenameOptions> = {
  // Token dùng được: {noticeType} {taxYear} {name}
  template: "{noticeType} {taxYear} {name}",
  unknownNoticeType: "UNKNOWN",
  unknownTaxYear: "Multiple", // dùng khi 1 record thật sự trải nhiều tax period
  unknownName: "UNKNOWN",
  careOfSuffix: " Not Update CRM",
};

export function sanitizeFilenamePart(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/[\\/:*?"<>|]/g, "");
}

export function buildFilename(record: IrsNoticeRecord, filenameOptions: FilenameOptions = {}): string {
  const opts: Required<FilenameOptions> = { ...DEFAULT_FILENAME_OPTIONS, ...filenameOptions };
  const noticeType = record.noticeType || opts.unknownNoticeType;
  const taxYear = record.taxYear || opts.unknownTaxYear;
  const name = record.name || opts.unknownName;

  let base = opts.template.replace("{noticeType}", noticeType).replace("{taxYear}", taxYear).replace("{name}", name);
  base = sanitizeFilenamePart(base);
  if (record.hasCareOf) base += opts.careOfSuffix;
  return sanitizeFilenamePart(base);
}

/**
 * Tách pdfData thành 1 file PDF cho mỗi record.
 * @param records kết quả detectRecords() (hoặc bản đã sửa tay: gộp/tách lại khoảng trang,
 *   sửa tên/tax year...)
 * @returns filename KHÔNG kèm đuôi ".pdf" và đã tự khử trùng (vd "... (1)") khi 2 record
 *   cho ra cùng 1 tên.
 */
export async function splitPdf(
  pdfData: Uint8Array | Buffer,
  records: IrsNoticeRecord[],
  filenameOptions: FilenameOptions = {}
): Promise<SplitResultFile[]> {
  const data = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);
  const srcDoc = await PDFDocument.load(data);

  const usedNames: Record<string, number> = {};
  const results: SplitResultFile[] = [];

  for (const record of records) {
    const base = buildFilename(record, filenameOptions);
    let filename = base;
    if (usedNames[base] != null) {
      usedNames[base]++;
      filename = `${base} (${usedNames[base]})`;
    } else {
      usedNames[base] = 0;
    }

    const outDoc = await PDFDocument.create();
    const pageIndices: number[] = [];
    for (let p = record.startPage; p <= record.endPage; p++) pageIndices.push(p - 1);
    const copiedPages = await outDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach((pg) => outDoc.addPage(pg));
    const bytes = await outDoc.save();

    results.push({ filename, bytes, record });
  }

  return results;
}
