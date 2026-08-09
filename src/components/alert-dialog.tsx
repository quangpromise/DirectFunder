"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n";

interface AlertState {
  open: boolean;
  title: string;
  message: string;
  resolve?: () => void;
}

/**
 * Popup Warning một nút "Đã hiểu" dùng thay cho window.alert — theo đúng style
 * glassmorphism của app (qua Portal để không bị đè bởi các phần tử sticky), thay vì
 * popup hệ điều hành xấu và không đồng bộ giao diện.
 */
export function useAlert() {
  const t = useT();
  const [state, setState] = useState<AlertState>({ open: false, title: "", message: "" });

  const alertWarn = useCallback((message: string, opts?: { title?: string }) => {
    return new Promise<void>((resolve) => {
      setState({ open: true, title: opts?.title ?? t("common.warning"), message, resolve });
    });
  }, [t]);

  function close() {
    state.resolve?.();
    setState((s) => ({ ...s, open: false, resolve: undefined }));
  }

  const AlertDialogUI =
    state.open && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-4">
            <div className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl shadow-black/60">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
                  <AlertTriangle size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-text">{state.title}</h3>
                  <p className="mt-1 whitespace-pre-line text-sm text-text-dim">{state.message}</p>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={close}
                  className="rounded-lg bg-amber-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
                >
                  {t("common.gotIt")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return { alertWarn, AlertDialogUI };
}
