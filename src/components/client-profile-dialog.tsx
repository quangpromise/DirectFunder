"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X, AlertCircle } from "lucide-react";
import { CaseRecord, ClientNameEntry, ColumnDef, Role } from "@/lib/types";
import { canEditColumn } from "@/lib/rbac";
import { computeRefundSummary, REFUND_YEARS } from "@/lib/refund";
import { formatSsn } from "@/lib/ssn";
import type { ClientProfilePayload } from "@/lib/api-client";
import { useT } from "@/lib/i18n";

type SaveResult = { ok: true } | { ok: false; error: string };

function refundsToDraft(refunds: Record<string, number>): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const year of REFUND_YEARS) draft[year] = refunds[year] ? String(refunds[year]) : "";
  return draft;
}

function draftToRefunds(draft: Record<string, string>): Record<string, number> {
  const refunds: Record<string, number> = {};
  for (const year of REFUND_YEARS) {
    const n = Number(draft[year]);
    refunds[year] = Number.isFinite(n) && n > 0 ? n : 0;
  }
  return refunds;
}

/**
 * Nút bút chì "Edit Hồ sơ" đặt trước tên khách hàng trong cột Client Name — mở popup
 * sửa TOÀN BỘ thông tin khách hàng (First/Last Name x2, SSN x2, Date of Birth x2, Phone
 * 1/2, Zipcode, Address, Email, Refund 4 năm) trong 1 chỗ duy nhất. Các trường này đã bị
 * khoá sửa trực tiếp ngoài bảng chính (xem cases/page.tsx) — đây là NƠI DUY NHẤT sửa
 * được. Money/Case (số đếm năm refund > 0) hoàn toàn tự tính ở server khi lưu, không có
 * ô nhập nào cho 2 giá trị này.
 */
