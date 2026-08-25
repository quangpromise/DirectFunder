"use client";

import { CrmTtsWitCheckButton, CrmTtsWitResult } from "@/components/crm-tts-wit-check-button";

/**
 * Cột "TTS & WIT Lastest" (trước đây tên "Order", đổi 2026-08-23, đổi tiếp cùng ngày) — trước
 * đây hiện 2 nút đặt lệnh "Order 8821"/"TTS & WIT" cho Support (Order8821Picker/
 * OrderTtsWitPicker) đã ĐÃ ẨN khỏi bảng Hồ sơ chính theo yêu cầu (tính năng đặt lệnh vẫn còn
 * nguyên, chỉ dùng được qua tab "Orders" riêng). Giờ hiện 1 nút "Check log" — bấm để kiểm tra
 * CRM agentc3 tìm file TTS/WIT mới (xem CrmTtsWitCheckButton) — chỉ hiện khi hồ sơ đã liên kết
 * CRM.
 */
export function OrderCell({
  editable,
  hasClientLink,
  clientName,
  onCheckCrm,
}: {
  editable: boolean;
  hasClientLink: boolean;
  /** Tên khách hàng (dòng 1) của hồ sơ — đính kèm vào tên/text hiển thị mỗi link TTS/WIT lấy
   * được, để phân biệt dễ dàng khi mở nhiều tab/nhiều hồ sơ cùng lúc (thêm 2026-08-25). */
  clientName: string;
  onCheckCrm: () => Promise<CrmTtsWitResult | null>;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1">
      {hasClientLink ? (
        <CrmTtsWitCheckButton disabled={!editable} clientName={clientName} onCheck={onCheckCrm} />
      ) : (
        <span className="text-[10px] text-text-faint">—</span>
      )}
    </div>
  );
}
