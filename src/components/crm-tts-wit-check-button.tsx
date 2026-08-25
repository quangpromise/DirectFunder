"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Send, ChevronDown } from "lucide-react";
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

export interface CompareChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** 1 dòng bảng AI trả về — LUÔN đủ 3 cột giá trị (WIT/1040/TTS, thêm 2026-08-26 theo yêu cầu
 * "thêm các trường so sánh giữa WIT và 1040, 1040 và TTS") dạng STRING vì câu hỏi tự do có thể
 * ra kết quả không phải số thuần. */
export interface AiCompareRow {
  category: string;
  wit: string;
  taxReturn: string;
  tts: string;
  note: string;
}

/** 1 tài liệu người dùng chọn qua dropdown/checkbox — `label` gồm sẵn năm + tên người (vd
 * "2025 - Sanchez, Jose E"), dùng làm tiêu đề khối trong prompt gửi Gemini. */
export interface DocSelection {
  url: string;
  label: string;
}

/** Store action ký sinh (`compareTtsWitChat` trong app-store.ts) — chat hỏi-đáp tự do dùng
 * Gemini API free tier, trả về DẠNG BẢNG (structured output — xem
 * `.claude/skills/crm-tts-wit-compare/SKILL.md`, người dùng đã xác nhận chấp nhận đánh đổi dữ
 * liệu bị Google dùng để train). Người dùng CHỌN CHÍNH XÁC file nào qua 3 trường select (đổi
 * 2026-08-26 — không còn tự lấy theo năm), `wit` là mảng tối đa 2 file (Taxpayer + Spouse).
 * `caseId` đã đóng gói sẵn ở call site (`cases/page.tsx`). */
