"use client";

import { useState } from "react";
import { Pencil, Trash2, Send, ScrollText } from "lucide-react";
import { useAppStore, useCurrentUser } from "@/store/app-store";
import { RuleRecord } from "@/lib/types";
import { ruleIsNewToday, newRuleCountToday, sortRulesForDisplay } from "@/lib/rules";
import { stripHtmlTags, toRuleDisplayHtml } from "@/lib/rich-text";
import { hasFeature } from "@/lib/rbac";
import { Avatar } from "@/components/avatar";
import { RichTextEditor } from "@/components/rich-text-editor";
import { useConfirm } from "@/components/confirm-dialog";
import { useAlert } from "@/components/alert-dialog";
import { useT } from "@/lib/i18n";

function formatRuleDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function RuleCard({
  rule,
  authorName,
  authorColor,
  authorUrl,
  canManage,
  canPermanentlyDelete,
  onEdit,
  onDelete,
  onPermanentlyDelete,
}: {
  rule: RuleRecord;
  authorName: string;
  authorColor: string;
  authorUrl: string | null;
  canManage: boolean;
  canPermanentlyDelete: boolean;
  onEdit: (content: string) => Promise<boolean>;
  onDelete: () => void;
  onPermanentlyDelete: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.content);
  const [saving, setSaving] = useState(false);
  const deleted = Boolean(rule.deletedAt);
  const isNew = !deleted && ruleIsNewToday(rule);

  async function save() {
    if (stripHtmlTags(draft) === "" || draft === rule.content) {
      setEditing(false);
      setDraft(rule.content);
      return;
    }
    setSaving(true);
    const ok = await onEdit(draft);
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <div className={`rounded-xl border border-border bg-bg-elevated px-2.5 py-2 ${deleted ? "opacity-55" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={authorName} color={authorColor} url={authorUrl} size={20} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-text">
              <span className="truncate">{authorName}</span>
              <span className="font-normal text-text-faint">{formatRuleDate(rule.createdAt)}</span>
              {rule.updatedAt !== rule.createdAt && !deleted && (
                <span className="font-normal text-text-faint">· {t("rules.editedSuffix")}</span>
              )}
              {isNew && (
                <span className="animate-pulse rounded-full bg-yellow-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-yellow-950">
                  {t("rules.newBadge")}
                </span>
              )}
              {deleted && (
                <span className="rounded-full bg-surface px-1.5 py-0.5 text-[9px] font-medium text-text-faint">
                  {t("rules.deletedBadge")}
                </span>
              )}
            </div>
          </div>
        </div>

        {canManage && !deleted && !editing && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              onClick={() => {
                setDraft(rule.content);
                setEditing(true);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-surface-hover hover:text-text"
              title={t("rules.editBtn")}
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={onDelete}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-red-500/15 hover:text-red-400"
              title={t("rules.deleteBtn")}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}

        {deleted && canPermanentlyDelete && (
          <button
            onClick={onPermanentlyDelete}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-red-400/80 transition hover:bg-red-500/15 hover:text-red-400"
            title={t("rules.permanentDeleteBtn")}
          >
            <Trash2 size={11} />
            {t("rules.permanentDeleteBtn")}
          </button>
        )}
      </div>

      <div className="mt-1 pl-[28px]">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <RichTextEditor value={draft} onChange={setDraft} placeholder={t("rules.addPlaceholder")} />
            <div className="flex justify-end gap-1.5">
              <button
                onClick={() => {
                  setEditing(false);
                  setDraft(rule.content);
                }}
                className="rounded-md border border-border px-2.5 py-1 text-[11px] text-text-dim hover:bg-surface-hover"
              >
                {t("rules.cancelBtn")}
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="gradient-btn rounded-md px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60"
              >
                {t("rules.saveBtn")}
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`text-xs leading-snug text-text ${deleted ? "line-through text-text-faint" : ""}`}
            dangerouslySetInnerHTML={{ __html: toRuleDisplayHtml(rule.content) }}
          />
        )}
      </div>
    </div>
  );
}

/** Nút + panel "Rules" ở top-nav (kiểu bảng thông báo, giống NotificationBell) — bấm mở
 * dropdown xem/thêm/sửa/xoá rule ngay tại chỗ, KHÔNG điều hướng sang trang/tab khác (trước
 * đây là 1 route /dashboard/rules riêng, đã bỏ để khỏi phải rời màn hình đang làm việc chỉ
 * để xem bảng tin). Badge số trên icon đếm rule mới thêm hôm nay (newRuleCountToday, tự hết
 * khi qua ngày) — LUÔN hiện (khác badge cũ trên nav link trước đây phải ẩn khi đang ở trang
 * Rules, giờ không còn khái niệm "đang ở trang Rules" nữa vì đây là dropdown).
 *
 * `variant`: "icon" = nút vuông chỉ icon + badge góc (dùng khi đặt riêng lẻ trong icon row).
 * "tab" = nút dạng pill icon+nhãn+badge inline, GIỐNG hệt style Link điều hướng khác (Hồ sơ/
 * Order) — dùng khi đặt Rules NGAY TRONG hàng tab điều hướng theo đúng thứ tự Cases -> Orders
 * -> Rules (yêu cầu 2026-08-11), để đồng bộ hình thức dù vẫn là dropdown chứ không phải Link
 * điều hướng thật (không đổi URL/route). */
export function RulesPanel({ variant = "icon" }: { variant?: "icon" | "tab" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const user = useCurrentUser();
  const users = useAppStore((s) => s.users);
  const rules = useAppStore((s) => s.rules);
  const permissions = useAppStore((s) => s.featurePermissions);
  const addRule = useAppStore((s) => s.addRule);
  const editRule = useAppStore((s) => s.editRule);
  const deleteRule = useAppStore((s) => s.deleteRule);
  const permanentlyDeleteRule = useAppStore((s) => s.permanentlyDeleteRule);
  const { confirm, ConfirmDialogUI } = useConfirm();
  const { alertWarn, AlertDialogUI } = useAlert();

  const [newContent, setNewContent] = useState("");
  const [posting, setPosting] = useState(false);

  if (!user) return null;
  const canManage = hasFeature(permissions, "manageRules", user.role);
  // Xoá vĩnh viễn hard-code role "manager" (KHÔNG dùng feature manageRules cấu hình được) —
  // không thể hoàn tác nên không giao được cho role khác qua trang Phân quyền, xem
  // requireManageRules/DELETE ?hard=1 trong src/app/api/rules/[id]/route.ts.
  const canPermanentlyDelete = user.role === "manager";
  const ordered = sortRulesForDisplay(rules);
  const newCount = newRuleCountToday(rules);

  async function post() {
    if (stripHtmlTags(newContent) === "") return;
    setPosting(true);
    const res = await addRule(newContent);
    setPosting(false);
    if (!res.ok) {
      await alertWarn(res.error || t("rules.addError"));
      return;
    }
    setNewContent("");
  }

  return (
    <div className="relative">
      {ConfirmDialogUI}
      {AlertDialogUI}
      {variant === "tab" ? (
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-sm text-text-dim transition hover:bg-surface-hover hover:text-text"
          aria-label={t("rules.title")}
        >
          <ScrollText size={15} />
          {t("rules.title")}
          {newCount > 0 && (
            <span className="animate-pulse rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-950">
              {newCount}
            </span>
          )}
        </button>
      ) : (
        <button
          onClick={() => setOpen((o) => !o)}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-dim transition hover:bg-surface-hover hover:text-text active:scale-95"
          aria-label={t("rules.title")}
          title={t("rules.title")}
        >
          <ScrollText size={16} />
          {newCount > 0 && (
            <span className="animate-pulse absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-amber-950">
              {newCount}
            </span>
          )}
        </button>
      )}

      {open &&
        (() => {
          const panelBody = (
            <>
              <div className="flex items-center gap-2 px-3.5 pb-2 pt-3">
                <ScrollText size={15} className="text-accent" />
                <span className="text-[15px] font-bold tracking-tight text-text">{t("rules.title")}</span>
              </div>

              {canManage && (
                <div className="mx-3 mb-2 shrink-0 rounded-xl border border-border bg-bg-elevated p-2">
                  <RichTextEditor value={newContent} onChange={setNewContent} placeholder={t("rules.addPlaceholder")} />
                  <div className="mt-1.5 flex justify-end">
                    <button
                      onClick={post}
                      disabled={posting || stripHtmlTags(newContent) === ""}
                      className="gradient-btn flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      <Send size={12} />
                      {t("rules.addBtn")}
                    </button>
                  </div>
                </div>
              )}

              {ordered.length === 0 ? (
                <div className="px-3 pb-4 pt-2 text-center text-xs text-text-faint">{t("rules.empty")}</div>
              ) : (
                <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto px-3 pb-3">
                  {ordered.map((rule) => {
                    const author = users.find((u) => u.id === rule.createdBy);
                    return (
                      <RuleCard
                        key={rule.id}
                        rule={rule}
                        authorName={author?.name ?? "—"}
                        authorColor={author?.avatarColor ?? "#3b8fd1"}
                        authorUrl={author?.avatarUrl ?? null}
                        canManage={canManage}
                        canPermanentlyDelete={canPermanentlyDelete}
                        onEdit={async (content) => {
                          const res = await editRule(rule.id, content);
                          if (!res.ok) {
                            await alertWarn(res.error || t("rules.editError"));
                            return false;
                          }
                          return true;
                        }}
                        onDelete={async () => {
                          const ok = await confirm(t("rules.deleteConfirm"), { title: t("rules.deleteTitle"), tone: "danger" });
                          if (!ok) return;
                          const res = await deleteRule(rule.id);
                          if (!res.ok) await alertWarn(res.error || t("rules.deleteError"));
                        }}
                        onPermanentlyDelete={async () => {
                          const ok = await confirm(t("rules.permanentDeleteConfirm"), {
                            title: t("rules.permanentDeleteTitle"),
                            tone: "danger",
                          });
                          if (!ok) return;
                          const res = await permanentlyDeleteRule(rule.id);
                          if (!res.ok) await alertWarn(res.error || t("rules.permanentDeleteError"));
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </>
          );

          return (
            <>
              {/* Desktop (sm+): dropdown neo theo trigger như cũ. */}
              <div className="fixed inset-0 z-40 hidden sm:block" onClick={() => setOpen(false)} />
              <div className="popover absolute right-0 z-50 mt-2 hidden w-96 max-w-[92vw] flex-col rounded-2xl p-0 shadow-2xl shadow-black/60 sm:flex">
                {panelBody}
              </div>

              {/* Mobile: neo theo cạnh trigger (left-0/right-0) vẫn tràn màn hình vì trigger
                  không nằm sát mép viewport — width co theo 100vw không đủ, offset ngang
                  của trigger mới là nguyên nhân tràn. Đổi sang fixed + căn giữa NGANG theo
                  viewport (left-1/2 -translate-x-1/2, không phụ thuộc vị trí trigger nữa),
                  đặt ngay dưới header (top-16) để không che hết màn hình. */}
              <div className="fixed inset-0 z-40 sm:hidden" onClick={() => setOpen(false)} />
              <div
                className="popover fixed left-1/2 top-16 z-50 flex max-h-[75vh] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-y-auto rounded-2xl p-0 shadow-2xl shadow-black/60 sm:hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {panelBody}
              </div>
            </>
          );
        })()}
    </div>
  );
}
