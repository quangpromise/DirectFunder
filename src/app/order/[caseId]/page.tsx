"use client";

import { use, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileText } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { getFullName } from "@/lib/client-name";
import { formatSsn } from "@/lib/ssn";

type OrderTab = "order8821" | "orderTtsWit";

const TAB_LABEL: Record<OrderTab, string> = {
  order8821: "Order 8821",
  orderTtsWit: "Order TTS & WIT",
};

export default function OrderPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "orderTtsWit" ? "orderTtsWit" : "order8821";
  const [tab, setTab] = useState<OrderTab>(initialTab);

  const kase = useAppStore((s) => s.cases.find((c) => c.id === caseId));

  if (!kase) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-text-faint">
        Không tìm thấy hồ sơ này. Có thể hồ sơ đã bị xóa.
      </div>
    );
  }

  const fullName = getFullName(kase);
  const ssnList = kase.ssn.filter((s): s is string => Boolean(s));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <FileText size={17} />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Order Detail</h1>
          <p className="text-xs text-text-faint">{kase.caseNumber}</p>
        </div>
      </div>

      <div className="popover rounded-2xl p-5">
        <div className="grid grid-cols-2 gap-4 border-b border-border pb-4 text-sm">
          <div>
            <div className="text-xs text-text-faint">Client Name</div>
            <div className="mt-0.5 font-medium">{fullName || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-text-faint">Phone</div>
            <div className="mt-0.5 font-medium">{kase.phone || "—"}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-text-faint">SSN</div>
            <div className="mt-0.5 flex flex-wrap gap-x-4 font-medium">
              {ssnList.length > 0 ? ssnList.map((s) => <span key={s}>{formatSsn(s)}</span>) : "—"}
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-1.5 border-b border-border">
          {(Object.keys(TAB_LABEL) as OrderTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-t-lg px-3.5 py-2 text-sm font-medium transition ${
                tab === t
                  ? "border-b-2 border-accent text-accent"
                  : "text-text-faint hover:text-text-dim"
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        <div className="pt-4 text-sm text-text-dim">
          <p>
            Đã tạo <span className="font-medium text-text">{TAB_LABEL[tab]}</span> cho khách hàng{" "}
            <span className="font-medium text-text">{fullName || "—"}</span> dựa trên thông tin Client
            Name, Phone và SSN của hồ sơ {kase.caseNumber}.
          </p>
          <p className="mt-2 text-xs text-text-faint">
            Đây là bản xem trước nội bộ — chưa kết nối hệ thống order thật.
          </p>
        </div>
      </div>
    </div>
  );
}
