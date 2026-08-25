"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";
import { Spinner } from "@/components/spinner";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { api } from "@/lib/api-client";
import type { AgentC3ImportPreview } from "@/lib/api-client";
import type { AgentC3ImportFields, ClientNameEntry } from "@/lib/types";
import { REFUND_YEARS } from "@/lib/refund";
import { fullName, getFullName } from "@/lib/client-name";
import { useT } from "@/lib/i18n";

/** Xây `AgentC3ImportFields` auto (không sửa tay) từ 1 kết quả preview — dùng chung cho cả
 * luồng 1 link (bước xem trước, người dùng còn sửa tay tiếp) lẫn luồng nhiều link (xử lý
 * thẳng theo đúng auto-match, không dừng lại hỏi từng hồ sơ). */
function buildFieldsFromPreview(preview: AgentC3ImportPreview): AgentC3ImportFields {
  const refunds: Record<string, number> = {};
  for (const year of REFUND_YEARS) {
    const n = Number(preview.refunds[year]);
    refunds[year] = Number.isFinite(n) ? n : 0;
  }
  return {
    taxpayer: preview.taxpayer,
    spouse: preview.spouse,
    ssn: preview.ssn,
    spouseSsn: preview.spouseSsn,
    dob: preview.dob,
    spouseDob: preview.spouseDob,
    phone: preview.phone1,
    phone2: preview.phone2,
    email: preview.email1,
    address: preview.address,
    zipcode: preview.zipIrs,
    refunds,
    statusId: preview.matchedStatusId,
    agentUserId: preview.matchedAgentUserId,
    bankName: preview.bankName || null,
    routingNumber: preview.routingNumber || null,
    accountNumber: preview.accountNumber || null,
    fcDate: preview.fcDate,
    elDate: preview.elDate,
  };
}

interface BatchResultRow {
  link: string;
  name: string;
  status: "created" | "updated" | "skipped" | "error";
  message: string;
}

/** Nút + dialog trên toolbar bảng Hồ sơ — dán link 1 hồ sơ khách hàng trên CRM ngoài
 * `tax.agentc3.com`, xem trước dữ liệu đã đọc/tự khớp Status-Agent, sửa tay nếu cần rồi
 * tạo hồ sơ mới (SSN chưa có) hoặc điền thêm vào hồ sơ có sẵn (SSN đã trùng, chỉ điền ô
 * trống — xem `importCaseFromAgentC3`, `POST /api/agentc3-import/fetch`). */
