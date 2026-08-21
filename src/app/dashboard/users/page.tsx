"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, ShieldAlert, X, Users, Key, Mail, CheckCircle2, Search } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { ROLE_LABEL, Role, LEADER_MANAGES_ROLE, User } from "@/lib/types";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { AvatarUpload } from "@/components/avatar-upload";
import { useConfirm } from "@/components/confirm-dialog";
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
  const updateUserEmail = useAppStore((s) => s.updateUserEmail);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(DEFAULT_NEW_USER_PASSWORD);
  const [role, setRole] = useState<Role>("agent");
  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [search, setSearch] = useState("");
  const [teamEditUserId, setTeamEditUserId] = useState<string | null>(null);
  const [resetPwUserId, setResetPwUserId] = useState<string | null>(null);
  const [resetPwValue, setResetPwValue] = useState(DEFAULT_NEW_USER_PASSWORD);
  const [resetPwError, setResetPwError] = useState("");
  const [resetPwSuccess, setResetPwSuccess] = useState(false);
  const [editEmailUserId, setEditEmailUserId] = useState<string | null>(null);
  const [editEmailValue, setEditEmailValue] = useState("");
  const [editEmailError, setEditEmailError] = useState("");
  const [editEmailSuccess, setEditEmailSuccess] = useState(false);
  const t = useT();
  const { language } = useLanguage();
  const { confirm, ConfirmDialogUI } = useConfirm();

  async function handleRemoveUser(u: User) {
    const ok = await confirm(t("users.deleteConfirm", { name: u.name }), {
      title: t("users.deleteConfirmTitle"),
      tone: "danger",
    });
    if (ok) removeUser(u.id);
  }

  // Lọc theo tên/email/username rồi nhóm theo vai trò (thứ tự cố định theo ASSIGNABLE_ROLES)
  // để danh sách tài khoản dễ nhìn hơn khi số lượng tăng lên — mỗi nhóm là 1 khối tiêu đề +
  // lưới card riêng, thay vì 1 lưới phẳng lẫn lộn mọi vai trò như trước. Đặt 2 useMemo này
  // TRƯỚC early-return bên dưới — Hooks phải gọi theo đúng thứ tự cố định ở mọi lần render.
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, search]);

  const groupedUsers = useMemo(
    () =>
      ASSIGNABLE_ROLES.map((r) => ({ role: r, list: filteredUsers.filter((u) => u.role === r) })).filter(
        (g) => g.list.length > 0
      ),
    [filteredUsers]
  );

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
    // Username không còn là ô nhập riêng — server tự lấy NGUYÊN Họ tên làm username đăng
    // nhập thay thế (xem POST /api/users), tự bỏ qua nếu trùng tên với tài khoản khác thay
    // vì chặn tạo mới (đăng nhập bằng email vẫn luôn hoạt động).
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

  const editEmailUser = users.find((u) => u.id === editEmailUserId) ?? null;

  function openEditEmail(userId: string, currentEmail: string) {
    setEditEmailUserId(userId);
    setEditEmailValue(currentEmail);
    setEditEmailError("");
    setEditEmailSuccess(false);
  }

  async function handleEditEmail() {
    if (!editEmailUser) return;
    if (!editEmailValue.trim()) {
      setEditEmailError(t("users.errRequired"));
      return;
    }
    const res = await updateUserEmail(editEmailUser.id, editEmailValue.trim());
    if (!res.ok) {
      setEditEmailError(res.error || t("users.editEmailError"));
      return;
    }
    setEditEmailError("");
    setEditEmailSuccess(true);
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
      {ConfirmDialogUI}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t("users.title")}</h1>
          <p className="mt-0.5 text-xs text-text-faint">{users.length} {t("users.count")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("users.search")}
              className="h-9 w-56 rounded-lg border border-border bg-bg-elevated pl-8 pr-3 text-sm outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={() => setOpen(true)}
            className="gradient-btn flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium text-white shadow-lg shadow-blue-950/30"
          >
            <Plus size={14} />
            {t("users.add")}
          </button>
        </div>
      </div>

      {/* Nhóm theo vai trò (thứ tự cố định ASSIGNABLE_ROLES) — mỗi nhóm 1 tiêu đề + lưới
          riêng, co giãn theo số cột màn hình. Card đã thu gọn (2026-08-13, bỏ ô Username
          riêng + gộp các nút hành động thành 1 hàng icon) để nhiều tài khoản vừa trong 1
          khung màn hình hơn, giảm bớt việc phải cuộn. */}
      <div className="mt-5 max-h-[75vh] overflow-y-auto rounded-xl border border-border-strong p-3">
        {groupedUsers.length === 0 && (
          <div className="px-2 py-6 text-center text-sm text-text-faint">{t("users.noResults")}</div>
        )}
        <div className="flex flex-col gap-5">
          {groupedUsers.map(({ role: groupRole, list }) => (
            <div key={groupRole}>
              <div className="mb-2 flex items-center gap-2 px-0.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-dim">
                  {ROLE_LABEL[language][groupRole]}
                </span>
                <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-faint">
                  {list.length}
                </span>
              </div>
              {/* flex-wrap (thay grid cột đều 2026-08-13) — mỗi card rộng VỪA ĐỦ theo nội
                  dung của chính nó (chủ yếu là email, phần tử dài nhất trong card) thay vì
                  bị kéo giãn bằng nhau theo số cột cố định, nên gói được nhiều card/hàng
                  hơn khi tên/email ngắn. */}
              <div className="flex flex-wrap gap-2">
                {list.map((u) => (
                  <UserCard
                    key={u.id}
                    u={u}
                    isLastManager={u.role === "manager" && managerCount <= 1}
                    isSelf={u.id === user.id}
                    onRoleChange={(r) => updateUserRole(u.id, r)}
                    onRemove={() => handleRemoveUser(u)}
                    onAvatarChange={(url) => updateAvatar(u.id, url)}
                    onOpenResetPassword={() => openResetPassword(u.id)}
                    onOpenEditEmail={() => openEditEmail(u.id, u.email)}
                    onOpenTeamEdit={() => setTeamEditUserId(u.id)}
                  />
                ))}
              </div>
            </div>
          ))}
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

      {editEmailUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {t("users.editEmail")} — {editEmailUser.name}
              </h3>
              <button onClick={() => setEditEmailUserId(null)} className="text-text-faint hover:text-text">
                <X size={16} />
              </button>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-text-dim">{t("users.newEmail")}</label>
              <input
                autoFocus
                type="email"
                value={editEmailValue}
                onChange={(e) => {
                  setEditEmailValue(e.target.value);
                  setEditEmailSuccess(false);
                }}
                placeholder="ten@directfunder.com"
                className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            {editEmailError && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 light:text-red-700">
                {editEmailError}
              </div>
            )}
            {editEmailSuccess && (
              <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 light:text-emerald-700">
                <CheckCircle2 size={13} className="shrink-0" />
                {t("users.editEmailSuccess")}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setEditEmailUserId(null)}
                className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover"
              >
                {t("common.close")}
              </button>
              <button
                onClick={handleEditEmail}
                className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white"
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 1 thẻ tài khoản — thu gọn (2026-08-13): bỏ ô Username riêng (username giờ tự lấy từ Họ
 * tên ở server, không cần Admin tự gõ/sửa), gộp Reset mật khẩu/Quản lý nhóm/Xoá thành 1
 * hàng icon thay vì 3 nút chữ đầy chiều rộng — để nhiều tài khoản vừa trong 1 khung màn
 * hình hơn (yêu cầu 2026-08-13). Badge vai trò cũng bỏ (đã có tiêu đề nhóm theo vai trò ở
 * component cha, hiện lại là dư thừa). */
function UserCard({
  u,
  isLastManager,
  isSelf,
  onRoleChange,
  onRemove,
  onAvatarChange,
  onOpenResetPassword,
  onOpenEditEmail,
  onOpenTeamEdit,
}: {
  u: User;
  isLastManager: boolean;
  isSelf: boolean;
  onRoleChange: (role: Role) => void;
  onRemove: () => void;
  onAvatarChange: (url: string | null) => void;
  onOpenResetPassword: () => void;
  onOpenEditEmail: () => void;
  onOpenTeamEdit: () => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  const isTeamLead = Boolean(LEADER_MANAGES_ROLE[u.role]);

  // Rộng CỐ ĐỊNH vừa đủ chứa email (phần tử dài nhất trong card, thường ~20-32 ký tự) thay
  // vì co giãn theo số cột như grid cũ — dưới flex-wrap ở component cha, card hẹp lại tự
  // xếp nhiều hơn/hàng khi màn hình rộng (2026-08-13).
  return (
    <div className="flex w-60 min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-2.5">
      <div className="flex items-center gap-2">
        <AvatarUpload name={u.name} color={u.avatarColor} url={u.avatarUrl} size={28} onChange={onAvatarChange} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{u.name}</div>
          <div className="truncate text-[11px] text-text-faint">{u.email}</div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <select
          value={u.role}
          onChange={(e) => onRoleChange(e.target.value as Role)}
          disabled={isLastManager}
          className="w-full min-w-0 rounded-md border border-border bg-bg-elevated px-1.5 py-1 text-[11px] outline-none focus:border-accent disabled:opacity-50"
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[language][r]}
            </option>
          ))}
        </select>

        <button
          onClick={onOpenResetPassword}
          title={t("users.resetPassword")}
          aria-label={t("users.resetPassword")}
          className="shrink-0 rounded-md border border-border p-1.5 text-text-faint transition hover:bg-surface-hover hover:text-text"
        >
          <Key size={13} />
        </button>

        <button
          onClick={onOpenEditEmail}
          title={t("users.editEmail")}
          aria-label={t("users.editEmail")}
          className="shrink-0 rounded-md border border-border p-1.5 text-text-faint transition hover:bg-surface-hover hover:text-text"
        >
          <Mail size={13} />
        </button>

        {isTeamLead && (
          <button
            onClick={onOpenTeamEdit}
            title={`${t("users.manageTeam")} (${(u.teamMemberIds ?? []).length})`}
            aria-label={t("users.manageTeam")}
            className="shrink-0 rounded-md border border-border p-1.5 text-text-faint transition hover:bg-surface-hover hover:text-text"
          >
            <Users size={13} />
          </button>
        )}

        <button
          onClick={onRemove}
          disabled={isLastManager || isSelf}
          title={isLastManager ? t("users.deleteLastManager") : isSelf ? t("users.deleteSelf") : t("users.delete")}
          aria-label={t("users.delete")}
          className="shrink-0 rounded-md border border-border p-1.5 text-text-faint transition hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-text-faint"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
