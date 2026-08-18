"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Download, FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { useT } from "@/lib/i18n";

interface ApiRecord {
  id: string;
  startPage: number;
  endPage: number;
  noticeType: string | null;
  name: string | null;
  taxYear: string | null;
  hasCareOf: boolean;
}

/** Bản trong bảng soát/sửa — cùng field như ApiRecord nhưng text field không null (input
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

// Vercel giới hạn CỨNG dung lượng request body của Serverless Function (~4.5MB, áp dụng ở
// tầng edge/proxy TRƯỚC KHI request chạm tới route handler của app) — vì vậy file KHÔNG gửi
// thẳng qua route handler của app nữa, mà upload THẲNG lên Vercel Blob từ trình duyệt (client
// upload, xem `upload()` bên dưới + route `/api/irs-splitter/blob-upload`), né hoàn toàn giới
// hạn đó. Ngưỡng dưới đây chỉ còn là chặn hợp lý phía UI (tránh file quá khổ khiến bước phân
// tích/tách vượt `maxDuration=60` của route xử lý), không còn là giới hạn kỹ thuật bắt buộc.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Đọc lỗi từ 1 Response không OK — ưu tiên JSON `{error}` do route handler của app trả về,
 * nhưng fallback an toàn khi response không phải JSON (vd trang lỗi 413 thuần text do chính
 * Vercel platform trả về TRƯỚC route handler, không đi qua code app nên không có dạng JSON
 * quen thuộc — `res.json()` thẳng ở đây từng làm crash với "Unexpected token... is not valid
 * JSON" thay vì hiện thông báo rõ ràng). */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return (data?.error as string | undefined) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Nội dung tab "Notice Splitter" trong popup "For Processor" (`for-processor-dialog.tsx`) —
 * bỏ 1 file PDF gộp nhiều thư IRS (bản scan nhiều khách hàng dồn vào 1 file), tự nhận diện
 * ranh giới từng thư + đoán tên/loại thư/tax year (xem src/lib/irs-splitter), cho soát/sửa
 * trước khi tách thành 1 file PDF/khách hàng đóng gói trong 1 file .zip tải về. Xử lý HOÀN
 * TOÀN trong bộ nhớ của request (2 API route) — không lưu file gốc/record nào xuống DB,
 * client tự giữ File object suốt 2 bước (phân tích -> tách) nên không cần dọn dẹp state tạm
 * ở server. Trước đây là 1 tab riêng trên top-nav (`/dashboard/notice-splitter`) — dời vào
 * đây (2026-08-18) theo yêu cầu, cùng chỗ với báo cáo công việc Processor.
 */
export function NoticeSplitterPanel() {
  const t = useT();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [records, setRecords] = useState<EditableRecord[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetAll() {
    setFile(null);
    setBlobUrl(null);
    setPageCount(null);
    setRecords(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function analyze(f: File) {
    setAnalyzing(true);
    setError(null);
    setRecords(null);
    setPageCount(null);
    setBlobUrl(null);
    try {
      // Upload THẲNG lên Vercel Blob từ trình duyệt (không qua route handler của app) — né
      // giới hạn ~4.5MB thân request của Vercel Serverless Function, xem comment MAX_UPLOAD_BYTES.
      const blob = await upload(f.name, f, {
        access: "public",
        handleUploadUrl: "/api/irs-splitter/blob-upload",
      });
      setBlobUrl(blob.url);

      const res = await fetch("/api/irs-splitter/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl: blob.url }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, t("irsSplitter.analyzeFailed")));
      }
      const data = await res.json();
      setPageCount(data.pageCount as number);
      setRecords(
        (data.records as ApiRecord[]).map((r) => ({
          id: r.id,
          startPage: r.startPage,
          endPage: r.endPage,
          noticeType: r.noticeType ?? "",
          name: r.name ?? "",
          taxYear: r.taxYear ?? "",
          hasCareOf: r.hasCareOf,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("irsSplitter.analyzeFailed"));
    } finally {
      setAnalyzing(false);
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
    await analyze(f);
  }

  function updateRecord(index: number, patch: Partial<EditableRecord>) {
    setRecords((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, ...patch } : r)) : prev));
  }

  function removeRecord(index: number) {
    setRecords((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleSplit() {
    if (!file || !blobUrl || !records || records.length === 0) return;
    setSplitting(true);
    setError(null);
    try {
      const res = await fetch("/api/irs-splitter/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl, fileName: file.name, records }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, t("irsSplitter.splitFailed")));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const a = document.createElement("a");
      a.href = url;
      a.download = match ? match[1] : "split.zip";
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
                  {records.map((r, i) => (
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
                          onChange={(e) => updateRecord(i, { noticeType: e.target.value })}
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
                          onChange={(e) => updateRecord(i, { hasCareOf: e.target.checked })}
                          className="h-4 w-4 accent-[var(--accent)]"
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
                  ))}
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