export function AgentC3ImportDialog() {
  const t = useT();
  const user = useCurrentUser();
  const users = useAppStore((s) => s.users);
  const columns = useAppStore((s) => s.columns);
  const importCaseFromAgentC3 = useAppStore((s) => s.importCaseFromAgentC3);

  const [open, setOpen] = useState(false);
  const [linksText, setLinksText] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AgentC3ImportPreview | null>(null);
  const [fields, setFields] = useState<AgentC3ImportFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<BatchResultRow[] | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchDone, setBatchDone] = useState(0);

  // "agent_leader" cũng đảm nhận được slot Agent trên hồ sơ (cùng điều kiện `agentUsers` ở
  // cases/page.tsx, và server đã khớp CẢ role này — xem POST /api/agentc3-import/fetch) — bỏ
  // sót role này khiến <select> không có <option> cho agent_leader đã khớp đúng, hiện trống dù
  // `fields.agentUserId` thực ra đã đúng (lỗi thật gặp trên production: CRM khớp đúng "Linda"
  // — agent_leader — nhưng dropdown hiện "—" như chưa khớp gì).
  const agentUsers = users.filter((u) => u.role === "agent" || u.role === "agent_leader");
  const statusOptions = columns.find((c) => c.id === "status")?.options ?? [];
  const links = linksText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  function reset() {
    setLinksText("");
    setFetching(false);
    setFetchError(null);
    setPreview(null);
    setFields(null);
    setSaving(false);
    setSaveError(null);
    setBatchResults(null);
    setBatchRunning(false);
    setBatchDone(0);
  }

  async function handleFetch() {
    if (links.length === 0) return;
    if (links.length > 1) return handleBatchImport();
    setFetching(true);
    setFetchError(null);
    try {
      const result = await api.fetchAgentC3Preview(links[0]);
      setPreview(result);
      setFields(buildFieldsFromPreview(result));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Không lấy được dữ liệu");
    } finally {
      setFetching(false);
    }
  }

  /** Nhiều link cùng lúc — xử lý TUẦN TỰ (giống importCases nhập Excel, tránh caseNumber
   * trùng do các request tạo hồ sơ chạy song song đọc cùng 1 giá trị max), tự động lưu
   * thẳng theo đúng dữ liệu CRM/auto-match Status-Agent (KHÔNG dừng lại cho sửa tay từng hồ
   * sơ — nếu cần sửa tay 1 hồ sơ cụ thể, dùng lại đúng link đó ở chế độ 1 link). */
  async function handleBatchImport() {
    if (!user) return;
    setBatchRunning(true);
    setBatchResults([]);
    setBatchDone(0);
    const results: BatchResultRow[] = [];
    for (const link of links) {
      let name = link;
      try {
        const p = await api.fetchAgentC3Preview(link);
        const f = buildFieldsFromPreview(p);
        name = fullName(f.taxpayer) || p.customerId;
        const r = await importCaseFromAgentC3(
          p.existingCase?.id ?? null,
          p.existingCase,
          f,
          p.customerId,
          p.sourceUrl,
          user.id,
          user.role
        );
        if (!r.ok) {
          results.push({ link, name, status: "error", message: r.error });
        } else if (r.skippedNoChanges) {
          results.push({ link, name, status: "skipped", message: t("agentc3Import.noChanges") });
        } else {
          results.push({
            link,
            name,
            status: r.created ? "created" : "updated",
            message: r.created ? t("agentc3Import.batchCreated") : t("agentc3Import.batchUpdated"),
          });
        }
      } catch (err) {
        results.push({ link, name, status: "error", message: err instanceof Error ? err.message : "Lỗi" });
      }
      setBatchDone((d) => d + 1);
      setBatchResults([...results]);
    }
    setBatchRunning(false);
  }

  async function handleSave() {
    if (!fields || !preview || !user) return;
    setSaving(true);
    setSaveError(null);
    const result = await importCaseFromAgentC3(
      preview.existingCase?.id ?? null,
      preview.existingCase,
      fields,
      preview.customerId,
      preview.sourceUrl,
      user.id,
      user.role
    );
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    if (result.skippedNoChanges) {
      setSaveError(t("agentc3Import.noChanges"));
      return;
    }
    reset();
    setOpen(false);
  }

  function patch(p: Partial<AgentC3ImportFields>) {
    setFields((f) => (f ? { ...f, ...p } : f));
  }
  function patchName(who: "taxpayer" | "spouse", p: Partial<ClientNameEntry>) {
    setFields((f) => (f ? { ...f, [who]: { ...f[who], ...p } } : f));
  }

  const existing = preview?.existingCase ?? null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t("agentc3Import.button")}
        className="flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <Download size={12} />
        {t("agentc3Import.button")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-8">
          <div className="popover flex max-h-full w-full max-w-lg flex-col rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5">
              <h3 className="text-sm font-semibold">{t("agentc3Import.title")}</h3>
              <button
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
                className="text-text-faint hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5 pb-5">
              {batchResults !== null ? (
                <>
                  <p className="text-xs text-text-dim">
                    {batchRunning
                      ? t("agentc3Import.batchRunning", { done: String(batchDone), total: String(links.length) })
                      : t("agentc3Import.batchDone", { count: String(batchResults.length) })}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {batchResults.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                        <span
                          className={
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium " +
                            (r.status === "created"
                              ? "bg-green-500/15 text-green-300"
                              : r.status === "updated"
                                ? "bg-blue-500/15 text-blue-300"
                                : r.status === "skipped"
                                  ? "bg-white/10 text-text-faint"
                                  : "bg-red-500/15 text-red-300")
                          }
                        >
                          {t(`agentc3Import.batch${r.status[0].toUpperCase()}${r.status.slice(1)}`)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-text" title={r.link}>
                          {r.name}
                        </span>
                        <span className="max-w-[45%] truncate text-text-faint" title={r.message}>
                          {r.message}
                        </span>
                      </div>
                    ))}
                    {batchRunning && links.length > batchResults.length && (
                      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-text-faint">
                        <Spinner size={12} />
                        {links[batchResults.length]}
                      </div>
                    )}
                  </div>
                  {!batchRunning && (
                    <button
                      onClick={reset}
                      className="gradient-btn flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-white shadow-lg shadow-blue-950/30"
                    >
                      {t("agentc3Import.back")}
                    </button>
                  )}
                </>
              ) : !fields ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-text-dim">{t("agentc3Import.linkLabel")}</label>
                    <textarea
                      autoFocus
                      rows={4}
                      value={linksText}
                      onChange={(e) => setLinksText(e.target.value)}
                      placeholder={t("agentc3Import.linkPlaceholder")}
                      className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                    />
                    <p className="mt-1 text-[11px] text-text-faint">{t("agentc3Import.linkMultiHint")}</p>
                  </div>
                  {fetchError && <p className="text-xs text-red-400">{fetchError}</p>}
                  <button
                    onClick={handleFetch}
                    disabled={fetching || links.length === 0}
                    className="gradient-btn flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-white shadow-lg shadow-blue-950/30 disabled:cursor-default disabled:opacity-60"
                  >
                    {fetching && <Spinner size={14} />}
                    {fetching
                      ? t("agentc3Import.fetching")
                      : links.length > 1
                        ? t("agentc3Import.batchButton", { count: String(links.length) })
                        : t("agentc3Import.fetchButton")}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => { setFields(null); setPreview(null); setSaveError(null); }} className="self-start text-xs text-accent hover:underline">
                    ← {t("agentc3Import.back")}
                  </button>

                  {existing ? (
                    <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
                      {t("agentc3Import.existingCaseBanner", { name: getFullName(existing) || existing.id })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-300">
                      {t("agentc3Import.newCaseTitle")}
                    </div>
                  )}

                  {saveError && <p className="text-xs text-red-400">{saveError}</p>}

                  <NameFieldPair
                    label1={t("agentc3Import.taxpayerFirstName")}
                    label2={t("agentc3Import.taxpayerLastName")}
                    value={fields.taxpayer}
                    lockedValue={existing && (existing.clients[0].firstName || existing.clients[0].lastName) ? existing.clients[0] : null}
                    lockedLabel={t("agentc3Import.existingFieldLocked")}
                    onChange={(p) => patchName("taxpayer", p)}
                  />
                  <NameFieldPair
                    label1={t("agentc3Import.spouseFirstName")}
                    label2={t("agentc3Import.spouseLastName")}
                    value={fields.spouse}
                    lockedValue={existing && (existing.clients[1].firstName || existing.clients[1].lastName) ? existing.clients[1] : null}
                    lockedLabel={t("agentc3Import.existingFieldLocked")}
                    onChange={(p) => patchName("spouse", p)}
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <TextField label={t("agentc3Import.ssn")} value={fields.ssn ?? ""} locked={Boolean(existing?.ssn[0])} lockedValue={existing?.ssn[0] ?? undefined} onChange={(v) => patch({ ssn: v || null })} />
                    <TextField label={t("agentc3Import.spouseSsn")} value={fields.spouseSsn ?? ""} locked={Boolean(existing?.ssn[1])} lockedValue={existing?.ssn[1] ?? undefined} onChange={(v) => patch({ spouseSsn: v || null })} />
                    <TextField label={t("agentc3Import.dob")} type="date" value={fields.dob ?? ""} locked={Boolean(existing?.dateOfBirth[0])} lockedValue={existing?.dateOfBirth[0] ?? undefined} onChange={(v) => patch({ dob: v || null })} />
                    <TextField label={t("agentc3Import.spouseDob")} type="date" value={fields.spouseDob ?? ""} locked={Boolean(existing?.dateOfBirth[1])} lockedValue={existing?.dateOfBirth[1] ?? undefined} onChange={(v) => patch({ spouseDob: v || null })} />
                    <TextField label={t("agentc3Import.phone1")} value={fields.phone} locked={Boolean(existing?.phone)} lockedValue={existing?.phone} onChange={(v) => patch({ phone: v })} />
                    <TextField label={t("agentc3Import.phone2")} value={fields.phone2} locked={Boolean(existing?.phone2)} lockedValue={existing?.phone2} onChange={(v) => patch({ phone2: v })} />
                    <TextField label={t("agentc3Import.email")} value={fields.email} locked={Boolean(existing?.email)} lockedValue={existing?.email} onChange={(v) => patch({ email: v })} />
                    <TextField label={t("agentc3Import.zip")} value={fields.zipcode} locked={Boolean(existing?.zipcode)} lockedValue={existing?.zipcode} onChange={(v) => patch({ zipcode: v })} />
                  </div>
                  <TextField label={t("agentc3Import.address")} value={fields.address} locked={Boolean(existing?.address)} lockedValue={existing?.address} onChange={(v) => patch({ address: v })} />

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-text-dim">
                        {t("agentc3Import.status")}
                        {!preview?.matchedStatusId && preview?.statusRaw ? <span className="ml-1 text-amber-400">{t("agentc3Import.statusNoMatch")}</span> : null}
                      </label>
                      {existing ? (
                        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-faint">{t("agentc3Import.existingFieldLocked")}</p>
                      ) : (
                        <select
                          value={fields.statusId ?? ""}
                          onChange={(e) => patch({ statusId: e.target.value || null })}
                          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
                        >
                          <option value="" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                            —
                          </option>
                          {statusOptions.map((o) => (
                            <option key={o.id} value={o.id} style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-text-dim">
                        {t("agentc3Import.agent")}
                        {!preview?.matchedAgentUserId && preview?.agentNameRaw ? <span className="ml-1 text-amber-400">{t("agentc3Import.agentNoMatch")}</span> : null}
                      </label>
                      {existing?.assignedTo ? (
                        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-faint">{t("agentc3Import.existingFieldLocked")}</p>
                      ) : (
                        <select
                          value={fields.agentUserId ?? ""}
                          onChange={(e) => patch({ agentUserId: e.target.value || null })}
                          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
                        >
                          <option value="" style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                            {t("agentc3Import.agentNone")}
                          </option>
                          {agentUsers.map((u) => (
                            <option key={u.id} value={u.id} style={{ backgroundColor: "#17171a", color: "#f2f0ec" }}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-text-dim">{t("agentc3Import.refund")}</label>
                    <div className="grid grid-cols-4 gap-2">
                      {REFUND_YEARS.map((year) => {
                        const existingAmount = existing?.refunds[year] ?? 0;
                        return (
                          <div key={year}>
                            <span className="mb-1 block text-[10px] text-text-faint">{year}</span>
                            {existingAmount ? (
                              <p className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-faint">{existingAmount}</p>
                            ) : (
                              <input
                                type="number"
                                value={fields.refunds[year] ?? 0}
                                onChange={(e) => patch({ refunds: { ...fields.refunds, [year]: Number(e.target.value) || 0 } })}
                                className="w-full rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <TextField label={t("agentc3Import.bankName")} value={fields.bankName ?? ""} locked={Boolean(existing?.bankName)} lockedValue={existing?.bankName ?? undefined} onChange={(v) => patch({ bankName: v || null })} />
                    <TextField label={t("agentc3Import.routingNumber")} value={fields.routingNumber ?? ""} locked={Boolean(existing?.routingNumber)} lockedValue={existing?.routingNumber ?? undefined} onChange={(v) => patch({ routingNumber: v || null })} />
                    <TextField label={t("agentc3Import.accountNumber")} value={fields.accountNumber ?? ""} locked={Boolean(existing?.accountNumber)} lockedValue={existing?.accountNumber ?? undefined} onChange={(v) => patch({ accountNumber: v || null })} />
                    <TextField label={t("agentc3Import.fcDate")} type="date" value={fields.fcDate ?? ""} locked={Boolean(existing?.fcDate)} lockedValue={existing?.fcDate ?? undefined} onChange={(v) => patch({ fcDate: v || null })} />
                    <TextField label={t("agentc3Import.elDate")} type="date" value={fields.elDate ?? ""} locked={Boolean(existing?.elDate)} lockedValue={existing?.elDate ?? undefined} onChange={(v) => patch({ elDate: v || null })} />
                  </div>

                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="gradient-btn mt-2 flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-white shadow-lg shadow-blue-950/30 disabled:cursor-default disabled:opacity-60"
                  >
                    {saving && <Spinner size={14} />}
                    {saving ? t("agentc3Import.saving") : existing ? t("agentc3Import.updateButton") : t("agentc3Import.createButton")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TextField({
  label,
  value,
  onChange,
  locked,
  lockedValue,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  locked?: boolean;
  lockedValue?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-text-dim">{label}</label>
      {locked ? (
        <p className="truncate rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-faint" title={lockedValue}>
          {lockedValue || "—"}
        </p>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
      )}
    </div>
  );
}

function NameFieldPair({
  label1,
  label2,
  value,
  lockedValue,
  lockedLabel,
  onChange,
}: {
  label1: string;
  label2: string;
  value: ClientNameEntry;
  lockedValue: ClientNameEntry | null;
  lockedLabel: string;
  onChange: (p: Partial<ClientNameEntry>) => void;
}) {
  if (lockedValue) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-text-dim">{label1}</label>
          <p className="truncate rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-faint" title={lockedLabel}>
            {lockedValue.firstName || "—"}
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-dim">{label2}</label>
          <p className="truncate rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-faint" title={lockedLabel}>
            {lockedValue.lastName || "—"}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="mb-1 block text-xs text-text-dim">{label1}</label>
        <input
          value={value.firstName}
          onChange={(e) => onChange({ firstName: e.target.value })}
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-text-dim">{label2}</label>
        <input
          value={value.lastName}
          onChange={(e) => onChange({ lastName: e.target.value })}
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
      </div>
    </div>
  );
}
