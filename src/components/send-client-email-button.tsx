"use client";

import { CheckCircle2, Mail } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { useSuccessFlash } from "@/lib/use-success-flash";

type SendResult = { ok: true } | { ok: false; error: string; needsMicrosoftAuth?: boolean };

/**
 * Nút nhỏ cạnh ô Email trong popup "Edit Hồ sơ" — gửi 1 email mẫu cố định (Admin cấu
 * hình ở trang Phân quyền) tới email khách hàng, qua mailbox Outlook @directfunder.com
 * riêng của người bấm gửi (OAuth2 theo từng user, xem microsoft-graph.ts). KHÔNG có
 * trạng thái "đã gửi" bền vững như SendToSheetButton/SendCpaEmailDialog — chỉ hiện tick
 * xanh tạm thời 5s (useSuccessFlash) rồi tự quay về mặc định, sẵn sàng gửi lại bất kỳ lúc
 * nào (follow-up khách hàng là hành động tự do, không cần xác nhận "muốn gửi lại").
 */
export function SendClientEmailButton({
  caseId,
  confirm,
  alertWarn,
  sendClientEmail,
  connectMicrosoftAccount,
}: {
  caseId: string;
  confirm: (message: string, opts?: { title?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  alertWarn: (message: string, opts?: { title?: string }) => Promise<void>;
  sendClientEmail: (caseId: string) => Promise<SendResult>;
  connectMicrosoftAccount: () => Promise<boolean>;
}) {
  const [sending, setSending] = useState(false);
  const [justSent, flashSent] = useSuccessFlash();
  const t = useT();

  async function handleClick() {
    const confirmed = await confirm(t("clientEmail.confirmSend"), { title: t("clientEmail.confirmSendTitle") });
    if (!confirmed) return;

    setSending(true);
    try {
      let result = await sendClientEmail(caseId);
      if (!result.ok && result.needsMicrosoftAuth) {
        const connected = await connectMicrosoftAccount();
        if (!connected) return;
        result = await sendClientEmail(caseId);
      }
      if (!result.ok) {
        await alertWarn(result.error, { title: t("clientEmail.sendErrorTitle") });
        return;
      }
      flashSent();
    } finally {
      setSending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={sending || justSent}
      title={t("clientProfile.sendEmailBtn")}
      aria-label={t("clientProfile.sendEmailBtn")}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition disabled:cursor-default ${
        justSent
          ? "border-green-600/70 bg-green-800/60 text-green-100 light:border-green-700 light:bg-green-600 light:text-white"
          : "border-border bg-transparent text-text-faint hover:bg-surface-hover hover:text-text"
      }`}
    >
      {justSent ? <CheckCircle2 size={13} /> : <Mail size={13} />}
    </button>
  );
}
