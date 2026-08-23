"use client";

import { useState } from "react";
import { Languages, ArrowRightLeft, Copy, Check, Loader2, AlertCircle } from "lucide-react";
import { TRANSLATE_LANGUAGES } from "@/lib/google-translate";
import { useLanguage, useT } from "@/lib/i18n";

const AUTO = "auto";

/**
 * Nút "Dịch" trên header (Languages icon, cạnh chuông thông báo) — dịch văn bản tự do người
 * dùng gõ/dán, KHÔNG gắn với hồ sơ/dữ liệu nào (thêm 2026-08-24, thay cho việc mở tab riêng
 * translate.google.com). Cho MỌI role, không cần quyền riêng — cùng tinh thần "My Notes".
 */
export function TranslateWidget() {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState(AUTO);
  const { language } = useLanguage();
  const [target, setTarget] = useState<string>(language);
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [detected, setDetected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const t = useT();

  async function handleTranslate() {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target, source: source === AUTO ? undefined : source }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? t("translate.failed"));
        setResult("");
        return;
      }
      setResult(data.translatedText);
      setDetected(data.detectedSourceLanguage ?? "");
    } catch {
      setError(t("translate.failed"));
    } finally {
      setLoading(false);
    }
  }

  function swapLanguages() {
    if (source === AUTO) return;
    setSource(target);
    setTarget(source);
    setText(result);
    setResult(text);
  }

  async function copyResult() {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={t("translate.button")}
        aria-label={t("translate.button")}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-dim transition hover:bg-surface-hover hover:text-text active:scale-95"
      >
        <Languages size={17} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="popover absolute right-0 z-50 mt-2 w-[min(92vw,420px)] rounded-xl p-3 shadow-2xl shadow-black/60">
            <div className="mb-2 flex items-center gap-2">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-bg-elevated px-2 text-xs text-text"
              >
                <option value={AUTO}>{t("translate.autoDetect")}</option>
                {TRANSLATE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <button
                onClick={swapLanguages}
                disabled={source === AUTO}
                title={t("translate.swap")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-text-dim transition hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-40"
              >
                <ArrowRightLeft size={13} />
              </button>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-bg-elevated px-2 text-xs text-text"
              >
                {TRANSLATE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("translate.placeholder")}
              rows={3}
              maxLength={5000}
              className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-2.5 py-2 text-sm outline-none focus:border-accent"
            />

            <button
              onClick={handleTranslate}
              disabled={loading || !text.trim()}
              className="gradient-btn mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-white disabled:cursor-default disabled:opacity-60"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {loading ? t("translate.translating") : t("translate.translateBtn")}
            </button>

            {error && (
              <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300 light:text-red-700">
                <AlertCircle size={12} className="shrink-0" />
                {error}
              </div>
            )}

            {result && !error && (
              <div className="relative mt-2 rounded-lg border border-border bg-bg-elevated px-2.5 py-2 pr-8 text-sm">
                {result}
                {detected && source === AUTO && (
                  <div className="mt-1 text-[11px] text-text-faint">
                    {t("translate.detected", {
                      lang: TRANSLATE_LANGUAGES.find((l) => l.code === detected)?.label ?? detected,
                    })}
                  </div>
                )}
                <button
                  onClick={copyResult}
                  title={t("translate.copy")}
                  className="absolute right-2 top-2 text-text-faint transition hover:text-text"
                >
                  {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
