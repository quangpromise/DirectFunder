"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, RefreshCw, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { REFUND_YEARS } from "@/lib/refund";
import { todayIsoDate } from "@/lib/date-format";
import { useT } from "@/lib/i18n";

interface CrmOption {
  value: string;
  label: string;
}

interface StepResult {
  step: string;
  ok: boolean;
  error?: string;
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Segment 1 năm (KHÔNG kèm tiền tố "Processed & Submitted"/"Submitted") — năm có Tax on INT
 * trừ tiền rồi ghi rõ khoản trừ, năm không có Tax on INT chỉ ghi số tiền sau dấu "-". */
function buildYearSegment(year: string, refunds: Record<string, number>, taxInts: Record<string, string>): string {
  const yy = year.slice(2);
  const amount = refunds[year] ?? 0;
  const taxIntRaw = Number(taxInts[year]);
  const taxInt = Number.isFinite(taxIntRaw) && taxIntRaw > 0 ? taxIntRaw : 0;
  if (taxInt > 0) {
    const net = amount - taxInt;
    return `EC${yy} ${formatMoney(net)} (included EC:${formatMoney(amount)} - ${formatMoney(taxInt)} Tax on INT)`;
  }
  return `EC${yy} - ${formatMoney(amount)}`;
}

/** Tự soạn nội dung Conversation Log theo đúng mẫu đã thống nhất (2026-08-21, chỉnh lại nhiều
 * lần trong ngày — bản cuối):
 * - Đúng 1 năm được chọn: LUÔN viết trên 1 dòng —
 *   không Tax on INT: "Processed & Submitted EC{yy}($refund) - Waiting for CPA Review"
 *   có Tax on INT: "Submitted EC{yy} $net (included EC:$refund - $taxInt Tax on INT). Waiting for CPA Review"
 * - Nhiều năm, KHÔNG năm nào có Tax on INT: viết LIỀN 1 dòng, các năm cách nhau bằng dấu phẩy —
 *   "Processed & Submitted EC{yy1}($refund1), EC{yy2}($refund2)... - Waiting for CPA Review"
 * - Nhiều năm, CÓ ÍT NHẤT 1 năm Tax on INT: dòng đầu LUÔN là "Processed & Submitted" đứng
 *   riêng 1 dòng (không kèm năm nào), MỖI năm xuống dòng riêng (năm không Tax on INT dùng
 *   "EC{yy} - $refund", năm có Tax on INT dùng "EC{yy} $net (included EC:...)"), dòng cuối
 *   cùng luôn là "Waiting for CPA Review" riêng biệt. */
function buildConversationLogText(years: string[], refunds: Record<string, number>, taxInts: Record<string, string>): string {
  if (years.length === 0) return "";
  const sorted = [...years].sort();

  if (sorted.length === 1) {
    const year = sorted[0];
    const taxInt = Number(taxInts[year]);
    const hasTax = Number.isFinite(taxInt) && taxInt > 0;
    const yy = year.slice(2);
    const amount = refunds[year] ?? 0;
    if (hasTax) {
      const net = amount - taxInt;
      return `Submitted EC${yy} ${formatMoney(net)} (included EC:${formatMoney(amount)} - ${formatMoney(taxInt)} Tax on INT). Waiting for CPA Review`;
    }
    return `Processed & Submitted EC${yy}(${formatMoney(amount)}) - Waiting for CPA Review`;
  }

  const hasAnyTaxInt = sorted.some((year) => Number(taxInts[year]) > 0);
  if (hasAnyTaxInt) {
    const lines = ["Processed & Submitted", ...sorted.map((year) => buildYearSegment(year, refunds, taxInts)), "Waiting for CPA Review"];
    return lines.join("\n");
  }

  const segments = sorted.map((year, idx) => {
    const yy = year.slice(2);
    const amount = refunds[year] ?? 0;
    const segment = `EC${yy}(${formatMoney(amount)})`;
    return idx === 0 ? `Processed & Submitted ${segment}` : segment;
  });
  return `${segments.join(", ")} - Waiting for CPA Review`;
}

/** Nút "Update to CRM" — nằm trong popup "Send Data" (`SendActionsMenuButton`, cạnh Send to
 * Sheet/CPA Email/Test Sheet/Client Email — thêm 2026-08-21, trước đó là icon riêng cạnh
 * Status), chỉ hiện nếu hồ sơ đã có `clientLink` trỏ về agentc3 (xem
 * `agentc3-import-dialog.tsx`/`importCaseFromAgentC3`). Icon `RefreshCw` (đổi từ `Send` cùng
 * lúc dời vào popup — tránh trùng icon "gửi" với các hành động khác trong menu, đúng ý nghĩa
 * "đồng bộ/cập nhật" hơn là "gửi 1 chiều"). Mở popup chọn năm (set CPA Review = ngày hôm nay
 * cho năm đã chọn + hiện ô đính kèm file "{năm} 1040X - Submitted" tương ứng), ô Conversation
 * Log kèm dropdown Performed By, và dropdown Status (đọc thẳng từ CRM, KHÔNG phải Status của
 * Direct Funder). Ghi ngược qua `POST /api/agentc3-import/update-to-crm` — mỗi phần (Status/
 * CPA Review, Conversation Log, từng file) chạy độc lập, 1 phần lỗi không chặn phần khác. */
export function AgentC3UpdateToCrmDialog({
  caseId,
  clientName,
  refunds,
}: {
  caseId: string;
  /** Tên Taxpayer (client dòng 1) — hiện cố định ở đầu popup để biết đang cập nhật CRM cho
   * đúng hồ sơ nào (thêm 2026-08-23), tránh nhầm khi mở nhiều popup liên tiếp. */
  clientName: string;
  refunds: Record<string, number>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [statusOptions, setStatusOptions] = useState<CrmOption[]>([]);
  const [performerOptions, setPerformerOptions] = useState<CrmOption[]>([]);

  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [cpaReviewDates, setCpaReviewDates] = useState<Record<string, string>>({});
  const [taxInts, setTaxInts] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [performedBy, setPerformedBy] = useState("");
  const [status, setStatus] = useState("");
  const [processingDate, setProcessingDate] = useState("");

  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<StepResult[] | null>(null);

  // Tự soạn Conversation Log theo năm/Tax on INT đã chọn — CHỈ dùng làm giá trị hiển thị/gửi
  // khi người dùng CHƯA tự gõ tay sửa nội dung (noteDirty), tránh ghi đè mất nội dung họ đã
  // chủ động chỉnh. Tính trực tiếp mỗi render (không qua effect/state) — nhẹ, không cần cache.
  const displayedNote = noteDirty ? note : buildConversationLogText(selectedYears, refunds, taxInts);

  function reset() {
    setSelectedYears([]);
    setCpaReviewDates({});
    setTaxInts({});
    setFiles({});
    setNote("");
    setNoteDirty(false);
    setPerformedBy("");
    setStatus("");
    setProcessingDate("");
    setResults(null);
  }

  async function handleOpen() {
    reset();
    setOpen(true);
    setLoadingContext(true);
    setContextError(null);
    try {
      const ctx = await api.fetchAgentC3CrmContext(caseId);
      setStatusOptions(ctx.statusOptions);
      setPerformerOptions(ctx.performerOptions);
      // Hiện sẵn đúng Status/Processing Date đang có trên CRM — người dùng chỉ cần đổi đúng
      // phần muốn thay, không phải tự tra lại trên CRM trước khi sửa.
      setStatus(ctx.currentStatus);
      setProcessingDate(ctx.currentProcessingDate);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : "Không lấy được dữ liệu CRM");
    } finally {
      setLoadingContext(false);
    }
  }

  function toggleYear(year: string) {
    const willSelect = !selectedYears.includes(year);
    setSelectedYears((prev) => (prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]));
    setFiles((prev) => {
      const next = { ...prev };
      delete next[year];
      return next;
    });
    setCpaReviewDates((prev) => {
      const next = { ...prev };
      if (willSelect) next[year] = todayIsoDate();
      else delete next[year];
      return next;
    });
    setTaxInts((prev) => {
      const next = { ...prev };
      delete next[year];
      return next;
    });
  }

