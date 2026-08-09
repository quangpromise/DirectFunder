"use client";

import { useState } from "react";
import { Plus, Trash2, ShieldAlert, X } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { ROLE_LABEL, Role } from "@/lib/types";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { AvatarUpload } from "@/components/avatar-upload";
import { RoleBadge } from "@/components/role-badge";
import { useT, useLanguage } from "@/lib/i18n";

const PALETTE = ["#14b8a6", "#22c55e", "#3b82f6", "#eab308", "#06b6d4", "#ec4899"];

export default function UsersPage() {
  const user = useCurrentUser();
  const users = useAppStore((s) => s.users);
  const addUser = useAppStore((s) => s.addUser);
  const updateUserRole = useAppStore((s) => s.updateUserRole);
  const removeUser = useAppStore((s) => s.removeUser);
  const updateAvatar = useAppStore((s) => s.updateAvatar);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [formError, setFormError] = useState("");
  const t = useT();
  const { language } = useLanguage();

  if (!user) return null;

  if (user.role !== "manager") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <ShieldAlert size={28} className="text-text-faint" />
        <p className="text-sm text-text-dim">{t("users.accessDenied")}</p>
      </div>
    );
  }

  const managerCount = users.filter((u) => u.role === "manager").length;

  async function handleAdd() {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setFormError(t("users.errRequired"));
      return;
    }
    if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
      setFormError(t("users.errEmailTaken"));
      return;
    }
    const ok = await addUser({
      name: name.trim(),
      email: email.trim(),
      password: password.trim(),
      role,
      avatarColor: PALETTE[users.length % PALETTE.length],
    });
    if (!ok) {
      setFormError(t("users.errEmailTaken"));
      return;
    }
    setName("");
    setEmail("");
    setPassword("");
    setRole("agent");
    setFormError("");
    setOpen(false);
  }

  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t("users.title")}</h1>
          <p className="mt-0.5 text-xs text-text-faint">{users.length} {t("users.count")}</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="gradient-btn flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium text-white shadow-lg shadow-orange-950/30"
        >
          <Plus size={14} />
          {t("users.add")}
        </button>
      </div>

      <div className="mt-5 flex gap-3 overflow-x-auto pb-2">
        {users.map((u) => {
          const isLastManager = u.role === "manager" && managerCount <= 1;
          return (
            <div
              key={u.id}
              className="flex w-60 shrink-0 flex-col gap-2.5 rounded-xl border border-border bg-surface p-4"
            >
              <div className="flex items-center gap-2.5">
                <AvatarUpload
                  name={u.name}
                  color={u.avatarColor}
                  url={u.avatarUrl}
                  onChange={(url) => updateAvatar(u.id, url)}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.name}</div>
                  <div className="truncate text-xs text-text-faint">{u.email}</div>
                </div>
              </div>

              <RoleBadge role={u.role} />

              <div className="flex items-center gap-1.5">
                <select
                  value={u.role}
                  onChange={(e) => updateUserRole(u.id, e.target.value as Role)}
                  disabled={isLastManager}
                  className="w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs outline-none focus:border-accent disabled:opacity-50"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[language][r]}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => removeUser(u.id)}
                  disabled={isLastManager || u.id === user.id}
                  title={isLastManager ? t("users.deleteLastManager") : u.id === user.id ? t("users.deleteSelf") : t("users.delete")}
                  className="shrink-0 rounded-lg border border-border p-1.5 text-text-faint transition hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-text-faint"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("users.addNew")}</h3>
              <button
                onClick={() => {
                  setFormError("");
                  setOpen(false);
                }}
                className="text-text-faint hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs text-text-dim">{t("users.fullName")}</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("users.fullNamePlaceholder")}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-dim">{t("users.email")}</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ten@directfunder.com"
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-dim">{t("users.password")}</label>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("users.passwordPlaceholder")}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-dim">{t("users.role")}</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[language][r]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {formError && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {formError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setFormError("");
                  setOpen(false);
                }}
                className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover"
              >
                {t("common.cancel")}
              </button>
              <button onClick={handleAdd} className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white">
                {t("users.add")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
