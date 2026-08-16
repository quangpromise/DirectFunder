"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X, AlertCircle, Search } from "lucide-react";
import { CaseRecord, ClientNameEntry, ColumnDef, Role, User } from "@/lib/types";
import { canEditColumn } from "@/lib/rbac";
import { computeRefundSummary, REFUND_YEARS } from "@/lib/refund";
import { formatSsn } from "@/lib/ssn";
import { parseDobPaste } from "@/lib/date-format";
import type { ClientProfilePayload } from "@/lib/api-client";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

type SaveResult = { ok: true } | { ok: false; error: string };

function refundsToDraft(refunds: Record<string, number> | undefined): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const year of REFUND_YEARS) draft[year] = refunds?.[year] ? String(refunds[year]) : "";
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

/** Chuẩn hoá text gõ vào ô Refund thành số THUẦN (không dấu phẩy) — cho phép gõ CẢ dấu ","
 * lẫn "." mà không lỗi: dấu "," luôn bị coi là dấu ngăn cách nghìn (bỏ đi), dấu "." luôn là
 * dấu thập phân (giữ lại, chỉ giữ tối đa 1 dấu). Kết quả là chuỗi số hợp lệ để
 * draftToRefunds/computeRefundSummary dùng Number() trực tiếp. */
function sanitizeMoneyDraft(raw: string): string {
  const digitsAndDot = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  const [intPart, ...rest] = digitsAndDot.split(".");
  return rest.length > 0 ? `${intPart}.${rest.join("")}` : intPart;
}

/** Hiển thị lại chuỗi số thuần (từ sanitizeMoneyDraft) theo đúng cấu trúc tiền $ Mỹ — thêm
 * dấu phẩy ngăn cách hàng nghìn ở phần nguyên, giữ nguyên phần thập phân đang gõ dở (không
 * làm tròn/cắt trong lúc gõ). */