  async function handleSubmit() {
    if (selectedYears.length === 0 && !status && !displayedNote.trim()) return;
    setSaving(true);
    setResults(null);
    try {
      const res = await api.updateAgentC3Crm({
        caseId,
        years: selectedYears,
        cpaReviewDates,
        // Luôn gửi nguyên trạng thái hiện tại của 2 ô này (kể cả rỗng nếu người dùng đã xoá)
        // — cả 2 đều được điền sẵn từ CRM lúc mở popup, rỗng ở đây là chủ động xoá thật.
        status,
        processingDate,
        note: displayedNote.trim() || undefined,
        performedBy: performedBy || undefined,
        files,
      });
      setResults(res.results);
    } catch (err) {
      setResults([{ step: "request", ok: false, error: err instanceof Error ? err.message : "Lỗi không xác định" }]);
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = selectedYears.length > 0 || Boolean(status) || Boolean(displayedNote.trim());

  function stepLabel(step: string): string {
    if (step === "leadInfo") return t("agentc3UpdateCrm.step.leadInfo");
    if (step === "conversationLog") return t("agentc3UpdateCrm.step.conversationLog");
    if (step === "request") return t("agentc3UpdateCrm.step.request");
    const m = /^upload_(\d{4})$/.exec(step);
    if (m) return t("agentc3UpdateCrm.step.upload", { year: m[1] });
    return step;
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        title={t("agentc3UpdateCrm.button")}
        aria-label={t("agentc3UpdateCrm.button")}
        className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <RefreshCw size={11} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
          <div className="popover flex max-h-full w-full max-w-lg flex-col rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5">
              <div>
                <h3 className="text-sm font-semibold">{t("agentc3UpdateCrm.title")}</h3>
                {clientName && <p className="mt-0.5 text-xs text-text-dim">{clientName}</p>}
              </div>
              <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5 pb-5">
              {loadingContext ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-dim">
                  <Loader2 size={16} className="animate-spin" />
                  {t("agentc3UpdateCrm.loadingContext")}
                </div>
              ) : contextError ? (
                <p className="text-xs text-red-400">{contextError}</p>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-text-dim">{t("agentc3UpdateCrm.yearsLabel")}</label>
                    <div className="grid grid-cols-4 gap-2">
                      {REFUND_YEARS.map((year) => {
                        const selected = selectedYears.includes(year);
                        return (
                          <button
                            key={year}
                            type="button"
                            onClick={() => toggleYear(year)}
                            className={`flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 transition ${
                              selected
                                ? "border-accent bg-accent-soft"
                                : "border-border bg-bg-elevated hover:border-accent hover:bg-accent-soft"
                            }`}
                          >
                            <span className="text-sm font-medium">{year}</span>
                            <span
                              className={`text-xs ${
                                selected ? "font-semibold text-amber-600 light:text-amber-700" : "text-text-dim"
                              }`}
                            >
                              ${(refunds?.[year] ?? 0).toLocaleString("en-US")}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[11px] text-text-faint">{t("agentc3UpdateCrm.yearsHint")}</p>
                  </div>

                  {selectedYears.length > 0 && (
                    <div className="flex flex-col gap-3">
                      {selectedYears.map((year) => (
                        <div key={year} className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="mb-1 block text-xs text-text-dim">
                              {t("agentc3UpdateCrm.cpaReviewDateLabel", { year })}
                            </label>
                            <input
                              type="date"
                              value={cpaReviewDates[year] ?? ""}
                              onChange={(e) => setCpaReviewDates((prev) => ({ ...prev, [year]: e.target.value }))}
                              className="w-full rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-text-dim">
                              {t("agentc3UpdateCrm.taxIntLabel", { year })}
                            </label>
                            <input
                              type="number"
                              value={taxInts[year] ?? ""}
                              onChange={(e) => setTaxInts((prev) => ({ ...prev, [year]: e.target.value }))}
                              placeholder="0"
                              className="w-full rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-text-dim">
                              {t("agentc3UpdateCrm.fileLabel", { year })}
                            </label>
                            <input
                              type="file"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                setFiles((prev) => {
                                  const next = { ...prev };
                                  if (f) next[year] = f;
                                  else delete next[year];
                                  return next;
                                });
                              }}
                              className="block w-full text-xs text-text-dim file:mr-2 file:rounded-md file:border-0 file:bg-accent-soft file:px-2 file:py-1 file:text-xs file:text-accent"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-text-dim">{t("agentc3UpdateCrm.statusLabel")}</label>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
                      >
                        <option value="" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                          —
                        </option>
                        {statusOptions.map((o) => (
                          <option key={o.value} value={o.value} style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-text-dim">{t("agentc3UpdateCrm.processingDateLabel")}</label>
                      <input
                        type="date"
                        value={processingDate}
                        onChange={(e) => setProcessingDate(e.target.value)}
                        className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-text-dim">{t("agentc3UpdateCrm.conversationLogLabel")}</label>
                      <textarea
                        value={displayedNote}
                        onChange={(e) => {
                          setNote(e.target.value);
                          setNoteDirty(true);
                        }}
                        rows={4}
                        placeholder={t("agentc3UpdateCrm.conversationLogPlaceholder")}
                        className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
                      />
                    </div>
                    <div className="w-36">
                      <label className="mb-1 block text-xs text-text-dim">{t("agentc3UpdateCrm.performedByLabel")}</label>
                      <select
                        value={performedBy}
                        onChange={(e) => setPerformedBy(e.target.value)}
                        className="w-full rounded-lg border border-border bg-bg-elevated px-2 py-2 text-xs text-text outline-none focus:border-accent"
                      >
                        <option value="" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                          —
                        </option>
                        {performerOptions.map((o) => (
                          <option key={o.value} value={o.value} style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {results && (
                    <div className="flex flex-col gap-1.5">
                      {results.map((r, i) => (
                        <div
                          key={i}
                          className={`rounded-lg border px-3 py-2 text-xs ${
                            r.ok ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"
                          }`}
                        >
                          <span className="font-medium">{stepLabel(r.step)}</span>
                          {": "}
                          {r.ok ? t("agentc3UpdateCrm.stepOk") : r.error}
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={saving || !canSubmit}
                    className="gradient-btn mt-2 flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-white shadow-lg shadow-blue-950/30 disabled:cursor-default disabled:opacity-60"
                  >
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    {saving ? t("agentc3UpdateCrm.saving") : t("agentc3UpdateCrm.submitButton")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
