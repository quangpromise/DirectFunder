"use client";

import { Order8821Picker } from "@/components/order8821-picker";
import { OrderTtsWitPicker } from "@/components/order-tts-wit-picker";

export function OrderCell({
  editable,
  onOrder8821,
  onOrderTtsWit,
}: {
  editable: boolean;
  /** Trả về true nếu đặt order thành công -> nút hiện tick xanh 5s rồi tự quay về mặc
   * định (không khoá chờ Support Done, chặn trùng dựa vào SSN trong handler). */
  onOrder8821: (slots: (0 | 1)[]) => Promise<boolean | void> | boolean | void;
  onOrderTtsWit: (slots: (0 | 1)[], description: string) => Promise<boolean | void> | boolean | void;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col justify-center gap-0.5 px-1 py-1">
      <Order8821Picker disabled={!editable} onPick={onOrder8821} />
      <OrderTtsWitPicker disabled={!editable} onConfirm={onOrderTtsWit} />
    </div>
  );
}
