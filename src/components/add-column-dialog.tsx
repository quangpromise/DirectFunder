"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { ColumnType, SelectOption } from "@/lib/types";
import { OptionBadge } from "@/components/option-badge";
import { useConfirm } from "@/components/confirm-dialog";
import { ColorSwatchPicker } from "@/components/color-swatch-picker";
import { useT } from "@/lib/i18n";
import { hexToRgba15, rgbaToHex } from "@/lib/color";

const TYPE_OPTIONS: { value: ColumnType; labelKey: string }[] = [
  { value: "text", labelKey: "addCol.type.text" },
  { value: "number", labelKey: "addCol.type.number" },
  { value: "currency", labelKey: "addCol.type.currency" },
  { value: "boolean", labelKey: "addCol.type.boolean" },
  { value: "date", labelKey: "addCol.type.date" },
  { value: "select", labelKey: "addCol.type.select" },
];

const PALETTE = [
  { bg: "rgba(139,92,246,0.15)", color: "#c4b5fd" },
  { bg: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  { bg: "rgba(34,197,94,0.15)", color: "#86efac" },
  { bg: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  { bg: "rgba(239,68,68,0.15)", color: "#fca5a5" },
  { bg: "rgba(6,182,212,0.15)", color: "#67e8f9" },
];

type DraftOption = Omit<SelectOption, "id"> & { key: string };

export function AddColumnDialog({
  onAdd,
}: {
  onAdd: (label: string, type: ColumnType, options?: Omit<SelectOption, "id">[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [options, setOptions] = useState<DraftOption[]>([]);
  const [optionLabel, setOptionLabel] = useState("");
  const { confirm, ConfirmDialogUI } = useConfirm();
  const t = useT();

  function addOption() {
    if (!optionLabel.trim()) return;
    const palette = PALETTE[options.length % PALETTE.length];
    setOptions((prev) => [...prev, { key: `d${prev.length}-${Date.now()}`, label: optionLabel.trim(), ...palette }]);
    setOptionLabel("");
  }

  function updateOption(key: string, patch: Partial<DraftOption>) {
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }

  function removeOption(key: string) {
    setOptions((prev) => prev.filter((o) => o.key !== key));
  }

  function reset() {
    setLabel("");
    setType("text");
    setOptions([]);
    setOptionLabel("");
  }

  async function handleSubmit() {
    if (!label.trim()) return;
    if (type === "select" && options.length === 0) return;
    if (!(await confirm(t("addCol.confirm", { label: label.trim() }), { title: t("addCol.title") }))) return;
    onAdd(
      label.trim(),
      type,
      type === "select" ? options.map(({ label, bg, color }) => ({ label, bg, color })) : undefined
    );
    reset();
    setOpen(false);
  }

  return (
    <>
      {ConfirmDialogUI}
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-3 text-xs font-medium text-text-dim transition hover:bg-surface-hover hover:text-text"
      >
        <Plus size={14} />
        {t("common.addColumn")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-8">
          <div className="popover flex max-h-full w-full max-w-sm flex-col rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5">
              <h3 className="text-sm font-semibold">{t("addCol.title")}</h3>
              <button
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
                className="text-text-faint hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5">
              <div>
                <label className="mb-1 block text-xs text-text-dim">{t("addCol.name")}</label>
                <input
                  autoFocus
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t("addCol.namePlaceholder")}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-dim">{t("addCol.dataType")}</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as ColumnType)}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              {type === "select" && (
                <div>
                  <label className="mb-1 block text-xs text-text-dim">{t("addCol.optionsList")}</label>
                  <div className="flex flex-col gap-1.5">
                    {options.map((o) => (
                      <div
                        key={o.key}
                        className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-2 py-1.5"
                      >
                        <ColorSwatchPicker
                          value={o.color}
                          onChange={(hex) => updateOption(o.key, { color: hex })}
                          title={t("col.textColor")}
                        />
                        <ColorSwatchPicker
                          value={rgbaToHex(o.bg)}
                          onChange={(hex) => updateOption(o.key, { bg: hexToRgba15(hex) })}
                          title={t("col.bgColor")}
                        />
                        <div className="min-w-0 flex-1">
                          <OptionBadge option={{ id: o.key, label: o.label, bg: o.bg, color: o.color }} />
                        </div>
                        <button
                          onClick={() => removeOption(o.key)}
                          className="shrink-0 text-text-faint hover:text-red-400"
                          aria-label={t("col.removeOption")}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 flex gap-1.5">
                    <input
                      value={optionLabel}
                      onChange={(e) => setOptionLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addOption();
                        }
                      }}
                      placeholder={t("addCol.newOptionPlaceholder")}
                      className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-sm outline-none focus:border-accent"
                    />
                    <button
                      onClick={addOption}
                      className="shrink-0 rounded-lg border border-dashed border-border-strong px-3 text-xs font-medium text-text-dim hover:bg-surface-hover hover:text-text"
                    >
                      {t("common.add")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
                className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSubmit}
                className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white"
              >
                {t("common.addColumn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
