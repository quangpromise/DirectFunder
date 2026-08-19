"use client";

import { useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { MAX_UPLOAD_BYTES, fetchWithTimeout, readErrorMessage, uploadBytesToBlob } from "@/lib/irs-splitter/client-pdf-upload";

// Đảm bảo dưới 3MB cho MỌI file bất kể nặng bao nhiêu/trang -- xử lý ĐÚNG 1 TRANG/lần gọi
// server (mỗi lần được cấp lại đủ 60s, không cộng dồn) thay vì 1 lần gọi xử lý trọn file.
// Ngưỡng 3MB (đổi từ 1MB, 2026-08-19) cho phép giữ chất lượng ảnh tốt hơn (ít lượt hạ DPI hơn
// mới đạt ngân sách) mà vẫn đủ nhỏ để gửi email/lưu trữ.
const TARGET_BYTES = 3_000_000;
const SAFETY_MARGIN = 0.92;
const DPI_STEPS = [200, 150, 120, 96, 72];
// Số request chạy song song -- giảm thời gian chờ thực tế của người dùng (nhiều lần gọi độc
// lập, không cộng dồn thời gian tuần tự) mà không dồn quá nhiều request cùng lúc.
const CHUNK_CONCURRENCY = 3;

// Trang được gửi THẲNG trong thân request (base64) nếu đủ nhỏ -- ngưỡng để base64 hoá (~+33%)
// vẫn nằm an toàn dưới giới hạn ~4.5MB thân request Serverless Function của Vercel. Trang nặng
// hơn (ảnh scan độ phân giải rất cao, hiếm) rơi về đường dự phòng: upload RIÊNG trang đó (rất
// nhỏ so với cả file) lên Vercel Blob rồi gửi URL -- xem `compress-chunk/route.ts`.
const DIRECT_BODY_MAX_BYTES = 3_000_000;

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

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Cắt riêng 1 trang của `srcDoc` thành 1 file PDF độc lập chỉ chứa đúng trang đó -- gửi trang
 * này lên server thay vì để server tự tải lại TOÀN BỘ file gốc từ Blob mỗi lần gọi (thiết kế
 * cũ). Gặp thật production (2026-08-19): với thiết kế cũ, mỗi request (1 trang/lần) vẫn phải
 * tải lại toàn bộ file gốc -- file nhiều trang khiến số lần tải lặp lại CÙNG 1 blobUrl tăng
 * vọt trong vài giây, bị Vercel Blob trả 403 (nghi ngờ chặn do truy cập dồn dập) và làm fail
 * cả lượt nén dù đã thêm retry. Cắt riêng từng trang loại bỏ hẳn việc tải lặp lại này. */
async function extractSinglePagePdfBytes(srcDoc: PDFDocument, pageIndex: number): Promise<Uint8Array> {
  const singleDoc = await PDFDocument.create();
  const [copiedPage] = await singleDoc.copyPages(srcDoc, [pageIndex - 1]);
  singleDoc.addPage(copiedPage);
  return await singleDoc.save();
}

/** File càng nặng/trang (scan độ phân giải cao) càng cần bỏ qua thẳng các mức DPI cao gần như
 * chắc chắn không vừa ngân sách, đỡ tốn 1 lượt xử lý chắc chắn hỏng. */
function pickStartDpiIndex(avgSourceBytesPerPage: number): number {
  if (avgSourceBytesPerPage > 3_000_000) return 2;
  return 1;
}

interface ChunkAttemptResult {
  pages: Map<number, Uint8Array>;
  totalBytes: number;
  bailed: boolean;
}

/** Chạy 1 lượt xử lý (1 mức DPI) trên TOÀN BỘ trang -- mỗi trang 1 request riêng, chạy song
 * song có giới hạn (`CHUNK_CONCURRENCY`). Dừng sớm (`bailed: true`) ngay khi biết chắc tổng
 * byte đã vượt `TARGET_BYTES` (còn trang chưa xử lý) -- các trang CHƯA bắt đầu sẽ không được
 * dispatch nữa (trang đang xử lý dở vẫn hoàn thành bình thường, kết quả bị bỏ qua). */
async function runDpiAttempt(
  srcDoc: PDFDocument,
  pageCount: number,
  dpi: number,
  perPageBudgetBytes: number,
  allowBail: boolean,
  t: (key: string, vars?: Record<string, string | number>) => string,
  onProgress: (pagesDone: number) => void
): Promise<ChunkAttemptResult> {
  const pages = new Map<number, Uint8Array>();
  let totalBytes = 0;
  let pagesDone = 0;
  let bailed = false;
  let nextPageIndex = 1;
  let firstError: Error | null = null;

  async function worker() {
    while (!bailed && !firstError) {
      const pageIndex = nextPageIndex++;
      if (pageIndex > pageCount) return;

      const pageBytes = await extractSinglePagePdfBytes(srcDoc, pageIndex);
      let requestBody: Record<string, unknown>;
      let pageBlobUrl: string | null = null;
      if (pageBytes.length <= DIRECT_BODY_MAX_BYTES) {
        requestBody = { pagePdfBase64: uint8ArrayToBase64(pageBytes), pageIndex, dpi, perPageBudgetBytes };
      } else {
        const blob = await uploadBytesToBlob(`page-${pageIndex}.pdf`, pageBytes);
        pageBlobUrl = blob.url;
        requestBody = { blobUrl: blob.url, pageIndex, dpi, perPageBudgetBytes };
      }

      const res = await fetchWithTimeout("/api/irs-splitter/compress-chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (pageBlobUrl) {
        fetch("/api/irs-splitter/blob-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobUrl: pageBlobUrl }),
        }).catch(() => {});
      }
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

  const workerCount = Math.min(CHUNK_CONCURRENCY, pageCount);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (firstError) throw firstError;
  return { pages, totalBytes, bailed };
}

/**
 * Tab con "Nén PDF" trong "Notice Splitter" -- chọn 1 file PDF, tự động nén xuống dưới 3MB
 * BẤT KỂ file gốc nặng bao nhiêu. Xử lý ĐÚNG 1 TRANG/lần gọi `/api/irs-splitter/compress-chunk`
 * (né giới hạn 60s/lần của route xử lý), mỗi trang được CẮT RIÊNG thành 1 PDF nhỏ NGAY TRÊN
 * TRÌNH DUYỆT bằng `pdf-lib` rồi gửi thẳng (không qua Vercel Blob cho file gốc nữa -- xem
 * comment ở `extractSinglePagePdfBytes`), rồi tự RÁP LẠI PDF cuối cùng NGAY TRÊN TRÌNH DUYỆT
 * -- đổi lại mất lớp text/copy-paste/search chữ (rasterize toàn bộ trang thành ảnh), đánh đổi
 * đã được người dùng xác nhận chấp nhận.
 */
export function PdfCompressPanel() {
  const t = useT();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [compressProgress, setCompressProgress] = useState<{ dpi: number; pagesDone: number; totalPages: number } | null>(null);
  const [result, setResult] = useState<CompressSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resetAll() {
    setFile(null);
    setCompressProgress(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function compress(f: File) {
    setError(null);
    setResult(null);
    try {
      // Đọc file NGAY TRÊN TRÌNH DUYỆT bằng pdf-lib -- lấy số trang + kích thước point từng
      // trang (cần để ráp lại đúng tỷ lệ sau này), đồng thời giữ luôn `srcDoc` để cắt riêng
      // từng trang gửi lên server (không cần upload cả file lên Blob nữa).
      const srcBytes = new Uint8Array(await f.arrayBuffer());
      const srcDoc = await PDFDocument.load(srcBytes);
      const pageCount = srcDoc.getPageCount();
      if (pageCount === 0) throw new Error(t("compressPdf.compressFailed"));
      const pageSizesPt = Array.from({ length: pageCount }, (_, i) => srcDoc.getPage(i).getSize());

      const perPageBudgetBytes = Math.max(1, Math.floor((TARGET_BYTES * SAFETY_MARGIN) / pageCount));
      const avgSourceBytesPerPage = f.size / pageCount;
      const startDpiIndex = pickStartDpiIndex(avgSourceBytesPerPage);
      const dpiSteps = DPI_STEPS.slice(startDpiIndex);

      let finalAttempt: ChunkAttemptResult | null = null;

      for (const dpi of dpiSteps) {
        setCompressProgress({ dpi, pagesDone: 0, totalPages: pageCount });
        const attempt = await runDpiAttempt(srcDoc, pageCount, dpi, perPageBudgetBytes, true, t, (pagesDone) =>
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
        finalAttempt = await runDpiAttempt(srcDoc, pageCount, floorDpi, perPageBudgetBytes, false, t, (pagesDone) =>
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
      setCompressProgress(null);
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

  const busy = compressProgress !== null;

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
