"use client";

import { useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { MAX_UPLOAD_BYTES, fetchWithTimeout, readErrorMessage, uploadPdfToBlob } from "@/lib/irs-splitter/client-pdf-upload";

// Đảm bảo dưới 3MB cho MỌI file bất kể nặng bao nhiêu/trang -- xử lý theo TỪNG KHOẢNG TRANG
// nhỏ, gọi server nhiều lần (mỗi lần được cấp lại đủ 60s, không cộng dồn) thay vì 1 lần gọi
// xử lý trọn file. Gặp thật trên production (2026-08-18): file 15 trang/48MB (~3.2MB/trang)
// vượt quá 60s nếu xử lý trong 1 lần gọi -- riêng bước GIẢI MÃ ảnh gốc độ phân giải cao của
// từng trang đã tốn nhiều giây, cộng dồn nhiều trang thì vượt giới hạn cứng của gói Hobby.
// Ngưỡng 3MB (đổi từ 1MB, 2026-08-19) cho phép giữ chất lượng ảnh tốt hơn (ít lượt hạ DPI hơn
// mới đạt ngân sách) mà vẫn đủ nhỏ để gửi email/lưu trữ -- kiến trúc chunk không đổi gì khác,
// chỉ 1 hằng số này quyết định ngưỡng đích.
const TARGET_BYTES = 3_000_000;
const SAFETY_MARGIN = 0.92;
const DPI_STEPS = [200, 150, 120, 96, 72];
// Số request chunk chạy song song -- giảm thời gian chờ thực tế của người dùng (nhiều lần
// gọi độc lập, không cộng dồn thời gian tuần tự) mà không dồn quá nhiều request cùng lúc.
const CHUNK_CONCURRENCY = 3;

interface CompressSummary {
  beforeBytes: number;
  afterBytes: number;
  hitFloor: boolean;
}

function formatKB(bytes: number): string {
  return `${Math.round(bytes / 1024).toLocaleString()} KB`;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** File càng nặng/trang (scan độ phân giải cao) càng cần khoảng trang nhỏ hơn mỗi lần gọi
 * server, để riêng bước giải mã ảnh gốc của khoảng đó không vượt 60s. Ngưỡng đã giảm mạnh
 * (2026-08-19, gặp thật với file 10MB/10-50 trang -- nhánh "nhẹ" cũ gộp tới 8 trang/lần gọi
 * ở DPI 200 và bị timeout dù không có ảnh nặng): chi phí render+encode PDF nội dung thật
 * (chữ/vector phức tạp) không tỉ lệ thuần theo dung lượng file như ảnh scan, nên kể cả file
 * "nhẹ" cũng cần khoảng trang nhỏ để an toàn trong 60s. */
function pickChunkPageCount(avgSourceBytesPerPage: number): number {
  if (avgSourceBytesPerPage > 3_000_000) return 1;
  if (avgSourceBytesPerPage > 1_000_000) return 2;
  return 3;
}

/** Cùng lý do -- bỏ qua thẳng các mức DPI cao gần như chắc chắn không vừa ngân sách với file
 * nặng/trang, đỡ tốn 1 lượt xử lý chắc chắn hỏng. File "nhẹ" giờ cũng bắt đầu ở DPI 150 thay
 * vì 200 (giảm chi phí render lần đầu, xem lý do ở pickChunkPageCount). */
function pickStartDpiIndex(avgSourceBytesPerPage: number): number {
  if (avgSourceBytesPerPage > 3_000_000) return 2;
  return 1;
}

function buildPageRanges(pageCount: number, chunkPageCount: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let start = 1; start <= pageCount; start += chunkPageCount) {
    ranges.push([start, Math.min(start + chunkPageCount - 1, pageCount)]);
  }
  return ranges;
}

interface ChunkAttemptResult {
  pages: Map<number, Uint8Array>;
  totalBytes: number;
  bailed: boolean;
}

/** Chạy 1 lượt xử lý (1 mức DPI) trên TOÀN BỘ trang -- chia thành nhiều request chunk, chạy
 * song song có giới hạn (`CHUNK_CONCURRENCY`). Dừng sớm (`bailed: true`) ngay khi biết chắc
 * tổng byte đã vượt `TARGET_BYTES` (còn trang chưa xử lý) -- các chunk CHƯA bắt đầu sẽ không
 * được dispatch nữa (chunk đang chạy dở vẫn hoàn thành bình thường, kết quả bị bỏ qua). */
async function runDpiAttempt(
  blobUrl: string,
  pageCount: number,
  dpi: number,
  perPageBudgetBytes: number,
  chunkPageCount: number,
  allowBail: boolean,
  t: (key: string, vars?: Record<string, string | number>) => string,
  onProgress: (pagesDone: number) => void
): Promise<ChunkAttemptResult> {
  const ranges = buildPageRanges(pageCount, chunkPageCount);
  const pages = new Map<number, Uint8Array>();
  let totalBytes = 0;
  let pagesDone = 0;
  let bailed = false;
  let nextRangeIndex = 0;
  let firstError: Error | null = null;

  async function worker() {
    while (!bailed && !firstError) {
      const idx = nextRangeIndex++;
      if (idx >= ranges.length) return;
      const [startPage, endPage] = ranges[idx];
      const res = await fetchWithTimeout("/api/irs-splitter/compress-chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl, startPage, endPage, dpi, perPageBudgetBytes }),
      });
      if (!res.ok) {
        firstError = new Error(await readErrorMessage(res, t("compressPdf.compressFailed")));
        return;
      }
      const data = await res.json();
      for (const p of data.pages as { pageIndex: number; jpegBase64: string }[]) {
        const bytes = base64ToUint8Array(p.jpegBase64);
        pages.set(p.pageIndex, bytes);
        totalBytes += bytes.length;
        pagesDone++;
      }
      onProgress(pagesDone);
      if (allowBail && totalBytes > TARGET_BYTES && pagesDone < pageCount) {
        bailed = true;
      }
    }
  }

  const workerCount = Math.min(CHUNK_CONCURRENCY, ranges.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (firstError) throw firstError;
  return { pages, totalBytes, bailed };
}

/**
 * Tab con "Nén PDF" trong "Notice Splitter" -- chọn 1 file PDF, tự động nén xuống dưới 3MB
 * BẤT KỂ file gốc nặng bao nhiêu. Xử lý theo TỪNG KHOẢNG TRANG qua nhiều lần gọi
 * `/api/irs-splitter/compress-chunk` (né giới hạn 60s/lần của route xử lý, xem comment
 * TARGET_BYTES phía trên), rồi tự RÁP LẠI PDF cuối cùng NGAY TRÊN TRÌNH DUYỆT bằng `pdf-lib`
 * (không cần thêm 1 lần gọi server để ráp) -- đổi lại mất lớp text/copy-paste/search chữ
 * (rasterize toàn bộ trang thành ảnh), đánh đổi đã được người dùng xác nhận chấp nhận.
 */
export function PdfCompressPanel() {
  const t = useT();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [compressProgress, setCompressProgress] = useState<{ dpi: number; pagesDone: number; totalPages: number } | null>(null);
  const [result, setResult] = useState<CompressSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resetAll() {
    setFile(null);
    setUploadProgress(null);
    setCompressProgress(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function compress(f: File) {
    setError(null);
    setResult(null);
    setUploadProgress(0);
    let blobUrl: string | null = null;
    try {
      // Đọc file NGAY TRÊN TRÌNH DUYỆT bằng pdf-lib trước khi upload -- lấy số trang + kích
      // thước point từng trang (cần để ráp lại đúng tỷ lệ sau này), không cần gọi server cho
      // việc này.
      const srcBytes = new Uint8Array(await f.arrayBuffer());
      const srcDoc = await PDFDocument.load(srcBytes);
      const pageCount = srcDoc.getPageCount();
      if (pageCount === 0) throw new Error(t("compressPdf.compressFailed"));
      const pageSizesPt = Array.from({ length: pageCount }, (_, i) => srcDoc.getPage(i).getSize());

      const perPageBudgetBytes = Math.max(1, Math.floor((TARGET_BYTES * SAFETY_MARGIN) / pageCount));
      const avgSourceBytesPerPage = f.size / pageCount;
      const chunkPageCount = pickChunkPageCount(avgSourceBytesPerPage);
      const startDpiIndex = pickStartDpiIndex(avgSourceBytesPerPage);
      const dpiSteps = DPI_STEPS.slice(startDpiIndex);

      let blob: { url: string };
      try {
        blob = await uploadPdfToBlob(f, setUploadProgress);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error(t("irsSplitter.uploadTimeout"));
        }
        throw err;
      }
      blobUrl = blob.url;
      setUploadProgress(null);

      let finalAttempt: ChunkAttemptResult | null = null;

      for (const dpi of dpiSteps) {
        setCompressProgress({ dpi, pagesDone: 0, totalPages: pageCount });
        const attempt = await runDpiAttempt(blob.url, pageCount, dpi, perPageBudgetBytes, chunkPageCount, true, t, (pagesDone) =>
          setCompressProgress({ dpi, pagesDone, totalPages: pageCount })
        );
        finalAttempt = attempt;
        if (!attempt.bailed && attempt.totalBytes <= TARGET_BYTES) break;
      }

      let hitFloor = false;
      if (!finalAttempt || finalAttempt.bailed || finalAttempt.totalBytes > TARGET_BYTES) {
        // Mọi mức DPI đều hỏng/bail sớm -- chạy lại đúng 1 lần ở DPI sàn KHÔNG cho bail sớm,
        // để luôn có đủ toàn bộ trang trả về (dù vẫn vượt 3MB) thay vì 1 bản dở dang.
        const floorDpi = DPI_STEPS[DPI_STEPS.length - 1];
        setCompressProgress({ dpi: floorDpi, pagesDone: 0, totalPages: pageCount });
        finalAttempt = await runDpiAttempt(blob.url, pageCount, floorDpi, perPageBudgetBytes, chunkPageCount, false, t, (pagesDone) =>
          setCompressProgress({ dpi: floorDpi, pagesDone, totalPages: pageCount })
        );
        hitFloor = true;
      }
      setCompressProgress(null);

      // Ráp PDF cuối cùng NGAY TRÊN TRÌNH DUYỆT -- không cần thêm 1 lần gọi server.
      const outDoc = await PDFDocument.create();
      for (let i = 1; i <= pageCount; i++) {
        const jpegBytes = finalAttempt.pages.get(i);
        const { width, height } = pageSizesPt[i - 1];
        if (!jpegBytes) {
          // Trang bị bỏ sót (không nên xảy ra với allowBail=false ở lượt cuối, nhưng phòng
          // hờ) -- chèn 1 trang trắng đúng kích thước thay vì làm hỏng cả file.
          outDoc.addPage([width, height]);
          continue;
        }
        const embedded = await outDoc.embedJpg(jpegBytes);
        const pdfPage = outDoc.addPage([width, height]);
        pdfPage.drawImage(embedded, { x: 0, y: 0, width, height });
      }
      const finalBytes = await outDoc.save();

      const outBlob = new Blob([new Uint8Array(finalBytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(outBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${f.name.replace(/\.pdf$/i, "")} - compressed.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setResult({ beforeBytes: f.size, afterBytes: finalBytes.length, hitFloor });
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "AbortError"
          ? t("irsSplitter.processingTimeout")
          : err instanceof Error
            ? err.message
            : t("compressPdf.compressFailed")
      );
    } finally {
      setUploadProgress(null);
      setCompressProgress(null);
      if (blobUrl) {
        fetch("/api/irs-splitter/blob-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobUrl }),
        }).catch(() => {});
      }
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) {
      setFile(f);
      setError(t("irsSplitter.fileTooLarge"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(f);
    await compress(f);
  }

  const busy = uploadProgress !== null || compressProgress !== null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="truncate text-xs text-text-faint">{file ? file.name : t("compressPdf.intro")}</p>
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
          {(file || result) && (
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
            <p className="max-w-md text-sm text-text-dim">{t("compressPdf.intro")}</p>
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

        {uploadProgress !== null && (
          <div className="flex flex-col gap-2 py-8">
            <div className="flex items-center gap-2 text-sm text-text-dim">
              <Loader2 size={16} className="animate-spin" />
              {t("irsSplitter.uploading", { percent: Math.round(uploadProgress) })}
            </div>
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        )}

        {compressProgress !== null && (
          <div className="flex flex-col gap-2 py-8">
            <div className="flex items-center gap-2 text-sm text-text-dim">
              <Loader2 size={16} className="animate-spin" />
              {t("compressPdf.compressingProgress", { done: compressProgress.pagesDone, total: compressProgress.totalPages, dpi: compressProgress.dpi })}
            </div>
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${(compressProgress.pagesDone / Math.max(1, compressProgress.totalPages)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {result && !compressProgress && (
          <div className="flex flex-col gap-3 py-4">
            <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-400 light:text-green-700">
              <CheckCircle2 size={16} className="shrink-0" />
              {t("compressPdf.result", { before: formatKB(result.beforeBytes), after: formatKB(result.afterBytes) })}
            </div>
            {result.hitFloor && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-500 light:text-amber-700">
                {t("compressPdf.hitFloorWarning", { after: formatKB(result.afterBytes) })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
