"use client";

import { useRef, useState } from "react";
import { Download, FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { isCareOfEligibleNoticeType } from "@/lib/irs-splitter/care-of-eligibility";
import { detectRecords } from "@/lib/irs-splitter/detect-records";
import { splitPdf } from "@/lib/irs-splitter/split-pdf";
import type { IrsNoticeRecord } from "@/lib/irs-splitter/types";

// File nặng hơn ngưỡng này có thể khiến trình duyệt xử lý chậm/treo tab (giải mã PDF +
// render text đều chạy trên chính máy người dùng, không còn server nào xử lý hộ nữa).
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Bản trong bảng soát/sửa — cùng field như IrsNoticeRecord nhưng text field không null (input
 * điều khiển được) thay vì null. */
interface EditableRecord {
  id: string;
  startPage: number;
  endPage: number;
  noticeType: string;
  name: string;
  taxYear: string;
  hasCareOf: boolean;
}

function toEditableRecord(r: IrsNoticeRecord): EditableRecord {
  return {
    id: r.id,
    startPage: r.startPage,
    endPage: r.endPage,
    noticeType: r.noticeType ?? "",
    name: r.name ?? "",
    taxYear: r.taxYear ?? "",
    hasCareOf: r.hasCareOf,
  };
}

/**
 * Tab "Notice Splitter" trong popup "For Processor" (`for-processor-dialog.tsx`) — bỏ 1 file
 * PDF gộp nhiều thư IRS (bản scan nhiều khách hàng dồn vào 1 file), tự nhận diện ranh giới
 * từng thư + đoán tên/loại thư/tax year (xem src/lib/irs-splitter), cho soát/sửa trước khi
 * tách thành 1 file PDF/khách hàng đóng gói trong 1 file .zip tải về.
 *
 * Xử lý HOÀN TOÀN trong trình duyệt (2026-08-19, đổi từ kiến trúc server + Vercel Blob) --
 * `pdfjs-dist` bản trình duyệt (extract-text-browser.ts) trích text, `pdf-lib`/`jszip` (đã là
 * dependency isomorphic sẵn có) tách trang + đóng gói zip, tất cả ngay trên máy người dùng.
 * File scan gốc (có thể chứa SSN) KHÔNG BAO GIỜ rời khỏi trình duyệt -- không còn route server
 * nào (`analyze`/`split`/`blob-upload` đã xoá), không còn phụ thuộc Vercel Blob cho tính năng
 * này. Đổi lại: xử lý tốn CPU máy người dùng thay vì server, và không còn bị giới hạn cứng
 * `maxDuration=60s` của Vercel Hobby -- loại bỏ hẳn lớp lỗi timeout/504/403 từng gặp khi
 * tính năng "Nén PDF" (đã bỏ hẳn) còn dùng kiến trúc server.
 *
 * `pdfjs-dist`/`jszip` chỉ tải (lazy-import) khi người dùng THẬT SỰ chọn file, không cộng dồn
 * vào bundle chính của Dashboard -- ai không dùng tab này không tải thêm gì.
 */
export function NoticeSplitterPanel() {
  const t = useT();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [records, setRecords] = useState<EditableRecord[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetAll() {
    setFile(null);
    setPageCount(null);
    setRecords(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function analyze(f: File) {
    setError(null);
    setRecords(null);
    setPageCount(null);
    setAnalyzing(true);
    try {
      const { extractPageTextsBrowser } = await import("@/lib/irs-splitter/extract-text-browser");
      const bytes = new Uint8Array(await f.arrayBuffer());
      const pageTexts = await extractPageTextsBrowser(bytes);
      const detected = detectRecords(pageTexts);
      setPageCount(pageTexts.length);
      setRecords(detected.map(toEditableRecord));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("irsSplitter.analyzeFailed"));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setFile(f);
      setError(t("irsSplitter.fileTooLarge"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(f);
    await analyze(f);
  }

  function updateRecord(index: number, patch: Partial<EditableRecord>) {
    setRecords((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, ...patch } : r)) : prev));
  }

  function removeRecord(index: number) {
    setRecords((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleSplit() {
    if (!file || !records || records.length === 0) return;
    setSplitting(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fullRecords: IrsNoticeRecord[] = records.map((r) => ({
        id: r.id,
        startPage: r.startPage,
        endPage: r.endPage,
        pageCount: r.endPage - r.startPage + 1,
        noticeType: r.noticeType.trim() || null,
        name: r.name.trim() || null,
        taxYear: r.taxYear.trim() || null,
        hasCareOf: r.hasCareOf && isCareOfEligibleNoticeType(r.noticeType),
      }));
      const files = await splitPdf(bytes, fullRecords);

      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const f of files) zip.file(`${f.filename}.pdf`, f.bytes);
      const zipBytes = await zip.generateAsync({ type: "uint8array" });

      const zipName = file.name.replace(/\.pdf$/i, "") || "notices";
      const blob = new Blob([new Uint8Array(zipBytes)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${zipName} - split.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("irsSplitter.splitFailed"));
    } finally {
      setSplitting(false);
    }
  }

  const busy = analyzing || splitting;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="truncate text-xs text-text-faint">{file ? file.name : t("irsSplitter.intro")}</p>
        <div className="flex shrink-0 items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" hidden onChange={handleFileSelected} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
          >
            <Upload size={12} />
            {file ? t("irsSplitter.changeFile") : t("irsSplitter.chooseFile")}
          </button>
          {(file || records) && (
            <button
              onClick={resetAll}
              disabled={busy}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
            >
              <X size={12} />
              {t("irsSplitter.reset")}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {!file && (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
            <FileText size={40} className="text-text-faint" />
            <p className="max-w-md text-sm text-text-dim">{t("irsSplitter.intro")}</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="gradient-btn flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-white shadow-lg shadow-blue-950/30"
            >
              <Upload size={14} />
              {t("irsSplitter.chooseFile")}
            </button>
            <p className="text-xs text-text-faint">{t("irsSplitter.maxSizeHint")}</p>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
        )}

        {file && pageCount != null && (
          <p className="mb-3 text-xs text-text-faint">{t("irsSplitter.pageCount", { count: pageCount })}</p>
        )}

        {analyzing && (
          <div className="flex items-center gap-2 py-8 text-sm text-text-dim">
            <Loader2 size={16} className="animate-spin" />
            {t("irsSplitter.analyzing")}
          </div>
        )}

        {records && records.length > 0 && !analyzing && (
          <>
            <p className="mb-3 text-xs text-text-faint">{t("irsSplitter.reviewHint")}</p>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-table-head-bg text-xs text-table-head-text">
                    <th className="w-24 px-2 py-2 text-left font-medium">{t("irsSplitter.col.pages")}</th>
                    <th className="px-2 py-2 text-left font-medium">{t("irsSplitter.col.noticeType")}</th>
                    <th className="px-2 py-2 text-left font-medium">{t("irsSplitter.col.taxYear")}</th>
                    <th className="px-2 py-2 text-left font-medium">{t("irsSplitter.col.name")}</th>
                    <th className="w-28 px-2 py-2 text-center font-medium">{t("irsSplitter.col.careOf")}</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => {
                    const careOfEligible = isCareOfEligibleNoticeType(r.noticeType);
                    return (
                    <tr key={i} className="border-b border-border last:border-b-0 hover:bg-surface-hover">
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            value={r.startPage}
                            onChange={(e) => updateRecord(i, { startPage: Number(e.target.value) })}
                            className="w-14 rounded border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent"
                          />
                          <span className="text-text-faint">–</span>
                          <input
                            type="number"
                            min={r.startPage}
                            value={r.endPage}
                            onChange={(e) => updateRecord(i, { endPage: Number(e.target.value) })}
                            className="w-14 rounded border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={r.noticeType}
                          onChange={(e) => {
                            const noticeType = e.target.value;
                            updateRecord(
                              i,
                              isCareOfEligibleNoticeType(noticeType) ? { noticeType } : { noticeType, hasCareOf: false }
                            );
                          }}
                          placeholder="CP504..."
                          className="w-full min-w-[90px] rounded border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={r.taxYear}
                          onChange={(e) => updateRecord(i, { taxYear: e.target.value })}
                          placeholder="2025"
                          className="w-20 rounded border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={r.name}
                          onChange={(e) => updateRecord(i, { name: e.target.value })}
                          className="w-full min-w-[180px] rounded border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={r.hasCareOf}
                          disabled={!careOfEligible}
                          title={careOfEligible ? undefined : t("irsSplitter.careOfNotEligible")}
                          onChange={(e) => updateRecord(i, { hasCareOf: e.target.checked })}
                          className="h-4 w-4 accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-30"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => removeRecord(i)}
                          title={t("common.delete")}
                          className="text-text-faint transition hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleSplit}
                disabled={splitting}
                className="gradient-btn flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-white shadow-lg shadow-blue-950/30 disabled:cursor-default disabled:opacity-60"
              >
                {splitting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {splitting ? t("irsSplitter.splitting") : t("irsSplitter.splitAndDownload", { count: records.length })}
              </button>
            </div>
          </>
        )}

        {records && records.length === 0 && !analyzing && (
          <p className="py-8 text-center text-sm text-text-faint">{t("irsSplitter.noRecords")}</p>
        )}
      </div>
    </div>
  );
}
