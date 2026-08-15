"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet, X, RefreshCw, Unlink } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { monthKeyLabel } from "@/lib/cpa-review-month";
import { useT } from "@/lib/i18n";

/**
 * Dialog Admin cấu hình đồng bộ 2 chiều "CPA Review" cho ĐÚNG 1 THÁNG (xem
 * deployment-database-sync.md mục 4.22) — mỗi tháng 1 Sheet/kết nối riêng (thêm 2026-08-14,
 * yêu cầu "chọn tháng nào sẽ ra bảng của tháng đó... có chỗ insert link cho Google Sheet
 * tháng mới được chọn"). Chuyển từ trang Phân quyền SANG chính tab CPA Review (yêu cầu "tạo
 * 1 ô cấu hình ở màn hình này") — mapping cột A-AH CỐ ĐỊNH theo cấu trúc Sheet thật đã khảo
 * sát, Admin chỉ cần dán link + xác nhận bảng ánh xạ tên Processor/Agent. Chuỗi hiển thị
 * hard-code tiếng Việt (không qua t()) — tính năng nội bộ chỉ Admin/role được cấp quyền
 * dùng, chấp nhận đánh đổi để giảm chi phí thêm i18n key cho 1 dialog cấu hình vận hành hẹp
 * phạm vi.
 */
/** Sheet link không được lưu nguyên văn (chỉ lưu sheetId/gid tách sẵn từ lúc kết nối) —
 * dựng lại đúng dạng URL chuẩn từ 2 giá trị đó để hiển thị link đã kết nối trong dialog. */
