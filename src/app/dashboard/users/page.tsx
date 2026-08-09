"use client";

import { useState } from "react";
import { Plus, Trash2, ShieldAlert, X, Users, Key, CheckCircle2 } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { ROLE_LABEL, Role, LEADER_MANAGES_ROLE } from "@/lib/types";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { AvatarUpload } from "@/components/avatar-upload";
import { RoleBadge } from "@/components/role-badge";
import { useT, useLanguage } from "@/lib/i18n";

const PALETTE = ["#14b8a6", "#22c55e", "#3b82f6", "#eab308", "#06b6d4", "#ec4899"];

// Mật khẩu mặc định cho tài khoản mới do Admin tạo, và giá trị gợi ý sẵn khi Admin đặt
// lại mật khẩu tài khoản khác — xem .claude/rules/workflow-conventions.md (mọi tài khoản
// test dùng chung mật khẩu này, không cần tự đổi mỗi lần test).
const DEFAULT_NEW_USER_PASSWORD = "12345678";

export default function UsersPage() {
  const user = useCurrentUser();
  const users = useAppStore((s) => s.users);
  const addUser = useAppStore((s) => s.addUser);
  const updateUserRole = useAppStore((s) => s.updateUserRole);
  const removeUser = useAppStore((s) => s.removeUser);
  const updateAvatar = useAppStore((s) => s.updateAvatar);
  const updateUserTeam = useAppStore((s) => s.updateUserTeam);
  const resetUserPassword = useAppStore((s) => s.resetUserPassword);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(DEFAULT_NEW_USER_PASSWORD);
  const [role, setRole] = useState<Role>("agent");
  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [teamEditUserId, setTeamEditUserId] = useState<string | null>(null);
  const [resetPwUserId, setResetPwUserId] = useState<string | null>(null);
  const [resetPwValue, setResetPwValue] = useState(DEFAULT_NEW_USER_PASSWORD);
  const [resetPwError, setResetPwError] = useState("");
  const [resetPwSuccess, setResetPwSuccess] = useState(false);
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
      teamMemberIds: LEADER_MANAGES_ROLE[role] ? teamMemberIds : undefined,
    });
    if (!ok) {
      setFormError(t("users.errEmailTaken"));
      return;
    }
    setName("");
    setEmail("");
    setPassword(DEFAULT_NEW_USER_PASSWORD);
    setRole("agent");
    setTeamMemberIds([]);
    setFormError("");
    setOpen(false);
  }

  const resetPwUser = users.find((u) => u.id === resetPwUserId) ?? null;

  function openResetPassword(userId: string) {
    setResetPwUserId(userId);
    setResetPwValue(DEFAULT_NEW_USER_PASSWORD);
    setResetPwError("");
    setResetPwSuccess(false);
  }

  async function handleResetPassword() {
    if (!resetPwUser) return;
    if (!resetPwValue.trim()) {
      setResetPwError(t("users.errRequired"));
      return;
    }
    const ok = await resetUserPassword(resetPwUser.id, resetPwValue.trim());
    if (!ok) {
      setResetPwError(t("users.resetPwError"));
      return;
    }
    setResetPwError("");
    setResetPwSuccess(true);
  }

  const teamEditUser = users.find((u) => u.id === teamEditUserId) ?? null;
  const teamEditManagesRole = teamEditUser ? LEADER_MANAGES_ROLE[teamEditUser.role] : undefined;
  const teamEditCandidates = teamEditManagesRole ? users.filter((u) => u.role === teamEditManagesRole) : [];

  const createManagesRole = LEADER_MANAGES_ROLE[role];
  const createCandidates = createManagesRole ? users.filter((u) => u.role === createManagesRole) : [];

  function toggleTeamMember(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
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
          className="gradient-btn flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium text-white shadow-lg shadow-blue-950/30"
        >
          <Plus size={14} />
          {t("users.add")}
        </button>
      </div>

      {/* Lưới co giãn theo số cột màn hình (giống bảng Phân quyền — gói gọn trong 1 khối
          cuộn dọc max-h-[65vh]) thay vì hàng ngang cuộn ngang cũ — thêm bao nhiêu tài
          khoản cũng luôn xem được hết trong 1 màn hình, chỉ cuộn dọc khi quá dài. */}
      <div className="mt-5 max-h-[65vh] overflow-y-auto rounded-xl border border-border-strong p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {users.map((u) => {
          const isLastManager = u.role === "manager" && managerCount <= 1;
          return (
            <div
              key={u.id}
              className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-surface p-4"
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

              <button
                onClick={() => openResetPassword(u.id)}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text"
              >
                <Key size={13} />
                {t("users.resetPassword")}
              </button>

              {LEADER_MANAGES_ROLE[u.role] && (
                <button
                  onClick={() => setTeamEditUserId(u.id)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-dim transition hover:bg-surface-hover hover:text-text"
                >
                  <Users size={13} />
                  {t("users.manageTeam")} ({(u.teamMemberIds ?? []).length})
                </button>
              )}
            </div>
          );
        })}
        </div>
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
                  onChange={(e) => {
                    setRole(e.target.value as Role);
                    setTeamMemberIds([]);
                  }}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[language][r]}
                    </option>
                  ))}
                </select>
              </div>

              {createManagesRole && (
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("users.teamMembers")}</label>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-2">
                    {createCandidates.length === 0 && (
                      <div className="px-1 py-1.5 text-xs text-text-faint">{t("users.noCandidates")}</div>
                    )}
                    {createCandidates.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs hover:bg-surface-hover">
                        <input
                          type="checkbox"
                          checked={teamMemberIds.includes(c.id)}
                          onChange={() => setTeamMemberIds((list) => toggleTeamMember(list, c.id))}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {formError && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 light:text-red-700">
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

      {teamEditUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {t("users.manageTeam")} — {teamEditUser.name}
              </h3>
              <button onClick={() => setTeamEditUserId(null)} className="text-text-faint hover:text-text">
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-2">
              {teamEditCandidates.length === 0 && (
                <div className="px-1 py-1.5 text-xs text-text-faint">{t("users.noCandidates")}</div>
              )}
              {teamEditCandidates.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={(teamEditUser.teamMemberIds ?? []).includes(c.id)}
                    onChange={() => updateUserTeam(teamEditUser.id, toggleTeamMember(teamEditUser.teamMemberIds ?? [], c.id))}
                  />
                  {c.name}
                </label>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setTeamEditUserId(null)}
                className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white"
              >
                {t("common.done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetPwUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {t("users.resetPassword")} — {resetPwUser.name}
              </h3>
              <button onClick={() => setResetPwUserId(null)} className="text-text-faint hover:text-text">
                <X size={16} />
              </button>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-text-dim">{t("users.newPassword")}</label>
              <input
                autoFocus
                value={resetPwValue}
                onChange={(e) => {
                  setResetPwValue(e.target.value);
                  setResetPwSuccess(false);
                }}
                className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            {resetPwError && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 light:text-red-700">
                {resetPwError}
              </div>
            )}
            {resetPwSuccess && (
              <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 light:text-emerald-700">
                <CheckCircle2 size={13} className="shrink-0" />
                {t("users.resetPwSuccess")}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setResetPwUserId(null)}
                className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover"
              >
                {t("common.close")}
              </button>
              <button
                onClick={handleResetPassword}
                className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white"
              >
                {t("pwd.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
