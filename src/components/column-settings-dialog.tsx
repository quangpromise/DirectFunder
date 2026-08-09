"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Settings, X, Trash2, Plus } from "lucide-react";
import { ColumnDef, ROLE_LABEL, Role, SelectOption } from "@/lib/types";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { OptionBadge } from "@/components/option-badge";
import { useConfirm } from "@/components/confirm-dialog";
import { useT, useLanguage } from "@/lib/i18n";

export function ColumnSettingsDialog({
  column,
  onRename,
  onSetEditableBy,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
  onDelete,
  canManageFully = true,
}: {
  column: ColumnDef;
  onRename: (label: string) => void;
  onSetEditableBy: (roles: Role[]) => void;
  onAddOption: (option: Omit<SelectOption, "id">) => void;
  onUpdateOption: (optionId: string, patch: Partial<Omit<SelectOption, "id">>) => void;
  onRemoveOption: (optionId: string) => void;
  onDelete: () => void;
  /** false = chỉ cho thêm lựa chọn mới (vd. Support được sửa giá trị nhưng không được
   * đổi tên/xóa cột hay xóa lựa chọn có sẵn) — dùng cho tài khoản chỉ có quyền sửa ô
   * dữ liệu (editableBy) chứ không có quyền quản lý cột đầy đủ (editColumn feature). */
  canManageFully?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(column.label);
  const [newOptionLabel, setNewOptionLabel] = useState("");
  const { confirm, ConfirmDialogUI } = useConfirm();
  const t = useT();
  const { language } = useLanguage();

  function toggleRole(role: Role) {
    const roles = column.editableBy.includes(role)
      ? column.editableBy.filter((r) => r !== role)
      : [...column.editableBy, role];
    onSetEditableBy(roles);
  }

  async function commitRename() {
    const next = label.trim();
    if (!next || next === column.label) return;
    if (await confirm(t("col.renameConfirm", { old: column.label, new: next }), { title: t("col.renameTitle") })) {
      onRename(next);
    } else {
      setLabel(column.label);
    }
  }

  function handleAddOption() {
    if (!newOptionLabel.trim()) return;
    onAddOption({ label: newOptionLabel.trim(), bg: "rgba(139,92,246,0.15)", color: "#c4b5fd" });
    setNewOptionLabel("");
  }

  async function handleRemoveOption(optionId: string, optionLabel: string) {
    if (await confirm(t("col.removeOptionConfirm", { label: optionLabel }), { title: t("col.removeOptionTitle"), tone: "danger" })) {
      onRemoveOption(optionId);
    }
  }

  async function handleDeleteColumn() {
    if (
      await confirm(t("col.deleteColumnConfirm", { label: column.label }), {
        title: t("col.deleteColumnTitle"),
        tone: "danger",
      })
    ) {
      onDelete();
      setOpen(false);
    }
  }

  return (
    <>
      {ConfirmDialogUI}
      <button
        onClick={() => {
          setLabel(column.label);
          setOpen(true);
        }}
        className="shrink-0 rounded text-text-faint opacity-0 transition hover:text-text group-hover/head:opacity-100"
        title={t("col.settingsBtn", { label: column.label })}
        aria-label={t("col.settingsBtn", { label: column.label })}
      >
        <Settings size={12} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8">
          <div className="popover flex max-h-full w-full max-w-sm flex-col rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5">
              <h3 className="text-sm font-semibold">{t("col.settingsTitle")}</h3>
              <button onClick={() => setOpen(false)} className="text-text-faint hover:text-text">
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-4 overflow-y-auto px-5">
              {canManageFully && (
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("col.name")}</label>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    onBlur={commitRename}
                    className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
              )}

              {canManageFully && (
                <div>
                  <label className="mb-1.5 block text-xs text-text-dim">{t("col.editableRoles")}</label>
                  <p className="mb-1.5 text-[11px] text-text-faint">{t("col.editableRolesNote")}</p>
                  <div className="flex flex-col gap-1.5">
                    {ASSIGNABLE_ROLES.map((role) => (
                      <label
                        key={role}
                        className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={column.editableBy.includes(role)}
                          onChange={() => toggleRole(role)}
                          className="h-3.5 w-3.5 accent-[var(--accent)]"
                        />
                        <span>{ROLE_LABEL[language][role]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {column.type === "select" && (
                <div>
                  <label className="mb-1.5 block text-xs text-text-dim">{t("col.optionsList")}</label>
                  <div className="flex flex-col gap-1.5">
                    {(column.options ?? []).map((o) =>
                      canManageFully ? (
                        <div
                          key={o.id}
                          className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-2 py-1.5"
                        >
                          <input
                            type="color"
                            value={o.color}
                            onChange={(e) => onUpdateOption(o.id, { color: e.target.value })}
                            title={t("col.textColor")}
                            className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                          />
                          <input
                            type="color"
                            value={rgbaToHex(o.bg)}
                            onChange={(e) => onUpdateOption(o.id, { bg: hexToRgba15(e.target.value) })}
                            title={t("col.bgColor")}
                            className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                          />
                          <input
                            value={o.label}
                            onChange={(e) => onUpdateOption(o.id, { label: e.target.value })}
                            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none hover:border-border focus:border-accent"
                          />
                          <div className="shrink-0">
                            <OptionBadge option={o} />
                          </div>
                          <button
                            onClick={() => handleRemoveOption(o.id, o.label)}
                            className="shrink-0 text-text-faint hover:text-red-400"
                            aria-label={t("col.removeOption")}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <div
                          key={o.id}
                          className="flex items-center rounded-lg border border-border bg-bg-elevated px-2 py-1.5"
                        >
                          <OptionBadge option={o} />
                        </div>
                      )
                    )}
                  </div>

                  <div className="mt-2 flex gap-1.5">
                    <input
                      value={newOptionLabel}
                      onChange={(e) => setNewOptionLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddOption();
                        }
                      }}
                      placeholder={t("col.newOptionPlaceholder")}
                      className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-sm outline-none focus:border-accent"
                    />
                    <button
                      onClick={handleAddOption}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-border-strong px-3 text-xs font-medium text-text-dim hover:bg-surface-hover hover:text-text"
                    >
                      <Plus size={12} />
                      {t("common.add")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between px-5 pb-5">
              {canManageFully ? (
                <button
                  onClick={handleDeleteColumn}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 size={14} />
                  {t("col.deleteColumn")}
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={() => setOpen(false)}
                className="gradient-btn rounded-lg px-4 py-2 text-sm font-medium text-white"
              >
                {t("common.done")}
              </button>
            </div>
          </div>
        </div>,
        document.body
        )}
    </>
  );
}

function hexToRgba15(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.15)`;
}

function rgbaToHex(rgba: string): string {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "#ff9900";
  const [, r, g, b] = m;
  return `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}
