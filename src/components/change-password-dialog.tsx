"use client";

import { useState } from "react";
import { Key, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useT } from "@/lib/i18n";

export function ChangePasswordDialog({ userId }: { userId: string }) {
  const changePassword = useAppStore((s) => s.changePassword);
  const t = useT();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setSuccess(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newPassword.trim()) {
      setError(t("pwd.errEmpty"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("pwd.errMismatch"));
      return;
    }
    const ok = await changePassword(userId, currentPassword, newPassword);
    if (!ok) {
      setError(t("pwd.errWrongCurrent"));
      return;
    }
    setError("");
    setSuccess(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  return (
    <>
      <button
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <Key size={16} />
        {t("nav.changePassword")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <form onSubmit={handleSubmit} className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("pwd.title")}</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs text-text-dim">{t("pwd.current")}</label>
                <input
                  type="password"
                  autoFocus
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-dim">{t("pwd.new")}</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-dim">{t("pwd.confirmNew")}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
            </div>

            {error && (
              <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                <AlertCircle size={13} className="shrink-0" />
                {error}
              </div>
            )}
            {success && (
              <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                <CheckCircle2 size={13} className="shrink-0" />
                {t("pwd.success")}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover"
              >
                {t("common.close")}
              </button>
              <button type="submit" className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white">
                {t("pwd.save")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
