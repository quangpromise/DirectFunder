"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "@/components/spinner";
import { useT } from "@/lib/i18n";

type CrmDocYear = "2023" | "2024" | "2025";
const YEARS: CrmDocYear[] = ["2023", "2024", "2025"];

export interface CrmTtsWitDoc {
  timestamp: string;
  /** Link tải/xem trực tiếp file PDF trên CRM. */
  url: string;
  /** Tên đọc được từ chính tên file trên CRM (vd "Nguyen, Pyon Ngoc") — null nếu CRM dùng định
   * dạng tên file cũ không đọc được, khi đó dùng `clientName` của hồ sơ làm fallback. */
  personName: string | null;
}

export interface CrmTtsWitResult {
  tts: Record<CrmDocYear, CrmTtsWitDoc[]>;
  wit: Record<CrmDocYear, CrmTtsWitDoc[]>;
  /** Bảng "1040 Tax Return" (thêm 2026-08-25) — năm 2023-2025 (bỏ 2022 theo yêu cầu). */
  taxReturns: Record<CrmDocYear, CrmTtsWitDoc[]>;
  /** Field "Other" (thêm 2026-08-25) — chỉ 1 link MỚI NHẤT (không theo năm), null nếu chưa có
   * file "Other" nào. */
  other: CrmTtsWitDoc | null;
}

/**
 * Nút "Check log" ở cột "TTS & WIT Lastest" (thay cho 2 nút "Order 8821"/"TTS & WIT" đặt lệnh
 * cho Support đã ẩn khỏi bảng Hồ sơ chính, thêm 2026-08-23) — bấm để đọc trực tiếp CRM agentc3,
 * hiện popup MỌI file TTS/WIT/"1040 Tax Return" upload vào đúng ngày mới nhất (không chỉ 1 file
 * — nhiều file có thể lên cùng ngày, thêm 2026-08-25) cho từng năm 2023/2024/2025, cộng field
 * "Other" (không theo năm, chỉ lấy 1 link mới nhất, thêm 2026-08-25) (đơn giản hoá 2026-08-23
 * sau phản hồi thực tế — bỏ hẳn cơ chế Notification/so-mốc trước đó, vì người bấm không thấy
 * kết quả tức thời). Chỉ hiện khi hồ sơ đã liên kết CRM (`hasClientLink`) — component cha tự
 * hiện "—" khi chưa liên kết. Mỗi dòng ngày là 1 link (thêm 2026-08-24) mở thẳng file trên CRM
 * ở tab mới, không cần tự vào CRM tìm lại.
 */
