"use client";

import { Order8821Picker } from "@/components/order8821-picker";
import { OrderTtsWitPicker } from "@/components/order-tts-wit-picker";
import { SendCpaEmailDialog } from "@/components/send-cpa-email-dialog";
import { CaseRecord, CpaEmailDefaults } from "@/lib/types";

export function OrderCell({
  editable,
  onOrder8821,
  onOrderTtsWit,
  caseRecord,
  cpaEmailDefaults,
  cpaEmailStatusLabel,
  cpaSenderEmail,
  cpaSenderName,
  canSendCpaEmail,
  onSendCpaEmail,
}: {
  editable: boolean;
  /** Trả về true nếu đặt order thành công -> nút hiện tick xanh 5s rồi tự quay về mặc
   * định (không khoá chờ Support Done, chặn trùng dựa vào SSN trong handler). */
  onOrder8821: (slots: (0 | 1)[]) => Promise<boolean | void> | boolean | void;
  onOrderTtsWit: (slots: (0 | 1)[], description: string) => Promise<boolean | void> | boolean | void;
  caseRecord: CaseRecord;
  cpaEmailDefaults: CpaEmailDefaults;
  /** Nhãn hiển thị của status hồ sơ (đã dịch, không phải raw option id) — dùng trong
   * nội dung email mặc định. */
  cpaEmailStatusLabel: string;
  /** Tài khoản Gmail dùng để gửi (GMAIL_USER phía server) — fallback cho chữ ký nếu
   * cpaSenderName rỗng. */
  cpaSenderEmail: string;
  /** Tên người dùng đang đăng nhập (người bấm Gửi) — dùng làm chữ ký cuối mail thay vì
   * lộ email tài khoản Gmail dùng để gửi. */
  cpaSenderName: string;
  /** Quyền "sendCpaEmail" (featurePermissions) — KHÁC `editable` (quyền sửa cột Order),
   * truyền riêng vì 1 processor có thể được gửi mail CPA dù không có quyền sửa Order và
   * ngược lại. */
  canSendCpaEmail: boolean;
  onSendCpaEmail: (payload: {
    to: string[];
    cc: string[];
    subject: string;
    html: string;
    text: string;
    attachments: { filename: string; contentType: string; contentBase64: string }[];
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col justify-center gap-1 px-2 py-1">
      <Order8821Picker disabled={!editable} onPick={onOrder8821} />
      <OrderTtsWitPicker disabled={!editable} onConfirm={onOrderTtsWit} />
      {canSendCpaEmail && (
        <SendCpaEmailDialog
          disabled={false}
          caseRecord={caseRecord}
          defaults={cpaEmailDefaults}
          statusLabel={cpaEmailStatusLabel}
          senderEmail={cpaSenderEmail}
          senderName={cpaSenderName}
          onSend={onSendCpaEmail}
        />
      )}
    </div>
  );
}
