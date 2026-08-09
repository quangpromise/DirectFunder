"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, AlertCircle, Clock } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } from "@/lib/mock-data";
import { useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/language-switcher";

const RECENT_ACCOUNTS_KEY = "direct-funder-recent-accounts";
const MAX_RECENT_ACCOUNTS = 5;

function loadRecentAccounts(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_ACCOUNTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveRecentAccount(email: string) {
  if (typeof window === "undefined") return;
  const existing = loadRecentAccounts().filter((e) => e.toLowerCase() !== email.toLowerCase());
  const next = [email, ...existing].slice(0, MAX_RECENT_ACCOUNTS);
  window.localStorage.setItem(RECENT_ACCOUNTS_KEY, JSON.stringify(next));
}

export default function LoginPage() {
  const router = useRouter();
  const login = useAppStore((s) => s.login);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [recentAccounts, setRecentAccounts] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const emailWrapRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => setRecentAccounts(loadRecentAccounts()), []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (emailWrapRef.current && !emailWrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredSuggestions = recentAccounts.filter((e) => e.toLowerCase().includes(email.toLowerCase()));

  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const ok = await login(email, password);
    setSubmitting(false);
    if (!ok) {
      setError(t("login.error"));
      return;
    }
    setError("");
    saveRecentAccount(email);
    // Support chỉ có quyền trên tab Order, không có tab Hồ sơ — đưa thẳng vào Order.
    const state = useAppStore.getState();
    const loggedInUser = state.users.find((u) => u.id === state.currentUserId);
    router.push(loggedInUser?.role === "support" ? "/dashboard/orders" : "/dashboard/cases");
  }

  return (
    <main className="relative flex min-h-screen flex-1 flex-col items-center justify-center overflow-hidden px-4 py-16 bg-glow">
      <div className="pointer-events-none absolute inset-0 bg-bg" style={{ zIndex: -1 }} />

      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <LanguageSwitcher />
      </div>

      <div className="mb-10 flex flex-col items-center gap-3 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl gradient-btn shadow-lg shadow-orange-950/40">
          <span className="text-lg font-bold text-white">D</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          <span className="gradient-text">Direct Funder</span>
        </h1>
        <p className="max-w-sm text-sm text-text-dim">{t("login.tagline")}</p>
      </div>

      <form onSubmit={handleSubmit} className="glass w-full max-w-sm rounded-2xl p-6 shadow-2xl shadow-black/40">
        <h2 className="text-sm font-medium text-text">{t("login.heading")}</h2>

        <div className="mt-4 flex flex-col gap-3">
          <div ref={emailWrapRef} className="relative">
            <label className="mb-1 block text-xs text-text-dim">{t("login.email")}</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onClick={() => setShowSuggestions(true)}
              placeholder="ten@directfunder.com"
              autoComplete="off"
              className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="popover absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-lg shadow-2xl shadow-black/40">
                {filteredSuggestions.map((acc) => (
                  <button
                    key={acc}
                    type="button"
                    onClick={() => {
                      setEmail(acc);
                      setShowSuggestions(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
                  >
                    <Clock size={12} className="shrink-0 text-text-faint" />
                    <span className="truncate">{acc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-text-dim">{t("login.password")}</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 pr-9 text-sm outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text"
                aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertCircle size={13} className="shrink-0" />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="gradient-btn mt-4 flex h-10 w-full items-center justify-center rounded-lg text-sm font-medium text-white shadow-lg shadow-orange-950/30 disabled:opacity-60"
        >
          {t("login.submit")}
        </button>

        <div className="mt-4 rounded-lg border border-border bg-bg-elevated/60 px-3 py-2.5 text-xs text-text-faint">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            {t("login.defaultAdmin")}
          </div>
          <div className="mt-1 pl-3.5">
            {DEFAULT_ADMIN_EMAIL} / {DEFAULT_ADMIN_PASSWORD}
          </div>
        </div>
      </form>

      <p className="mt-8 text-xs text-text-faint">{t("login.footer")}</p>
    </main>
  );
}