export function CrmTtsWitCheckButton({
  disabled,
  clientName,
  onCheck,
}: {
  disabled: boolean;
  /** Tên khách hàng (dòng 1) của hồ sơ — đính kèm vào text hiển thị + tên file tải về của mỗi
   * link, để phân biệt được khi mở nhiều tab/tải nhiều file cùng lúc (thêm 2026-08-25). */
  clientName: string;
  /** null nếu lỗi (đã tự alertWarn ở nơi gọi) -> không mở popup. */
  onCheck: () => Promise<CrmTtsWitResult | null>;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CrmTtsWitResult | null>(null);
  const t = useT();

  async function handleClick() {
    setChecking(true);
    try {
      const res = await onCheck();
      if (res) setResult(res);
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || checking}
        onClick={handleClick}
        className="inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-amber-800/60 bg-amber-900/40 px-2 py-1 text-center text-[10px] font-bold leading-tight text-amber-200 transition hover:bg-amber-900/60 disabled:cursor-default disabled:opacity-60 light:border-amber-300 light:bg-amber-100 light:text-amber-900 light:hover:bg-amber-200"
      >
        {checking ? <Spinner size={11} /> : t("crmTtsWit.button")}
      </button>

      {result &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8" onClick={() => setResult(null)}>
            <div className="popover max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("crmTtsWit.resultTitle")}</h3>
                <button onClick={() => setResult(null)} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={16} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <DocGroup label="TTS" docType="TTS" clientName={clientName} docsByYear={result.tts} />
                <DocGroup label="WIT" docType="WIT" clientName={clientName} docsByYear={result.wit} />
              </div>

              <div className="mt-4 border-t border-border pt-3">
                <DocGroup label="1040 Tax Return" docType="1040" clientName={clientName} docsByYear={result.taxReturns} />
              </div>

              <div className="mt-4 border-t border-border pt-3">
                <OtherDocSection clientName={clientName} doc={result.other} />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/** Chỉ lấy phần ngày "YYYY-MM-DD" từ timestamp CRM ("YYYY-MM-DD HH:MM:SS") — bỏ giờ:phút:giây
 * khỏi tên/nhãn hiển thị (thêm 2026-08-25 theo yêu cầu "bỏ nội dung giờ phút giây trên tên link
 * đi"). Vẫn dùng nguyên `timestamp` đầy đủ (có giờ) ở tầng dữ liệu (`fetchTtsWitDatesByYear`)
 * để gom-theo-ngày/sắp xếp đúng — chỉ CẮT BỚT lúc hiển thị/đặt tên file ở đây. */
function dateOnly(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** Tên file gợi ý khi tải (thuộc tính `download` — trình duyệt chỉ áp dụng được nếu link cùng
 * origin, agentc3 khác origin nên đa số trình duyệt sẽ bỏ qua và mở file trực tiếp như bình
 * thường; giữ lại vì không hại gì, có tác dụng ở trình duyệt nào hỗ trợ). Loại ký tự không hợp
 * lệ cho tên file. */
function suggestedFileName(clientName: string, docType: string, year: string, timestamp: string): string {
  const safeName = clientName.trim().replace(/[\\/:*?"<>|]+/g, " ").trim();
  return `${safeName ? `${safeName} - ` : ""}${year} ${docType} - ${dateOnly(timestamp)}.pdf`;
}

/** Tên file gợi ý khi tải link "Other" — không có năm/loại cố định như TTS/WIT/1040, chỉ ghép
 * tên khách hàng + ngày. */
function suggestedOtherFileName(clientName: string, timestamp: string): string {
  const safeName = clientName.trim().replace(/[\\/:*?"<>|]+/g, " ").trim();
  return `${safeName ? `${safeName} - ` : ""}Other - ${dateOnly(timestamp)}.pdf`;
}

/** Field "Other" (thêm 2026-08-25) — không theo năm, chỉ 1 link MỚI NHẤT (khác 3 bảng trên lấy
 * mọi link cùng ngày, đúng yêu cầu "lấy link mới nhất của nó kèm tên"). */
function OtherDocSection({ clientName, doc }: { clientName: string; doc: CrmTtsWitDoc | null }) {
  const name = doc ? (doc.personName ?? clientName) : "";
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">Other</div>
      <div className="overflow-x-auto rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5">
        {doc ? (
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            download={suggestedOtherFileName(name, doc.timestamp)}
            title={name}
            className="block whitespace-nowrap text-xs font-medium leading-none text-accent hover:underline"
          >
            {name ? `${name} — ` : ""}
            <span className="tabular-nums">{dateOnly(doc.timestamp)}</span>
          </a>
        ) : (
          <div className="whitespace-nowrap text-xs font-medium leading-none tabular-nums text-text">—</div>
        )}
      </div>
    </div>
  );
}

function DocGroup({
  label,
  docType,
  clientName,
  docsByYear,
}: {
  label: string;
  docType: string;
  clientName: string;
  docsByYear: Record<CrmDocYear, CrmTtsWitDoc[]>;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">{label}</div>
      <div className="flex flex-col gap-1.5">
        {YEARS.map((year) => {
          const docs = docsByYear[year];
          return (
            // overflow-x-auto: lưới an toàn — mỗi hàng luôn dành đủ chiều rộng popup (không
            // còn chia 3 cột cạnh nhau nữa, kể cả bảng "1040 Tax Return" đã đổi sang xếp chồng
            // dọc như TTS/WIT), nhưng nếu tên file/tên khách hàng vẫn dài bất thường thì cuộn
            // ngang trong chính ô đó thay vì tràn ra ngoài popup hoặc bị cắt mất chữ.
            <div key={year} className="overflow-x-auto rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5">
              <div className="whitespace-nowrap text-[10px] leading-none text-text-dim">{year}</div>
              {docs.length > 0 ? (
                <div className="mt-1 flex flex-col gap-1">
                  {docs.map((doc, i) => {
                    // Ưu tiên tên đọc TRỰC TIẾP từ file trên CRM — phân biệt đúng Taxpayer/
                    // Spouse khi 2 người cùng có file lên cùng ngày; chỉ fallback về tên hồ sơ
                    // Direct Funder nếu CRM dùng định dạng tên file cũ không đọc được.
                    const name = doc.personName ?? clientName;
                    return (
                      <a
                        key={`${doc.url}-${i}`}
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={suggestedFileName(name, docType, year, doc.timestamp)}
                        title={name}
                        className="block whitespace-nowrap text-xs font-medium leading-none text-accent hover:underline"
                      >
                        {name ? `${name} — ` : ""}
                        <span className="tabular-nums">{dateOnly(doc.timestamp)}</span>
                      </a>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-1 whitespace-nowrap text-xs font-medium leading-none tabular-nums text-text">—</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