export function ClientProfileDialog({
  caseRecord,
  columns,
  role,
  isDuplicateSsn,
  onSave,
}: {
  caseRecord: CaseRecord;
  columns: ColumnDef[];
  role: Role;
  /** Kiểm tra 1 số SSN đã tồn tại ở hồ sơ/slot khác trong hệ thống chưa (loại trừ đúng
   * slot đang sửa của chính hồ sơ này) — dùng chung logic với SsnCell ở bảng chính. */
  isDuplicateSsn: (slot: 0 | 1, candidate: string) => boolean;
  onSave: (payload: ClientProfilePayload) => Promise<SaveResult>;
}) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<[ClientNameEntry, ClientNameEntry]>(caseRecord.clients);
  const [ssn, setSsn] = useState<[string | null, string | null]>(caseRecord.ssn);
  const [dateOfBirth, setDateOfBirth] = useState<[string | null, string | null]>(caseRecord.dateOfBirth);
  const [phone, setPhone] = useState(caseRecord.phone);
  const [phone2, setPhone2] = useState(caseRecord.phone2);
  const [zipcode, setZipcode] = useState(caseRecord.zipcode);
  const [address, setAddress] = useState(caseRecord.address);
  const [email, setEmail] = useState(caseRecord.email);
  const [refundsDraft, setRefundsDraft] = useState<Record<string, string>>(refundsToDraft(caseRecord.refunds));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const t = useT();

  function colOf(id: string): ColumnDef | undefined {
    return columns.find((c) => c.id === id);
  }
  function canEdit(id: string): boolean {
    const col = colOf(id);
    return col ? canEditColumn(role, col) : false;
  }

  function openDialog() {
    setClients(caseRecord.clients);
    setSsn(caseRecord.ssn);
    setDateOfBirth(caseRecord.dateOfBirth);
    setPhone(caseRecord.phone);
    setPhone2(caseRecord.phone2);
    setZipcode(caseRecord.zipcode);
    setAddress(caseRecord.address);
    setEmail(caseRecord.email);
    setRefundsDraft(refundsToDraft(caseRecord.refunds));
    setError("");
    setOpen(true);
  }

  const { money: previewMoney, caseCount: previewCaseCount } = computeRefundSummary(draftToRefunds(refundsDraft));

  // Kiểm tra trùng SSN NGAY khi gõ (không chờ tới lúc bấm Lưu) — mỗi số SSN phải là duy
  // nhất trên toàn hệ thống. isDuplicateSsn so với dữ liệu ĐÃ LƯU của các hồ sơ khác (kể
  // cả slot còn lại CHƯA sửa của chính hồ sơ này); so sánh trực tiếp ssn[0] === ssn[1]
  // thêm để bắt cả trường hợp gõ trùng cả 2 ô Taxpayer/Spouse NGAY trong lúc đang sửa
  // (2 giá trị nháp này isDuplicateSsn không thấy được vì chưa lưu xuống server).
  const sameDraftDuplicate = Boolean(ssn[0] && ssn[1] && ssn[0] === ssn[1]);
  const ssnDuplicateErrors: [string, string] = [0, 1].map((slot) => {
    const value = ssn[slot as 0 | 1];
    if (!value) return "";
    if (sameDraftDuplicate) return t("ssn.errDuplicate");
    return isDuplicateSsn(slot as 0 | 1, value) ? t("ssn.errDuplicate") : "";
  }) as [string, string];
  const hasSsnDuplicate = ssnDuplicateErrors.some(Boolean);

  async function handleSave() {
    if (hasSsnDuplicate) {
      setError(t("ssn.errDuplicate"));
      return;
    }
    const payload: ClientProfilePayload = {};
    if (canEdit("clientName")) payload.clients = clients;
    if (canEdit("ssn")) payload.ssn = ssn;
    if (canEdit("dateOfBirth")) payload.dateOfBirth = dateOfBirth;
    if (canEdit("phone")) payload.phone = phone;
    if (canEdit("phone2")) payload.phone2 = phone2;
    if (canEdit("zipcode")) payload.zipcode = zipcode;
    if (canEdit("address")) payload.address = address;
    if (canEdit("email")) payload.email = email;
    if (canEdit("refunds")) payload.refunds = draftToRefunds(refundsDraft);

    setSaving(true);
    setError("");
    try {
      const result = await onSave(payload);
      if (result.ok) {
        setOpen(false);
      } else {
        setError(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-sm outline-none focus:border-accent disabled:cursor-default disabled:opacity-50";

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        title={t("clientProfile.triggerBtn")}
        aria-label={t("clientProfile.triggerBtn")}
        className="shrink-0 rounded p-0.5 text-text-faint transition hover:bg-surface-hover hover:text-text"
      >
        <Pencil size={12} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-2xl flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("clientProfile.title")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-4 overflow-y-auto px-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {([0, 1] as const).map((slot) => (
                    <div key={slot} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                      <p className="text-xs font-semibold text-text-dim">
                        {slot === 0 ? t("clientProfile.taxpayer") : t("clientProfile.spouse")}
                      </p>
                      <div>
                        <label className="mb-1 block text-xs text-text-faint">{t("clientProfile.firstName")}</label>
                        <input
                          value={clients[slot].firstName}
                          disabled={!canEdit("clientName")}
                          onChange={(e) =>
                            setClients((prev) => {
                              const next: [ClientNameEntry, ClientNameEntry] = [...prev];
                              next[slot] = { ...next[slot], firstName: e.target.value };
                              return next;
                            })
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-text-faint">{t("clientProfile.lastName")}</label>
                        <input
                          value={clients[slot].lastName}
                          disabled={!canEdit("clientName")}
                          onChange={(e) =>
                            setClients((prev) => {
                              const next: [ClientNameEntry, ClientNameEntry] = [...prev];
                              next[slot] = { ...next[slot], lastName: e.target.value };
                              return next;
                            })
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-text-faint">{t("clientProfile.ssn")}</label>
                        <input
                          value={ssn[slot] ?? ""}
                          disabled={!canEdit("ssn")}
                          placeholder="xxx-xx-xxxx"
                          maxLength={11}
                          onChange={(e) =>
                            setSsn((prev) => {
                              const next: [string | null, string | null] = [...prev];
                              next[slot] = formatSsn(e.target.value);
                              return next;
                            })
                          }
                          className={`${inputCls} ${ssnDuplicateErrors[slot] ? "border-red-500" : ""}`}
                        />
                        {ssnDuplicateErrors[slot] && (
                          <p className="mt-1 text-[10px] leading-tight text-red-400">{ssnDuplicateErrors[slot]}</p>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-text-faint">{t("clientProfile.dob")}</label>
                        <input
                          type="date"
                          value={dateOfBirth[slot] ?? ""}
                          disabled={!canEdit("dateOfBirth")}
                          onChange={(e) =>
                            setDateOfBirth((prev) => {
                              const next: [string | null, string | null] = [...prev];
                              next[slot] = e.target.value || null;
                              return next;
                            })
                          }
                          className={inputCls}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-text-dim">{t("clientProfile.phone1")}</label>
                    <input
                      value={phone}
                      disabled={!canEdit("phone")}
                      maxLength={10}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text-dim">{t("clientProfile.phone2")}</label>
                    <input
                      value={phone2}
                      disabled={!canEdit("phone2")}
                      maxLength={10}
                      onChange={(e) => setPhone2(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text-dim">{t("clientProfile.zipcode")}</label>
                    <input
                      value={zipcode}
                      disabled={!canEdit("zipcode")}
                      maxLength={5}
                      onChange={(e) => setZipcode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text-dim">{t("clientProfile.email")}</label>
                    <input value={email} disabled={!canEdit("email")} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs text-text-dim">{t("clientProfile.address")}</label>
                    <input value={address} disabled={!canEdit("address")} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs text-text-dim">{t("clientProfile.refundLabel")}</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {REFUND_YEARS.map((year) => (
                      <div key={year} className="relative">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-text-faint">$</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={refundsDraft[year]}
                          disabled={!canEdit("refunds")}
                          onChange={(e) => setRefundsDraft((prev) => ({ ...prev, [year]: e.target.value }))}
                          placeholder={year}
                          className={`${inputCls} pl-5`}
                        />
                        <span className="mt-0.5 block text-center text-[10px] text-text-faint">{year}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-text-faint">
                    {t("clientProfile.summary", { case: previewCaseCount, money: previewMoney.toLocaleString("en-US") })}
                  </p>
                </div>
              </div>

              {error && (
                <div className="mx-5 mt-3 flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 light:text-red-700">
                  <AlertCircle size={13} className="shrink-0" />
                  {error}
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2 px-5 pb-5">
                <button onClick={() => setOpen(false)} className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover">
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || hasSsnDuplicate}
                  className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white disabled:cursor-default disabled:opacity-60"
                >
                  {saving ? t("clientProfile.saving") : t("clientProfile.saveBtn")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