export type CompareTtsWitChatFn = (payload: {
  tts?: DocSelection | null;
  taxReturn?: DocSelection | null;
  wit?: DocSelection[];
  message: string;
  history: CompareChatMessage[];
}) => Promise<{ ok: true; rows: AiCompareRow[] } | { ok: false; error: string }>;

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
  onCompareChat,
}: {
  disabled: boolean;
  /** Tên khách hàng (dòng 1) của hồ sơ — đính kèm vào text hiển thị + tên file tải về của mỗi
   * link, để phân biệt được khi mở nhiều tab/tải nhiều file cùng lúc (thêm 2026-08-25). */
  clientName: string;
  /** null nếu lỗi (đã tự alertWarn ở nơi gọi) -> không mở popup. */
  onCheck: () => Promise<CrmTtsWitResult | null>;
  /** Chat hỏi-đáp tự do "So sánh WIT / 1040 Tax Return / TTS" (Gemini API free tier) — xem
   * `.claude/skills/crm-tts-wit-compare/SKILL.md`. Bảng regex cố định cũ đã bỏ. */
  onCompareChat: CompareTtsWitChatFn;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CrmTtsWitResult | null>(null);
  // Kết quả phân tích AI MỚI NHẤT (thêm 2026-08-27 theo yêu cầu "sau khi AI phân tích sẽ ra 1
  // pop-up mới đặt song song pop-up Doc CRM và hiện full bảng để xem") — nâng state lên đây
  // (thay vì giữ trong CompareChatSection) vì popup thứ 2 phải render NGANG HÀNG với popup
  // "Doc CRM" (2 phần tử `.popover` cạnh nhau trong cùng 1 flex row), không phải lồng bên
  // trong popup đó.
  const [analysis, setAnalysis] = useState<{ rows: AiCompareRow[]; columns: CompareColumns } | null>(null);
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

  function closeAll() {
    setResult(null);
    setAnalysis(null);
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
          // overflow-x-auto: khi popup phân tích xuất hiện cạnh popup "Doc CRM", tổng chiều
          // rộng 2 popup có thể vượt viewport — cả cặp vẫn giữ CANH GIỮA (justify-center) nên
          // popup "Doc CRM" tự bị ĐẨY SANG TRÁI so với lúc đứng 1 mình, phần tràn ra được cuộn
          // ngang thay vì bị cắt mất.
          <div className="fixed inset-0 z-[100] flex items-center justify-center gap-4 overflow-x-auto bg-black/80 px-4 py-8" onClick={closeAll}>
            <div className="popover max-h-[85vh] w-full max-w-2xl shrink-0 overflow-y-auto rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("crmTtsWit.resultTitle")}</h3>
                <button onClick={closeAll} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                  <X size={16} />
                </button>
              </div>

              <CompareChatSection result={result} onCompareChat={onCompareChat} onAnalysis={setAnalysis} />

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
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

            {analysis && (
              <div
                className="popover max-h-[85vh] w-full max-w-3xl shrink-0 overflow-y-auto rounded-2xl p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t("crmCompareChat.analysisTitle")}</h3>
                  <button onClick={() => setAnalysis(null)} className="text-text-faint hover:text-text" aria-label={t("common.close")}>
                    <X size={16} />
                  </button>
                </div>
                <AiRowsTable rows={analysis.rows} columns={analysis.columns} wrap />
              </div>
            )}
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

/** 3 cột giá trị của bảng — cờ bật/tắt theo ĐÚNG lựa chọn lúc gửi câu hỏi đó (thêm 2026-08-27
 * theo yêu cầu "bảng phân tích chỉ hiện các cột được chọn") — lưu riêng cho từng lượt trả lời
 * vì lựa chọn có thể đổi giữa các lượt hỏi trong cùng 1 phiên chat. */
type CompareColumns = { wit: boolean; taxReturn: boolean; tts: boolean };

/** 1 tin nhắn trong state UI — khác `CompareChatMessage` (dây API): tin user giữ text thô, tin
 * assistant giữ SẴN mảng rows đã parse (không phải chuỗi) để render bảng trực tiếp, không phải
 * parse lại mỗi lần re-render, kèm `columns` để bảng chỉ hiện đúng cột đã chọn lúc hỏi. */
type ChatEntry = { role: "user"; text: string } | { role: "assistant"; rows: AiCompareRow[]; columns: CompareColumns };

/** Chuyển `ChatEntry[]` (state UI) -> `CompareChatMessage[]` (payload gửi API) — tin assistant
 * nén rows thành JSON string (Gemini đọc hiểu JSON làm ngữ cảnh bình thường, xem
 * `askCompareTtsWit` trong `crm-doc-compare.ts`). */
function toApiHistory(entries: ChatEntry[]): CompareChatMessage[] {
  return entries.map((e) => (e.role === "user" ? { role: "user", content: e.text } : { role: "assistant", content: JSON.stringify(e.rows) }));
}

/** Đọc số đầu tiên trong 1 chuỗi giá trị AI trả về (vd "$68,069.00" -> 68069, "—"/"Single" ->
 * null) — dùng để tính cột "Chênh lệch". Bỏ dấu phẩy ngăn cách nghìn, giữ dấu chấm thập phân. */
function parseAmountLike(value: string): number | null {
  const m = /-?\d[\d,]*(\.\d+)?/.exec(value);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Chênh lệch giữa các cột giá trị SỐ đang hiện (2 hoặc 3 cột, tuỳ đã chọn mấy loại tài liệu)
 * — cách nhau xa nhất trừ gần nhất, đủ để bao quát cả trường hợp so 2 lẫn 3 tài liệu cùng lúc
 * trong 1 cột duy nhất (thêm 2026-08-27). `null` nếu chưa đủ 2 giá trị đọc được thành số (vd
 * hạng mục không phải số như "Filing status"). */
function computeDiff(row: AiCompareRow, columns: CompareColumns): number | null {
  const values: number[] = [];
  if (columns.wit) {
    const n = parseAmountLike(row.wit);
    if (n !== null) values.push(n);
  }
  if (columns.taxReturn) {
    const n = parseAmountLike(row.taxReturn);
    if (n !== null) values.push(n);
  }
  if (columns.tts) {
    const n = parseAmountLike(row.tts);
    if (n !== null) values.push(n);
  }
  if (values.length < 2) return null;
  return Math.max(...values) - Math.min(...values);
}

function formatDiff(diff: number): string {
  return diff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Bảng nhỏ cho 1 lượt trả lời của AI — CHỈ hiện đúng cột (WIT/1040/TTS) đã chọn lúc hỏi (thêm
 * 2026-08-27 theo yêu cầu "bảng phân tích chỉ hiện các cột được chọn"), cộng 1 cột "Chênh lệch"
 * tự tính + tô màu (đỏ = lệch, xanh = khớp) để không phải tự dò từng cột. */
function AiRowsTable({ rows, columns, wrap }: { rows: AiCompareRow[]; columns: CompareColumns; wrap?: boolean }) {
  const t = useT();
  if (rows.length === 0) return null;
  // `wrap`: bảng lớn ở popup phân tích riêng (thêm 2026-08-27) không cắt/cuộn ngang ô note nữa —
  // chữ tự xuống dòng vì popup đó đủ rộng để đọc trọn nội dung ("hiện full bảng để xem").
  const cellCls = wrap ? "px-2 py-1.5" : "whitespace-nowrap px-2 py-1";
  return (
    <div className="self-start w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-bg-elevated text-[10px] uppercase tracking-wide text-text-faint">
            <th className="px-2 py-1 text-left font-semibold">{t("crmCompare.colCategory")}</th>
            {columns.wit && <th className="px-2 py-1 text-right font-semibold">WIT</th>}
            {columns.taxReturn && <th className="px-2 py-1 text-right font-semibold">1040</th>}
            {columns.tts && <th className="px-2 py-1 text-right font-semibold">TTS</th>}
            <th className="px-2 py-1 text-right font-semibold">{t("crmCompare.colDiff")}</th>
            <th className="px-2 py-1 text-left font-semibold">{t("crmCompare.colNote")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const diff = computeDiff(row, columns);
            return (
              <tr key={i} className="border-t border-border">
                <td className={`${cellCls} font-medium`}>{row.category}</td>
                {columns.wit && <td className={`${cellCls} text-right tabular-nums`}>{row.wit}</td>}
                {columns.taxReturn && <td className={`${cellCls} text-right tabular-nums`}>{row.taxReturn}</td>}
                {columns.tts && <td className={`${cellCls} text-right tabular-nums`}>{row.tts}</td>}
                <td
                  className={`whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums ${
                    diff === null
                      ? "text-text-faint"
                      : diff === 0
                        ? "text-emerald-600 light:text-emerald-700"
                        : "rounded bg-red-500/15 text-red-400 light:bg-red-100 light:text-red-700"
                  }`}
                >
                  {diff === null ? "—" : formatDiff(diff)}
                </td>
                <td className={`${cellCls} ${wrap ? "" : "whitespace-normal"} text-text-faint`}>{row.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Gộp mọi file 1 loại tài liệu thành danh sách lựa chọn — nhãn gồm sẵn năm + tên người (vd
 * "2025 - Sanchez, Jose E", fallback ngày nếu không đọc được tên) để hiện trong dropdown/
 * checkbox (thêm 2026-08-26 theo yêu cầu "list tất cả tên đang có trong bảng TTS... kèm theo
 * năm"). Duyệt qua mọi năm 2023-2025, không giới hạn 1 năm như thiết kế cũ. */
function buildDocOptions(docsByYear: Record<CrmDocYear, CrmTtsWitDoc[]>): DocSelection[] {
  const options: DocSelection[] = [];
  for (const year of YEARS) {
    for (const doc of docsByYear[year]) {
      options.push({ url: doc.url, label: `${year} - ${doc.personName ?? dateOnly(doc.timestamp)}` });
    }
  }
  return options;
}

/** Chat "So sánh WIT / 1040 Tax Return / TTS" (Gemini API free tier) — DUY NHẤT cơ chế so sánh
 * trong popup (thêm 2026-08-25, bảng regex cố định ban đầu đã BỎ 2026-08-26 — xem
 * `.claude/skills/crm-tts-wit-compare/SKILL.md`). Đặt ở ĐẦU popup. Đổi kiến trúc 2026-08-26
 * theo yêu cầu "3 trường select cho 3 loại TTS/WIT/1040... khi có trường nào được chọn thì ask
 * AI so sánh 2 trường đó": KHÔNG còn chọn theo "năm" (tự lấy bản mới nhất) — 3 trường CHỌN
 * CHÍNH XÁC file nào (TTS/1040 single-select, WIT multi-select tối đa 2 vì có Taxpayer+Spouse),
 * options liệt kê MỌI file có trong CẢ 3 năm kèm tên người. Cần chọn ÍT NHẤT 2/3 loại tài liệu
 * mới bấm Gửi được. Trả lời của AI hiện DẠNG BẢNG (structured output) với ĐỦ 3 cột giá trị
 * WIT/1040/TTS — loại nào không chọn tự hiện "—". Không lưu DB, chỉ tồn tại trong state React
 * lúc popup đang mở. */
function CompareChatSection({
  result,
  onCompareChat,
  onAnalysis,
}: {
  result: CrmTtsWitResult;
  onCompareChat: CompareTtsWitChatFn;
  /** Báo cho component cha (`CrmTtsWitCheckButton`) mỗi khi có kết quả AI mới — cha tự mở popup
   * "full bảng" thứ 2 cạnh popup này (thêm 2026-08-27). */
  onAnalysis: (analysis: { rows: AiCompareRow[]; columns: CompareColumns }) => void;
}) {
  const t = useT();
  const ttsOptions = buildDocOptions(result.tts);
  const witOptions = buildDocOptions(result.wit);
  const taxReturnOptions = buildDocOptions(result.taxReturns);

  const [ttsUrl, setTtsUrl] = useState("");
  const [taxReturnUrl, setTaxReturnUrl] = useState("");
  const [witUrls, setWitUrls] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const selectedTypeCount = (ttsUrl ? 1 : 0) + (taxReturnUrl ? 1 : 0) + (witUrls.length > 0 ? 1 : 0);
  const ready = selectedTypeCount >= 2;

  function toggleWit(url: string) {
    setWitUrls((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url);
      if (prev.length >= 2) return prev; // tối đa 2 file (Taxpayer + Spouse)
      return [...prev, url];
    });
  }

  async function handleSend() {
    if (!ready || sending) return;
    const message = draft.trim() || t("crmCompareChat.defaultMessage");
    const columns: CompareColumns = { wit: witUrls.length > 0, taxReturn: Boolean(taxReturnUrl), tts: Boolean(ttsUrl) };
    setDraft("");
    setError("");
    setSending(true);
    const history = toApiHistory(messages.slice(-6));
    setMessages((prev) => [...prev, { role: "user", text: message }]);
    try {
      const ttsSel = ttsOptions.find((o) => o.url === ttsUrl) ?? null;
      const taxReturnSel = taxReturnOptions.find((o) => o.url === taxReturnUrl) ?? null;
      const witSel = witOptions.filter((o) => witUrls.includes(o.url));
      const res = await onCompareChat({ tts: ttsSel, taxReturn: taxReturnSel, wit: witSel, message, history });
      if (res.ok) {
        setMessages((prev) => [...prev, { role: "assistant", rows: res.rows, columns }]);
        onAnalysis({ rows: res.rows, columns });
      } else {
        setError(res.error);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">{t("crmCompareChat.title")}</div>

      <div className="mb-2 grid grid-cols-3 gap-2">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-text-faint">TTS</div>
          <select
            value={ttsUrl}
            onChange={(e) => setTtsUrl(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-elevated px-1.5 py-1 text-xs text-text"
          >
            <option value="">—</option>
            {ttsOptions.map((o) => (
              <option key={o.url} value={o.url}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-text-faint">WIT ({t("crmCompareChat.witPickHint")})</div>
          {witOptions.length === 0 ? (
            <div className="rounded-md border border-border bg-bg-elevated px-1.5 py-1 text-xs text-text-faint">—</div>
          ) : (
            <details className="group rounded-md border border-border bg-bg-elevated text-xs [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-1 px-1.5 py-1 text-text">
                <span className="truncate">
                  {witUrls.length > 0
                    ? witOptions
                        .filter((o) => witUrls.includes(o.url))
                        .map((o) => o.label)
                        .join(", ")
                    : t("crmCompareChat.witPlaceholderEmpty")}
                </span>
                <ChevronDown size={12} className="shrink-0 text-text-faint transition group-open:rotate-180" />
              </summary>
              <div className="max-h-32 overflow-y-auto border-t border-border p-1">
                {witOptions.map((o) => {
                  const checked = witUrls.includes(o.url);
                  const disabled = !checked && witUrls.length >= 2;
                  return (
                    <label
                      key={o.url}
                      className={`flex items-center gap-1 px-0.5 py-0.5 text-xs ${disabled ? "text-text-faint" : "text-text"}`}
                    >
                      <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleWit(o.url)} className="shrink-0" />
                      <span className="truncate">{o.label}</span>
                    </label>
                  );
                })}
              </div>
            </details>
          )}
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-text-faint">1040</div>
          <select
            value={taxReturnUrl}
            onChange={(e) => setTaxReturnUrl(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-elevated px-1.5 py-1 text-xs text-text"
          >
            <option value="">—</option>
            {taxReturnOptions.map((o) => (
              <option key={o.url} value={o.url}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {messages.length > 0 && (
        <div className="mb-2 flex max-h-80 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-2.5">
          {/* Chỉ hiện lại đúng câu đã hỏi (thêm 2026-08-27 theo yêu cầu "nếu đã show ra pop-up
              kết quả thì không cần hiện kết quả ở bảng Doc CRM") — bảng kết quả AI trả về giờ
              CHỈ hiện ở popup "Kết quả phân tích AI" cạnh bên (xem `onAnalysis`), không lặp lại
              trong khung chat này nữa. */}
          {messages
            .filter((m): m is Extract<ChatEntry, { role: "user" }> => m.role === "user")
            .map((m, i) => (
              <div key={i} className="self-end whitespace-pre-wrap rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs leading-relaxed text-text">
                {m.text}
              </div>
            ))}
          {sending && (
            <div className="self-start rounded-lg bg-surface px-2.5 py-1.5 text-xs text-text-faint">
              <Spinner size={12} />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300 light:text-red-700">{error}</div>
      )}

      {!ready && (
        <div className="mb-2 rounded-lg border border-border bg-bg-elevated px-2.5 py-2 text-xs text-text-faint">
          {t("crmCompare.missingDocs")}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={t("crmCompareChat.placeholder")}
          disabled={sending || !ready}
          className="h-8 flex-1 rounded-md border border-border bg-bg-elevated px-2 text-xs text-text placeholder:text-text-faint disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !ready}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-white transition hover:opacity-90 disabled:cursor-default disabled:opacity-40"
          aria-label={t("crmCompareChat.send")}
        >
          <Send size={13} />
        </button>
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