function buildSheetLink(sheetId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${gid}`;
}

export function CpaReviewSheetConfigDialog({ month }: { month: string }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [changingLink, setChangingLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectResult, setConnectResult] = useState<{
    importedCount: number;
    distinctNames: string[];
    webhookSecret: string;
    webhookUrl: string;
    appsScript: string;
  } | null>(null);

  const configMap = useAppStore((s) => s.cpaReviewSheetConfig);
  const config = configMap[month] ?? null;
  const users = useAppStore((s) => s.users);
  const connect = useAppStore((s) => s.connectCpaReviewSheet);
  const resync = useAppStore((s) => s.resyncCpaReviewSheet);
  const updateMapping = useAppStore((s) => s.updateCpaReviewNameMapping);
  const disconnect = useAppStore((s) => s.disconnectCpaReviewSheet);
  const t = useT();

  async function handleConnect() {
    if (!link.trim()) return;
    setBusy(true);
    setError(null);
    const result = await connect(link.trim(), month);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConnectResult(result);
    setLink("");
    setChangingLink(false);
  }

  async function handleResync() {
    setBusy(true);
    setError(null);
    const result = await resync(month);
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  async function handleDisconnect() {
    setBusy(true);
    await disconnect(month);
    setConnectResult(null);
    setBusy(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <FileSpreadsheet size={14} />
        {config ? "Đã kết nối Sheet" : "Kết nối Sheet"}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-lg flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">
                  Đồng bộ 2 chiều Google Sheet — <span className="text-accent">{monthKeyLabel(month)}</span>
                </h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5 pb-5">
                {!config ? (
                  <>
                    <p className="text-xs text-text-faint">
                      Dán link Google Sheet của đúng tháng <span className="font-medium text-text">{monthKeyLabel(month)}</span> (mở
                      đúng tab tháng đó trước khi copy link, để URL có kèm #gid=...).
                    </p>
                    <input
                      value={link}
                      onChange={(e) => setLink(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/...#gid=..."
                      className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                    />
                    <button
                      onClick={handleConnect}
                      disabled={busy || !link.trim()}
                      className="gradient-btn flex h-9 items-center justify-center rounded-lg text-sm font-medium text-white disabled:cursor-default disabled:opacity-60"
                    >
                      {busy ? "Đang kết nối..." : "Kết nối"}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-dim">
                      <p>
                        Đã kết nối tab <span className="font-medium text-text">{config.tabName}</span>
                      </p>
                      <a
                        href={buildSheetLink(config.sheetId, config.gid)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block truncate text-accent underline-offset-2 hover:underline"
                      >
                        {buildSheetLink(config.sheetId, config.gid)}
                      </a>
                      <p className="mt-0.5 text-text-faint">
                        Lúc: {new Date(config.connectedAt).toLocaleString("vi-VN")}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleResync}
                        disabled={busy}
                        className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface text-sm text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
                      >
                        <RefreshCw size={14} />
                        Đồng bộ lại toàn bộ
                      </button>
                      <button
                        onClick={() => setChangingLink((v) => !v)}
                        disabled={busy}
                        className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
                      >
                        <FileSpreadsheet size={14} />
                        Đổi link
                      </button>
                      <button
                        onClick={handleDisconnect}
                        disabled={busy}
                        className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-red-400 transition hover:bg-red-500/10 disabled:cursor-default disabled:opacity-60"
                      >
                        <Unlink size={14} />
                        Ngắt kết nối
                      </button>
                    </div>

                    {changingLink && (
                      <div className="rounded-lg border border-border bg-bg-elevated p-3">
                        <p className="mb-2 text-xs text-text-faint">
                          Dán link Sheet khác (đúng tab #gid=...) để kết nối lại tháng{" "}
                          <span className="font-medium text-text">{monthKeyLabel(month)}</span> — dữ liệu hiện có trong app{" "}
                          <span className="font-medium text-text">không bị xoá</span>, chỉ nạp thêm/khớp lại theo SSN từ Sheet mới.
                        </p>
                        <input
                          value={link}
                          onChange={(e) => setLink(e.target.value)}
                          placeholder="https://docs.google.com/spreadsheets/d/...#gid=..."
                          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                        />
                        <button
                          onClick={handleConnect}
                          disabled={busy || !link.trim()}
                          className="gradient-btn mt-2 flex h-9 w-full items-center justify-center rounded-lg text-sm font-medium text-white disabled:cursor-default disabled:opacity-60"
                        >
                          {busy ? "Đang kết nối..." : "Kết nối lại"}
                        </button>
                      </div>
                    )}

                    <div>
                      <label className="mb-1 block text-xs text-text-dim">Ánh xạ tên Processor/Agent trong Sheet → tài khoản</label>
                      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-1.5">
                        {(connectResult?.distinctNames ?? Object.keys(config.nameToUserId)).length === 0 && (
                          <p className="px-2 py-1.5 text-xs text-text-faint">Chưa quét được tên nào — bấm &quot;Đồng bộ lại toàn bộ&quot; sau khi kết nối.</p>
                        )}
                        {(connectResult?.distinctNames ?? Object.keys(config.nameToUserId)).map((name) => (
                          <div key={name} className="flex items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-sm">
                            <span className="min-w-0 flex-1 truncate">{name}</span>
                            <select
                              value={config.nameToUserId[name] ?? ""}
                              onChange={(e) => updateMapping({ [name]: e.target.value }, month)}
                              className="max-h-40 w-40 shrink-0 rounded-md border border-border bg-bg-elevated px-1.5 py-1 text-xs outline-none focus:border-accent"
                            >
                              <option value="">— Chưa chọn —</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {connectResult && (
                  <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-text-dim">
                    <p className="font-medium text-text">
                      Đã nhập {connectResult.importedCount} dòng từ Sheet. Dán đoạn script sau vào Extensions → Apps Script
                      của Sheet, Save, rồi chọn hàm <span className="font-mono">installCpaReviewTriggers</span> ở dropdown
                      và bấm Run 1 lần (vừa cấp quyền, vừa cài lịch quét Ghi chú mỗi 5 phút):
                    </p>
                    <textarea
                      readOnly
                      value={connectResult.appsScript}
                      rows={10}
                      onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                      className="mt-2 w-full resize-none rounded-md border border-border bg-bg-elevated p-2 font-mono text-[10px] leading-snug text-text outline-none"
                    />
                    <p className="mt-1 text-[10px] text-text-faint">
                      Bí mật này chỉ hiện ĐÚNG 1 LẦN — nếu mất đoạn script, ngắt kết nối rồi kết nối lại để sinh secret mới.
                    </p>
                  </div>
                )}

                {error && <p className="text-xs text-red-400">{error}</p>}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
