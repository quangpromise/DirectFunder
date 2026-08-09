"use client";

export function OrderCell({
  order8821Active,
  orderTtsWitActive,
  editable,
  onOrder,
}: {
  /** true nếu hồ sơ đang có order 8821 chưa Done — nút khóa + hiện màu "đã đặt". Khi
   * order đó chuyển Done, hết active, nút tự mở khóa để đặt một order 8821 MỚI (giữ
   * nguyên order cũ trong lịch sử, không ghi đè). */
  order8821Active: boolean;
  orderTtsWitActive: boolean;
  editable: boolean;
  onOrder: (field: "order8821" | "orderTtsWit") => void;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col justify-center gap-1 px-2 py-1">
      <button
        disabled={!editable || order8821Active}
        onClick={() => onOrder("order8821")}
        className={`w-full shrink-0 cursor-pointer whitespace-nowrap rounded-md border px-1.5 py-1 text-center text-[10px] font-medium leading-tight transition disabled:cursor-default ${
          order8821Active
            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
            : "border-border bg-transparent text-text-faint hover:bg-surface-hover"
        }`}
      >
        {order8821Active ? "Ordered 8821" : "Order 8821"}
      </button>
      <button
        disabled={!editable || orderTtsWitActive}
        onClick={() => onOrder("orderTtsWit")}
        className={`w-full shrink-0 cursor-pointer whitespace-nowrap rounded-md border px-1.5 py-1 text-center text-[10px] font-medium leading-tight transition disabled:cursor-default ${
          orderTtsWitActive
            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
            : "border-border bg-transparent text-text-faint hover:bg-surface-hover"
        }`}
      >
        {orderTtsWitActive ? "Ordered TTS & WIT" : "Order TTS & WIT"}
      </button>
    </div>
  );
}
