"use client";

import { CaseRecord, ColumnDef, Role } from "@/lib/types";
import { ClientLinkButton } from "@/components/client-link-button";
import { ClientProfileDialog } from "@/components/client-profile-dialog";
import type { ClientProfilePayload } from "@/lib/api-client";

/** Tên khách hàng KHÔNG còn sửa trực tiếp tại đây (đã khoá — xem ClientProfileDialog),
 * chỉ hiển thị read-only. Sửa được duy nhất qua popup "Edit Hồ sơ" (nút bút chì). */
function NameDisplay({ value, hasLink }: { value: string; hasLink: boolean }) {
  // Có link đính kèm (kiểu hyperlink Excel) -> đổi màu chữ tên khách sang xanh dương
  // sáng để nhận biết ngay trên bảng, không cần hover vào icon link.
  const linkColorClass = hasLink && value ? "text-blue-400" : "";
  return (
    <div
      className={`min-w-0 flex-1 truncate px-1.5 py-0.5 text-center text-xs ${linkColorClass || "text-text-dim"}`}
      title={value || undefined}
    >
      {value || <span className="text-text-faint">—</span>}
    </div>
  );
}

export function ClientNameCell({
  caseRecord,
  columns,
  role,
  linkEditable,
  onCommitLink,
  onSaveProfile,
  isDuplicateSsn,
}: {
  caseRecord: CaseRecord;
  columns: ColumnDef[];
  role: Role;
  /** Quyền sửa RIÊNG link đính kèm (không liên quan tới quyền sửa tên — tên giờ khoá
   * hoàn toàn ngoài popup Edit Hồ sơ, không còn dùng chung 1 prop editable như trước). */
  linkEditable: boolean;
  onCommitLink: (link: string | null) => void;
  onSaveProfile: (payload: ClientProfilePayload) => Promise<{ ok: true } | { ok: false; error: string }>;
  isDuplicateSsn: (slot: 0 | 1, candidate: string) => boolean;
}) {
  const hasLink = Boolean(caseRecord.clientLink);
  return (
    <div className="relative flex h-full min-w-0 items-stretch">
      <div className="flex shrink-0 items-center pl-1">
        <ClientProfileDialog
          caseRecord={caseRecord}
          columns={columns}
          role={role}
          onSave={onSaveProfile}
          isDuplicateSsn={isDuplicateSsn}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1">
        <div className="flex min-w-0 items-center gap-1">
          <NameDisplay value={caseRecord.clients[0].firstName} hasLink={hasLink} />
          <NameDisplay value={caseRecord.clients[0].lastName} hasLink={hasLink} />
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <NameDisplay value={caseRecord.clients[1].firstName} hasLink={hasLink} />
          <NameDisplay value={caseRecord.clients[1].lastName} hasLink={hasLink} />
        </div>
      </div>

      <div className="flex w-6 shrink-0 items-center justify-center">
        <ClientLinkButton link={caseRecord.clientLink} editable={linkEditable} onCommitLink={onCommitLink} />
      </div>
    </div>
  );
}
