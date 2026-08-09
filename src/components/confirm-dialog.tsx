"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n";

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  tone: "default" | "danger";
  resolve?: (value: boolean) => void;
}

/**
 * Popup xác nhận Yes/No dùng chung cho mọi thao tác thêm / sửa / xóa dữ liệu
 * cấu trúc (dòng, cột...). Trả về Promise<boolean> để dùng như window.confirm
 * nhưng theo đúng style glassmorphism của app (qua Portal để không bị đè bởi
 * các phần tử sticky).
 */
export function useConfirm() {
  const t = useT();
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: "",
    message: "",
    tone: "default",
  });

  const confirm = useCallback(
    (message: string, opts?: { title?: string; tone?: "default" | "danger" }) => {
      return new Promise<boolean>((resolve) => {
        setState({
          open: true,
          title: opts?.title ?? t("common.confirm"),
          message,
          tone: opts?.tone ?? "default",
          resolve,
        });
      });
    },
    [t]
  );

  function respond(value: boolean) {
    state.resolve?.(value);
    setState((s) => ({ ...s, open: false, resolve: undefined }));
  }

  const ConfirmDialogUI =
    state.open && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-4">
            <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl shadow-black/60">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    state.tone === "danger" ? "bg-red-500/15 text-red-400" : "bg-accent-soft text-accent"
                  }`}
                >
                  <AlertTriangle size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-text">{state.title}</h3>
                  <p className="mt-1 text-sm text-text-dim">{state.message}</p>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => respond(false)}
                  className="rounded-lg border border-border px-3.5 py-1.5 text-sm text-text-dim hover:bg-surface-hover"
                >
                  {t("common.no")}
                </button>
                <button
                  onClick={() => respond(true)}
                  className={
                    state.tone === "danger"
                      ? "rounded-lg bg-red-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-red-600"
                      : "gradient-btn rounded-lg px-3.5 py-1.5 text-sm font-medium text-white"
                  }
                >
                  {t("common.yes")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return { confirm, ConfirmDialogUI };
}
