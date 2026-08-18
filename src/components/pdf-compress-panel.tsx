"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { MAX_UPLOAD_BYTES, fetchWithTimeout, readErrorMessage, uploadPdfToBlob } from "@/lib/irs-splitter/client-pdf-upload";

interface CompressSummary {
  beforeBytes: number;
  afterBytes: number;
  hitFloor: boolean;
}

function formatKB(bytes: number): string {
  return `${Math.round(bytes / 1024).toLocaleString()} KB`;
}

/**
 * Tab con "Nén PDF" trong "Notice Splitter" -- chọn 1 file PDF, tự động nén xuống dưới 1MB
 * BẤT KỂ file gốc nặng bao nhiêu (xem `src/lib/pdf-compress/compress-pdf.ts` cho thuật toán:
 * rasterize từng trang thành JPEG, đánh đổi mất lớp text/copy-paste/search chữ đã được người
 * dùng xác nhận chấp nhận trước khi làm tính năng này). Không có bước soát/sửa trung gian
 * như tab "Tách thư" -- chọn file là tự động xử lý xong tải về luôn, đơn giản hơn nhiều vì
 * không có gì để soát tay (không tách theo khách hàng, không đoán tên/loại thư).
 */
export function PdfCompressPanel() {
  const t = useT();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [result, setResult] = useState<CompressSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resetAll() {
    setFile(null);
    setUploadProgress(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function compress(f: File) {
    setError(null);
    setResult(null);
    setUploadProgress(0);
    try {
      let blob: { url: string };
      try {
        blob = await uploadPdfToBlob(f, setUploadProgress);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error(t("irsSplitter.uploadTimeout"));
        }
        throw err;
      }
      setUploadProgress(null);
      setCompressing(true);

      const res = await fetchWithTimeout("/api/irs-splitter/compress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl: blob.url, fileName: f.name }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, t("compressPdf.compressFailed")));
      }
      const hitFloor = res.headers.get("X-Compress-Hit-Floor") === "true";
      const afterBytes = Number(res.headers.get("X-Compress-Final-Bytes")) || 0;
      const outBlob = await res.blob();
      const url = URL.createObjectURL(outBlob);
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const a = document.createElement("a");
      a.href = url;
      a.download = match ? match[1] : "compressed.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setResult({ beforeBytes: f.size, afterBytes: afterBytes || outBlob.size, hitFloor });
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
      setCompressing(false);
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

  const busy = uploadProgress !== null || compressing;

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

        {compressing && (
          <div className="flex items-center gap-2 py-8 text-sm text-text-dim">
            <Loader2 size={16} className="animate-spin" />
            {t("compressPdf.compressing")}
          </div>
        )}

        {result && !compressing && (
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
