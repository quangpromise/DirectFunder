import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { canViewCase } from "@/lib/rbac";
import { AgentC3ConfigError, AgentC3LoginError, AgentC3NotFoundError, fetchAgentC3FileBytes } from "@/lib/agentc3-client";
import {
  askCompareDocs,
  extractDocumentText,
  AiProviderConfigError,
  type CompareChatMessage,
  type SelectedDocEntry,
} from "@/lib/crm-doc-compare";
import { AiRateLimitError } from "@/lib/ai-retry";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 1 tài liệu client chọn qua dropdown/checkbox — `url` là link tải trên CRM (client chỉ có
 * thể chọn URL đã thấy trong kết quả `checkCrmLatestTts` của ĐÚNG hồ sơ đang mở, nhưng route
 * vẫn tự validate domain qua `fetchAgentC3FileBytes` — không tin thẳng URL client gửi lên). */
interface DocSelection {
  url: string;
  label: string;
}

async function fetchEntry(sel: DocSelection | null | undefined): Promise<SelectedDocEntry | null> {
  if (!sel?.url) return null;
  const bytes = await fetchAgentC3FileBytes(sel.url);
  // extractDocumentText (không phải extractPdfText thẳng) — CRM đôi khi lưu WIT dạng ".html"
  // thay vì ".pdf", tự nhận diện định dạng thay vì luôn ép parse bằng pdfjs (xem
  // crm-doc-compare.ts, lỗi thật gặp trên production "InvalidPDFException").
  const text = await extractDocumentText(bytes);
  return { label: sel.label, text };
}

/** Chat "So sánh WIT / 1040 Tax Return / TTS" — xem
 * `.claude/skills/crm-tts-wit-compare/SKILL.md`. Đổi kiến trúc 2026-08-26: KHÔNG còn chọn theo
 * "năm" (tự lấy bản mới nhất) — người dùng CHỌN CHÍNH XÁC file nào qua 3 trường select ở UI
 * (TTS/1040 single-select, WIT multi-select tối đa 2 file vì có Taxpayer+Spouse), client gửi
 * thẳng `{url, label}` của từng file đã chọn. Route CHỈ tải/trích/gọi model — không tự tra CRM
 * lại như route cũ (không cần `year`/`customerId` nữa). Dùng Gemini (`gemini-3.5-flash-lite`,
 * free tier ~1.500 request/ngày — xem `askCompareDocs`/crm-doc-compare.ts, đã gỡ Groq dự phòng
 * 2026-08-27). Trả về `rows` (structured output).
 * Không lưu DB — chat chỉ tồn tại trong state React lúc popup đang mở. */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ ok: false, error: "Chưa đăng nhập" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    caseId?: string;
    tts?: DocSelection | null;
    taxReturn?: DocSelection | null;
    wit?: DocSelection[];
    message?: string;
    history?: CompareChatMessage[];
  } | null;
  const { caseId, message } = body ?? {};
  const tts = body?.tts ?? null;
  const taxReturn = body?.taxReturn ?? null;
  const wit = Array.isArray(body?.wit) ? body.wit.slice(0, 2) : []; // tối đa 2 file (Taxpayer + Spouse)
  if (!caseId || !message?.trim()) {
    return NextResponse.json({ ok: false, error: "Thiếu caseId/message" }, { status: 400 });
  }
  const selectedTypeCount = (tts ? 1 : 0) + (taxReturn ? 1 : 0) + (wit.length > 0 ? 1 : 0);
  if (selectedTypeCount < 2) {
    return NextResponse.json({ ok: false, error: "Chọn ít nhất 2 loại tài liệu (TTS/WIT/1040) để so sánh" }, { status: 400 });
  }
  // Giữ ngắn — mỗi lượt chat đều gửi lại toàn bộ text các tài liệu, lịch sử dài không cần
  // thiết và tốn token; chỉ giữ 6 tin gần nhất (3 cặp hỏi-đáp).
  const history = Array.isArray(body?.history) ? body.history.slice(-6) : [];

  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, assignedTo: true, assignedProcessor: true, assignedTo2: true, assignedProcessor2: true, createdBy: true },
  });
  if (!kase) return NextResponse.json({ ok: false, error: "Không tìm thấy hồ sơ" }, { status: 404 });
  if (!canViewCase(me.role, me.id, kase, me.teamMemberIds)) {
    return NextResponse.json({ ok: false, error: "Không có quyền xem hồ sơ này" }, { status: 403 });
  }

  try {
    const [ttsEntry, taxReturnEntry, witEntries] = await Promise.all([
      fetchEntry(tts),
      fetchEntry(taxReturn),
      Promise.all(wit.map((w) => fetchEntry(w))),
    ]);

    const rows = await askCompareDocs({
      wit: witEntries.filter((e): e is NonNullable<typeof e> => e !== null),
      taxReturn: taxReturnEntry,
      tts: ttsEntry,
      history,
      message: message.trim(),
    });
    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    if (err instanceof AgentC3ConfigError) {
      return NextResponse.json({ ok: false, error: "Chưa cấu hình tài khoản CRM agentc3" }, { status: 501 });
    }
    if (err instanceof AiProviderConfigError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 501 });
    }
    if (err instanceof AiRateLimitError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
    }
    if (err instanceof AgentC3LoginError) return NextResponse.json({ ok: false, error: err.message }, { status: 502 });
    if (err instanceof AgentC3NotFoundError) return NextResponse.json({ ok: false, error: err.message }, { status: 404 });
    console.error("[agentc3-import/compare-tts-wit-chat] Lỗi không xác định:", err);
    return NextResponse.json({ ok: false, error: "Không so sánh được tài liệu — thử lại sau" }, { status: 502 });
  }
}