function formatMoneyDraft(raw: string): string {
  if (!raw) return "";
  const [intPart, decPart] = raw.split(".");
  const withCommas = (intPart || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
}

/** Dropdown chọn 1 user trong hệ thống (trừ role "manager"/Admin) kèm ô tìm kiếm — dùng cho
 * 2 ô "Accountant"/"Accountant Support" (thêm 2026-08-16). Lưu THẲNG tên hiển thị (name) của
 * user đã chọn vào `Case.accountant`/`accountantSupport` (vẫn là field text tự do trên
 * schema, không đổi sang lưu userId) — giữ đơn giản vì 2 field này chỉ dùng để hiển thị/đổ
 * vào cột ACCT của Collecting, không cần tra cứu ngược lại user thật ở đâu khác. */
function UserPickerField({
  label,
  value,
  users,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  users: User[];
  disabled: boolean;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = search.trim()
    ? users.filter((u) => u.name.toLowerCase().includes(search.trim().toLowerCase()))
    : users;

  return (
    <div ref={wrapRef} className="relative">
      <label className="mb-0.5 block text-[11px] text-text-dim">{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setSearch("");
          setOpen((o) => !o);
          setTimeout(() => searchRef.current?.focus(), 0);
        }}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-left text-sm outline-none transition focus:border-accent disabled:cursor-default disabled:opacity-50"
      >
        <span className={`truncate ${value ? "" : "text-text-faint"}`}>{value || t("clientProfile.selectUser")}</span>
      </button>

      {open && !disabled && (
        <div className="popover absolute left-0 top-full z-20 mt-1 w-full rounded-lg p-1.5 shadow-2xl shadow-black/60">
          <div className="relative mb-1 shrink-0">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder={t("assign.searchPlaceholder")}
              className="w-full rounded-md border border-border bg-bg-elevated py-1 pl-6 pr-2 text-xs outline-none focus:border-accent"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-text-faint transition hover:bg-surface-hover"
              >
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-dashed border-border">
                  <X size={10} />
                </span>
                {t("clientProfile.clearUser")}
              </button>
            )}
            {filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  onChange(u.name);
                  setOpen(false);
                }}
                className="w-full truncate rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-surface-hover"
              >
                {u.name}
              </button>
            ))}
            {filtered.length === 0 && <div className="px-2 py-2 text-xs text-text-faint">{t("assign.noMatching")}</div>}
          </div>
        </div>
      )}
    </div>
  );
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
  const allUsers = useAppStore((s) => s.users);
  const pickableUsers = allUsers.filter((u) => u.role !== "manager");
  const [clients, setClients] = useState<[ClientNameEntry, ClientNameEntry]>(caseRecord.clients);
  const [ssn, setSsn] = useState<[string | null, string | null]>(caseRecord.ssn);
  const [dateOfBirth, setDateOfBirth] = useState<[string | null, string | null]>(caseRecord.dateOfBirth);
  const [phone, setPhone] = useState(caseRecord.phone);
  const [phone2, setPhone2] = useState(caseRecord.phone2);
  const [zipcode, setZipcode] = useState(caseRecord.zipcode);
  const [address, setAddress] = useState(caseRecord.address);
  const [email, setEmail] = useState(caseRecord.email);
  const [refundsDraft, setRefundsDraft] = useState<Record<string, string>>(refundsToDraft(caseRecord.refunds));
  const [fcDate, setFcDate] = useState(caseRecord.fcDate);
  const [processingDate, setProcessingDate] = useState(caseRecord.processingDate);
  const [elDate, setElDate] = useState(caseRecord.elDate);
  const [bankName, setBankName] = useState(caseRecord.bankName ?? "");
  const [routingNumber, setRoutingNumber] = useState(caseRecord.routingNumber ?? "");
  const [accountNumber, setAccountNumber] = useState(caseRecord.accountNumber ?? "");
  const [note, setNote] = useState(caseRecord.note ?? "");
  const [accountant, setAccountant] = useState(caseRecord.accountant ?? "");
  const [accountantSupport, setAccountantSupport] = useState(caseRecord.accountantSupport ?? "");
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
    setFcDate(caseRecord.fcDate);
    setProcessingDate(caseRecord.processingDate);
    setElDate(caseRecord.elDate);
    setBankName(caseRecord.bankName ?? "");
    setRoutingNumber(caseRecord.routingNumber ?? "");
    setAccountNumber(caseRecord.accountNumber ?? "");
    setNote(caseRecord.note ?? "");
    setAccountant(caseRecord.accountant ?? "");
    setAccountantSupport(caseRecord.accountantSupport ?? "");
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

  // Last Name bắt buộc: luôn bắt buộc ở slot Taxpayer (khách hàng chính của hồ sơ); ở slot
  // Spouse chỉ bắt buộc nếu đã nhập First Name (Spouse được phép để trống hoàn toàn).
  const lastNameErrors: [string, string] = [0, 1].map((slot) => {
    const entry = clients[slot as 0 | 1];
    const required = slot === 0 || Boolean(entry.firstName.trim());
    return required && !entry.lastName.trim() ? t("clientProfile.errLastNameRequired") : "";
  }) as [string, string];
  const hasLastNameError = canEdit("clientName") && lastNameErrors.some(Boolean);

  async function handleSave() {
    if (hasSsnDuplicate) {
      setError(t("ssn.errDuplicate"));
      return;
    }
    if (hasLastNameError) {
      setError(t("clientProfile.errLastNameRequired"));
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
    if (canEdit("fcDate")) payload.fcDate = fcDate;
    if (canEdit("processingDate")) payload.processingDate = processingDate;
    if (canEdit("elDate")) payload.elDate = elDate;
    if (canEdit("bankName")) payload.bankName = bankName;
    if (canEdit("routingNumber")) payload.routingNumber = routingNumber;
    if (canEdit("accountNumber")) payload.accountNumber = accountNumber;
    if (canEdit("note")) payload.note = note;
    if (canEdit("accountant")) payload.accountant = accountant;
    if (canEdit("accountantSupport")) payload.accountantSupport = accountantSupport;

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
        className="shrink-0 rounded p-0.5 text-red-600 transition hover:bg-red-500/15 hover:text-red-500 light:text-red-700 light:hover:bg-red-100 light:hover:text-red-800"
      >
        <Pencil size={12} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-4">
            <div className="popover flex max-h-full w-full max-w-5xl flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-4">
                <h3 className="text-sm font-semibold">{t("clientProfile.title")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                  <X size={16} />
                </button>
              </div>

              {/* Bố cục ngang, gộp mọi thông tin vào 1 hàng lớn (2 khối Taxpayer/Spouse +
                  khối thông tin chung + khối Refund) để vừa trong 1 màn hình không cần
                  scroll ở đa số kích thước cửa sổ, thay vì xếp chồng dọc như trước. */}
              <div className="mt-3 flex flex-col gap-3 overflow-y-auto px-5 lg:flex-row">
                <div className="grid flex-[2] grid-cols-1 gap-3 sm:grid-cols-2">
                  {([0, 1] as const).map((slot) => (
                    <div
                      key={slot}
                      className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5 transition-colors focus-within:border-accent focus-within:bg-accent-soft"
                    >
                      <p className="text-xs font-semibold text-text-dim">
                        {slot === 0 ? t("clientProfile.taxpayer") : t("clientProfile.spouse")}
                      </p>
                      <div>
                        <label className="mb-0.5 block text-[11px] text-text-faint">{t("clientProfile.firstName")}</label>
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
                        <label className="mb-0.5 block text-[11px] text-text-faint">{t("clientProfile.lastName")}</label>
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
                          className={`${inputCls} ${lastNameErrors[slot] ? "border-red-500" : ""}`}
                        />
                        {lastNameErrors[slot] && (
                          <p className="mt-0.5 text-[10px] leading-tight text-red-400">{lastNameErrors[slot]}</p>
                        )}
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[11px] text-text-faint">{t("clientProfile.ssn")}</label>
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
                          <p className="mt-0.5 text-[10px] leading-tight text-red-400">{ssnDuplicateErrors[slot]}</p>
                        )}
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[11px] text-text-faint">{t("clientProfile.dob")}</label>
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
                          // Input type="date" gốc chỉ nhận paste đúng ISO theo từng segment
                          // ngày/tháng/năm (rất dễ fail khi dán "mm/dd/yyyy" từ Excel) — tự
                          // diễn giải thêm các định dạng phổ biến qua parseDobPaste, chỉ
                          // preventDefault khi nhận diện được để không phá hành vi paste
                          // mặc định của trình duyệt với các trường hợp khác.
                          onPaste={(e) => {
                            const iso = parseDobPaste(e.clipboardData.getData("text"));
                            if (!iso) return;
                            e.preventDefault();
                            setDateOfBirth((prev) => {
                              const next: [string | null, string | null] = [...prev];
                              next[slot] = iso;
                              return next;
                            });
                          }}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="sm:col-span-2">
                    <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.note")}</label>
                    <textarea
                      value={note}
                      disabled={!canEdit("note")}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      className={`${inputCls} resize-none`}
                    />
                  </div>
                </div>

                <div className="flex flex-[3] flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    <div>
                      <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.phone1")}</label>
                      <input
                        value={phone}
                        disabled={!canEdit("phone")}
                        maxLength={10}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.phone2")}</label>
                      <input
                        value={phone2}
                        disabled={!canEdit("phone2")}
                        maxLength={10}
                        onChange={(e) => setPhone2(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.email")}</label>
                      <input
                        value={email}
                        disabled={!canEdit("email")}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.address")}</label>
                      <input
                        value={address}
                        disabled={!canEdit("address")}
                        onChange={(e) => setAddress(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.zipcode")}</label>
                      <input
                        value={zipcode}
                        disabled={!canEdit("zipcode")}
                        maxLength={5}
                        onChange={(e) => setZipcode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-text-dim">{t("clientProfile.refundLabel")}</label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {REFUND_YEARS.map((year) => {
                        const isEmpty = !refundsDraft[year];
                        return (
                          <div key={year} className="relative">
                            <span
                              className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs ${
                                isEmpty ? "text-red-400" : "text-text-faint"
                              }`}
                            >
                              $
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              // Hiển thị luôn theo cấu trúc tiền $ Mỹ (dấu phẩy ngăn cách
                              // nghìn) — refundsDraft[year] lưu số THUẦN không dấu phẩy
                              // (xem sanitizeMoneyDraft), chỉ format lại lúc render.
                              value={formatMoneyDraft(refundsDraft[year])}
                              disabled={!canEdit("refunds")}
                              onChange={(e) =>
                                setRefundsDraft((prev) => ({ ...prev, [year]: sanitizeMoneyDraft(e.target.value) }))
                              }
                              placeholder={year}
                              className={`${inputCls} pl-5 ${isEmpty ? "border-red-500 focus:border-red-500" : ""}`}
                            />
                            <span
                              className={`mt-0.5 block text-center text-[10px] ${isEmpty ? "font-medium text-red-400" : "text-text-faint"}`}
                            >
                              {year}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-xs text-text-faint">
                      {t("clientProfile.summary", { case: previewCaseCount, money: previewMoney.toLocaleString("en-US") })}
                    </p>
                  </div>

                  {/* 3 ô ngày mới, nằm ngang ngay dưới khối Refund (thêm 2026-08-14) —
                      cùng type="date" native như DOB ở trên (nhất quán trong dialog này),
                      hiển thị theo định dạng khu vực trình duyệt (mm/dd/yy ở en-US). */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.fcDate")}</label>
                      <input
                        type="date"
                        value={fcDate ?? ""}
                        disabled={!canEdit("fcDate")}
                        onChange={(e) => setFcDate(e.target.value || null)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.processingDate")}</label>
                      <input
                        type="date"
                        value={processingDate ?? ""}
                        disabled={!canEdit("processingDate")}
                        onChange={(e) => setProcessingDate(e.target.value || null)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.elDate")}</label>
                      <input
                        type="date"
                        value={elDate ?? ""}
                        disabled={!canEdit("elDate")}
                        onChange={(e) => setElDate(e.target.value || null)}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  {/* 3 ô ngân hàng, đặt ngay dưới khối FC/Processing/EL Date (thêm
                      2026-08-16) — chỉ dùng để điền vào email "Thông báo hoàn thuế" gửi
                      khách hàng, không phải bank account thật của công ty. */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.bankName")}</label>
                      <input
                        value={bankName}
                        disabled={!canEdit("bankName")}
                        onChange={(e) => setBankName(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.routingNumber")}</label>
                      <input
                        value={routingNumber}
                        disabled={!canEdit("routingNumber")}
                        onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, ""))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] text-text-dim">{t("clientProfile.accountNumber")}</label>
                      <input
                        value={accountNumber}
                        disabled={!canEdit("accountNumber")}
                        onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  {/* 2 ô "Accountant"/"Accountant Support" (thêm 2026-08-16) —
                      accountantSupport tự động đổ vào cột "ACCT" của tab Collecting khi
                      bấm "Send Collecting Report" cạnh mỗi năm ở popup Refund by years. */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <UserPickerField
                      label={t("clientProfile.accountant")}
                      value={accountant}
                      users={pickableUsers}
                      disabled={!canEdit("accountant")}
                      onChange={setAccountant}
                    />
                    <UserPickerField
                      label={t("clientProfile.accountantSupport")}
                      value={accountantSupport}
                      users={pickableUsers}
                      disabled={!canEdit("accountantSupport")}
                      onChange={setAccountantSupport}
                    />
                  </div>
                </div>
              </div>

              {error && (
                <div className="mx-5 mt-3 flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 light:text-red-700">
                  <AlertCircle size={13} className="shrink-0" />
                  {error}
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2 px-5 pb-4">
                <button onClick={() => setOpen(false)} className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover">
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || hasSsnDuplicate || hasLastNameError}
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
