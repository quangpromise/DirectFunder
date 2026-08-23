"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Plus, Settings, Trash2, Upload, X } from "lucide-react";
import { Spinner } from "@/components/spinner";
import { useT } from "@/lib/i18n";
import { isCareOfEligibleNoticeType } from "@/lib/irs-splitter/care-of-eligibility";
import { detectRecords } from "@/lib/irs-splitter/detect-records";
import { splitPdf } from "@/lib/irs-splitter/split-pdf";
import type { IrsNoticeRecord } from "@/lib/irs-splitter/types";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { useConfirm } from "@/components/confirm-dialog";

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
  const user = useCurrentUser();
  const careOfEligibleNoticeTypes = useAppStore((s) => s.careOfEligibleNoticeTypes);
  const addCareOfEligibleNoticeType = useAppStore((s) => s.addCareOfEligibleNoticeType);
  const removeCareOfEligibleNoticeType = useAppStore((s) => s.removeCareOfEligibleNoticeType);
  const canManageCareOfTypes = user?.role === "manager";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [records, setRecords] = useState<EditableRecord[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managingCareOfTypes, setManagingCareOfTypes] = useState(false);

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
      const detected = detectRecords(pageTexts, { careOfEligibleNoticeTypes });
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
        hasCareOf: r.hasCareOf && isCareOfEligibleNoticeType(r.noticeType, careOfEligibleNoticeTypes),
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
          {canManageCareOfTypes && (
            <button
              onClick={() => setManagingCareOfTypes(true)}
              title={t("irsSplitter.manageCareOfTypes")}
              aria-label={t("irsSplitter.manageCareOfTypes")}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-text-dim transition hover:bg-surface-hover hover:text-text"
            >
              <Settings size={13} />
            </button>
          )}
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

      {managingCareOfTypes && (
        <NoticeSplitterCareOfManager
          types={careOfEligibleNoticeTypes}
          onAdd={addCareOfEligibleNoticeType}
          onRemove={removeCareOfEligibleNoticeType}
          onClose={() => setManagingCareOfTypes(false)}
        />
      )}

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
            <Spinner size={16} />
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
                    const careOfEligible = isCareOfEligibleNoticeType(r.noticeType, careOfEligibleNoticeTypes);
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
                              isCareOfEligibleNoticeType(noticeType, careOfEligibleNoticeTypes)
                                ? { noticeType }
                                : { noticeType, hasCareOf: false }
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
                          title={
                            careOfEligible
                              ? undefined
                              : t("irsSplitter.careOfNotEligible", { list: careOfEligibleNoticeTypes.join(", ") })
                          }
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
                {splitting ? <Spinner size={14} /> : <Download size={14} />}
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

/** Popup quản lý danh sách loại thư tính là "Not Update CRM" (AppConfig.careOfEligibleNoticeTypes)
 * — mở qua nút bánh răng cạnh nút chọn file, chỉ hiện với manager (canManageCareOfTypes). Cùng
 * pattern modal trung tâm với SendCollectingReportDialog (case-refund-status-button.tsx). */
function NoticeSplitterCareOfManager({
  types,
  onAdd,
  onRemove,
  onClose,
}: {
  types: string[];
  onAdd: (noticeType: string) => void;
  onRemove: (noticeType: string) => void;
  onClose: () => void;
}) {
  const [newType, setNewType] = useState("");
  const { confirm, ConfirmDialogUI } = useConfirm();
  const t = useT();

  function handleAdd() {
    if (!newType.trim()) return;
    onAdd(newType);
    setNewType("");
  }

  async function handleRemove(type: string) {
    if (await confirm(t("irsSplitter.careOfRemoveConfirm", { type }), { title: t("irsSplitter.careOfRemoveTitle"), tone: "danger" })) {
      onRemove(type);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 px-4 py-8" onClick={onClose}>
      {ConfirmDialogUI}
      <div
        className="popover max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("irsSplitter.careOfManagerTitle")}</h3>
          <button onClick={onClose} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </div>
        <p className="mb-3 text-xs text-text-faint">{t("irsSplitter.careOfManagerHint")}</p>

        {types.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-faint">{t("irsSplitter.careOfEmpty")}</p>
        ) : (
          <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-0.5">
            {types.map((type) => (
              <div key={type} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-1.5">
                <span className="text-sm">{type}</span>
                <button
                  onClick={() => handleRemove(type)}
                  title={t("common.delete")}
                  className="shrink-0 text-text-faint transition hover:text-red-400"
                  aria-label={t("common.delete")}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex gap-1.5">
          <input
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder={t("irsSplitter.careOfNewTypePlaceholder")}
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={handleAdd}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-border-strong px-3 text-xs font-medium text-text-dim hover:bg-surface-hover hover:text-text"
          >
            <Plus size={12} />
            {t("common.add")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
