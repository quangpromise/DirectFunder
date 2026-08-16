"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, AlertCircle, Mail } from "lucide-react";
import { useT } from "@/lib/i18n";

type ConnectResult = { ok: true } | { ok: false; error: string };

/**
 * Modal nhập email + mật khẩu webmail (mail.directfunder.com) — thay cho popup OAuth
 * Microsoft cũ. Mở bởi send-client-email-button.tsx khi server báo "WEBMAIL_NOT_CONNECTED".
 * Không tự đóng ngay khi submit lỗi — cho user sửa lại rồi thử tiếp trong cùng dialog.
 * PHẢI dùng createPortal ra document.body (thêm 2026-08-16, sau khi SendClientEmailButton
 * dời từ popup Edit Hồ sơ ra thẳng bảng Hồ sơ) — nếu không, dialog render như con bình
 * thường bên trong 1 <tr> có `transform` (dùng cho kéo-thả dòng), mà `transform` trên tổ
 * tiên tạo containing block MỚI cho `position: fixed`, khiến dialog bị nhốt gọn trong đúng
 * ô hàng đó thay vì phủ toàn màn hình — bug thật đã gặp (nút "Kết nối" hiện tí xíu ở góc
 * hàng thay vì popup giữa màn hình).
 */
export function ConnectWebmailDialog({
  open,
  onClose,
  connectWebmailAccount,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  connectWebmailAccount: (email: string, password: string) => Promise<ConnectResult>;
  onConnected: () => void;
}) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError(t("webmail.errEmpty"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await connectWebmailAccount(email.trim(), password);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEmail("");
      setPassword("");
      onConnected();
    } finally {
      setSubmitting(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4">
      <form onSubmit={handleSubmit} className="popover w-full max-w-sm rounded-2xl p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Mail size={15} />
            {t("webmail.title")}
          </h3>
          <button type="button" onClick={onClose} className="text-text-faint hover:text-text">
            <X size={16} />
          </button>
        </div>

        <p className="mt-2 text-xs text-text-dim">{t("webmail.subtitle")}</p>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-text-dim">{t("webmail.email")}</label>
            <input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ten@directfunder.com"
              className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">{t("webmail.password")}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 light:text-red-700">
            <AlertCircle size={13} className="shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm text-text-dim hover:bg-surface-hover"
          >
            {t("common.close")}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="gradient-btn rounded-lg px-3.5 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? t("webmail.connecting") : t("webmail.connect")}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
