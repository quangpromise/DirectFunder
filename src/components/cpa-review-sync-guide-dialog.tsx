"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X, Copy, Check, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api-client";
import { useT } from "@/lib/i18n";
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
  const t = useT();

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
        {t("cpaReviewGuide.button")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
            <div className="popover flex max-h-full w-full max-w-xl flex-col rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-sm font-semibold">{t("cpaReviewGuide.title")}</h3>
                <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5 pb-5 text-sm text-text-dim">
                {info && !info.serviceAccountConfigured && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{t("cpaReviewGuide.missingServiceAccount")}</span>
                  </div>
                )}

                <GuideStep n={1} title={t("cpaReviewGuide.step1.title")}>
                  <p>{t("cpaReviewGuide.step1.text", { month: monthKeyLabel(month) })}</p>
                  <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5">
                    <code className="min-w-0 flex-1 truncate text-xs text-text">
                      {info?.serviceAccountEmail ?? t("cpaReviewGuide.loading")}
                    </code>
                    <button
                      onClick={copyEmail}
                      disabled={!info?.serviceAccountEmail}
                      className="shrink-0 text-text-faint transition hover:text-text disabled:opacity-40"
                      title={t("cpaReviewGuide.copy")}
                      aria-label={t("cpaReviewGuide.copyEmailAria")}
                    >
                      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    </button>
                  </div>
                </GuideStep>

                <GuideStep n={2} title={t("cpaReviewGuide.step2.title")}>
                  <p>{t("cpaReviewGuide.step2.text", { btn: t("cpaReviewConnect.connectBtn") })}</p>
                </GuideStep>

                <GuideStep n={3} title={t("cpaReviewGuide.step3.title")}>
                  <p>{t("cpaReviewGuide.step3.text")}</p>
                  {info?.appsScript && (
                    <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5">
                      <span className="text-[11px] text-text-faint">{t("cpaReviewGuide.step3.alreadyConnected")}</span>
                      <button
                        onClick={copyScript}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-dim transition hover:bg-surface-hover hover:text-text"
                      >
                        {scriptCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        {scriptCopied ? t("cpaReviewGuide.copied") : t("cpaReviewGuide.copyScript")}
                      </button>
                    </div>
                  )}
                </GuideStep>

                <GuideStep n={4} title={t("cpaReviewGuide.step4.title")}>
                  <p>{t("cpaReviewGuide.step4.text")}</p>
                </GuideStep>

                <GuideStep n={5} title={t("cpaReviewGuide.step5.title")}>
                  <p>{t("cpaReviewGuide.step5.text")}</p>
                </GuideStep>

                <p className="mt-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-faint">
                  {t("cpaReviewGuide.footnote")}
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
