"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X, Copy, Check, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api-client";
import { monthKeyLabel } from "@/lib/cpa-review-month";

/**
 * Popup "Hướng dẫn" trên tab CPA Review (thêm 2026-08-14, yêu cầu "Một nút hướng dẫn khi
 * nhấn vào sẽ mở ra pop-up hướng dẫn cấu hình 2 chiều để đồng bộ") — đi từng bước cụ thể
 * (share quyền Editor cho Service Account, dán Apps Script vào đâu, chạy hàm nào) thay vì
 * chỉ 1-2 dòng chú thích rải rác trong CpaReviewSheetConfigDialog như trước — dễ theo dõi
 * hơn cho người KHÔNG PHẢI dev lần đầu cấu hình. Đọc email Service Account qua
 * GET /api/config/cpa-review-sheet (không phải bí mật, chỉ cần quyền `manageCpaReviewSheet`).
 */
export function CpaReviewSyncGuideDialog({ month }: { month: string }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<{
    serviceAccountConfigured: boolean;
    serviceAccountEmail: string | null;
    appsScript: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);

  useEffect(() => {
    if (!open || info) return;
    api
      .getCpaReviewSyncInfo(month)
      .then(setInfo, () => setInfo({ serviceAccountConfigured: false, serviceAccountEmail: null, appsScript: null }));
  }, [open, info, month]);

  function copyEmail() {
    if (!info?.serviceAccountEmail) return;
    navigator.clipboard.writeText(info.serviceAccountEmail).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function copyScript() {
    if (!info?.appsScript) return;
    navigator.clipboard.writeText(info.appsScript).then(() => {
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 1500);
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <HelpCircle size={14} />
        Hướng dẫn
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-xl flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">Hướng dẫn cấu hình đồng bộ 2 chiều</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text" aria-label="Đóng">
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5 pb-5 text-sm text-text-dim">
                {info && !info.serviceAccountConfigured && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      Server chưa cấu hình Service Account (thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
                      — liên hệ người phụ trách kỹ thuật trước khi làm các bước dưới đây.
                    </span>
                  </div>
                )}

                <GuideStep n={1} title="Chia sẻ quyền Editor Google Sheet cho tài khoản đồng bộ">
                  <p>
                    Mở đúng Google Sheet của tháng <span className="font-medium text-text">{monthKeyLabel(month)}</span>, bấm{" "}
                    <span className="font-medium text-text">Share</span> (Chia sẻ) → dán email dưới đây → chọn quyền{" "}
                    <span className="font-medium text-text">Editor</span> → Gửi.
                  </p>
                  <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5">
                    <code className="min-w-0 flex-1 truncate text-xs text-text">{info?.serviceAccountEmail ?? "Đang tải..."}</code>
                    <button
                      onClick={copyEmail}
                      disabled={!info?.serviceAccountEmail}
                      className="shrink-0 text-text-faint transition hover:text-text disabled:opacity-40"
                      title="Copy"
                      aria-label="Copy email"
                    >
                      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    </button>
                  </div>
                </GuideStep>

                <GuideStep n={2} title='Dán link Sheet vào nút "Kết nối Sheet"'>
                  <p>
                    Ở tab CPA Review, chọn đúng tháng cần kết nối bằng bộ chọn tháng, mở đúng tab tháng đó trong Google Sheet
                    (để URL trên trình duyệt có kèm <span className="font-mono text-[11px]">#gid=...</span>), copy link, dán vào nút
                    &quot;Kết nối Sheet&quot; rồi bấm Kết nối.
                  </p>
                </GuideStep>

                <GuideStep n={3} title="Dán đoạn Apps Script vào Sheet">
                  <p>
                    Kết nối xong, app hiện ra 1 đoạn script — quay lại Google Sheet, vào{" "}
                    <span className="font-medium text-text">Extensions → Apps Script</span> (Tiện ích mở rộng → Apps Script), xoá
                    hết code mẫu có sẵn (thường là <span className="font-mono text-[11px]">function myFunction() {"{}"}</span>), dán
                    đoạn script app vừa đưa vào, rồi bấm biểu tượng đĩa mềm để Save.
                  </p>
                  {info?.appsScript && (
                    <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5">
                      <span className="text-[11px] text-text-faint">
                        Đã kết nối tháng này — bấm để lấy lại đúng đoạn script (dùng khi lỡ xoá, hoặc script generator vừa có bản
                        sửa lỗi mới) mà không cần ngắt kết nối.
                      </span>
                      <button
                        onClick={copyScript}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-dim transition hover:bg-surface-hover hover:text-text"
                      >
                        {scriptCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        {scriptCopied ? "Đã copy" : "Copy script"}
                      </button>
                    </div>
                  )}
                </GuideStep>

                <GuideStep n={4} title="Chạy 1 lần để cấp quyền + bật đồng bộ Ghi chú">
                  <p>
                    Ở thanh công cụ phía trên (cạnh nút ▶ Run), chọn hàm{" "}
                    <span className="font-mono text-[11px] text-text">installCpaReviewTriggers</span> (KHÔNG chọn{" "}
                    <span className="font-mono text-[11px]">onEdit</span>) rồi bấm{" "}
                    <span className="font-medium text-text">Run</span>. Nếu Google hỏi xác nhận quyền, bấm{" "}
                    <span className="font-medium text-text">Advanced (Nâng cao)</span> →{" "}
                    <span className="font-medium text-text">Go to ... (unsafe)</span> → Allow (đây là script bạn tự dán, an toàn) —
                    chỉ cần làm bước này 1 lần.
                  </p>
                </GuideStep>

                <GuideStep n={5} title="Xong — thử sửa 1 ô để kiểm tra">
                  <p>
                    Sửa 1 ô bất kỳ trong app → Sheet cập nhật trong vài giây. Sửa trực tiếp trong Sheet → app tự cập nhật gần như
                    ngay lập tức (không cần F5). Riêng <span className="font-medium text-text">Ghi chú</span> (chuột phải ô → Insert
                    note) đồng bộ chiều Sheet→App có độ trễ tối đa 5 phút (Google Sheets không báo sự kiện khi thêm Ghi chú).
                  </p>
                </GuideStep>

                <p className="mt-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-faint">
                  Chỉ tài khoản được cấp quyền &quot;Cấu hình đồng bộ CPA Review&quot; mới thấy nút &quot;Kết nối Sheet&quot;/&quot;Hướng
                  dẫn&quot; này — Quản lý (Admin) cấp thêm quyền cho role khác ở trang Phân quyền.
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function GuideStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text">{title}</p>
        <div className="mt-0.5 text-xs leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
