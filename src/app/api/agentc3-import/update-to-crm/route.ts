import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { canEditCase, canViewCase } from "@/lib/rbac";
import { todayIsoDate } from "@/lib/date-format";
import { REFUND_YEARS } from "@/lib/refund";
import {
  AgentC3ConfigError,
  AgentC3LoginError,
  AgentC3NotFoundError,
  CRM_1040X_SUBMITTED_DOC_SLOT,
  parseAgentC3CustomerId,
  saveCrmConversationLog,
  updateCrmLeadInfo,
  uploadCrmDocument,
} from "@/lib/agentc3-client";

interface StepResult {
  step: string;
  ok: boolean;
  error?: string;
}

/** Nút "Update to CRM" (popup theo hồ sơ) — ghi ngược 1 hoặc nhiều phần lên CRM agentc3 trong
 * 1 lần bấm: set CPA Review = ngày hôm nay cho các năm đã chọn, đổi Status (theo đúng danh
 * sách Status của CRM, KHÔNG phải Status Direct Funder), thêm 1 dòng Conversation Log, và/hoặc
 * upload file vào đúng ô "{năm} 1040X - Submitted" trong tab Documentation. Mỗi phần chạy độc
 * lập (try/catch riêng) — 1 phần lỗi không chặn các phần còn lại, trả về kết quả từng bước để
 * UI báo rõ đã làm được gì/lỗi ở đâu. */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });

  const caseId = form.get("caseId");
  if (typeof caseId !== "string" || !caseId) {
    return NextResponse.json({ error: "Thiếu caseId" }, { status: 400 });
  }

  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    select: { assignedTo: true, assignedProcessor: true, assignedTo2: true, assignedProcessor2: true, createdBy: true, clientLink: true },
  });
  if (!kase) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 });
  if (!canViewCase(me.role, me.id, kase, me.teamMemberIds)) {
    return NextResponse.json({ error: "Không có quyền xem hồ sơ này" }, { status: 403 });
  }
  if ((me.role === "agent_leader" || me.role === "processor_leader") && !canEditCase(me.role, me.id, kase, me.teamMemberIds)) {
    return NextResponse.json({ error: "Không có quyền sửa hồ sơ này" }, { status: 403 });
  }

  const customerId = kase.clientLink ? parseAgentC3CustomerId(kase.clientLink) : null;
  if (!customerId) {
    return NextResponse.json({ error: "Hồ sơ chưa liên kết với CRM agentc3 (chưa có link)" }, { status: 400 });
  }

  const yearsRaw = form.get("years");
  let years: string[] = [];
  if (typeof yearsRaw === "string" && yearsRaw) {
    try {
      const parsed = JSON.parse(yearsRaw);
      if (Array.isArray(parsed)) years = parsed.filter((y): y is string => typeof y === "string" && REFUND_YEARS.includes(y as (typeof REFUND_YEARS)[number]));
    } catch {
      // bỏ qua, coi như không chọn năm nào
    }
  }
  const cpaReviewDatesRaw = form.get("cpaReviewDates");
  const cpaReviewDates: Record<string, string> = {};
  if (typeof cpaReviewDatesRaw === "string" && cpaReviewDatesRaw) {
    try {
      const parsed = JSON.parse(cpaReviewDatesRaw);
      if (parsed && typeof parsed === "object") {
        for (const [year, date] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && REFUND_YEARS.includes(year as (typeof REFUND_YEARS)[number])) {
            cpaReviewDates[year] = date;
          }
        }
      }
    } catch {
      // bỏ qua, coi như không có ngày nào hợp lệ
    }
  }
  const status = form.get("status");
  const processingDate = form.get("processingDate");
  const note = form.get("note");
  const performedBy = form.get("performedBy");

  const results: StepResult[] = [];

  async function runStep(step: string, task: () => Promise<void>) {
    try {
      await task();
      results.push({ step, ok: true });
    } catch (err) {
      let message = err instanceof Error ? err.message : "Lỗi không xác định";
      if (err instanceof AgentC3ConfigError) message = "Chưa cấu hình tài khoản CRM agentc3";
      if (err instanceof AgentC3LoginError) message = err.message;
      if (err instanceof AgentC3NotFoundError) message = err.message;
      results.push({ step, ok: false, error: message });
    }
  }

  // status/processingDate chấp nhận CẢ chuỗi rỗng — popup luôn điền sẵn 2 field này từ giá
  // trị THẬT đang có trên CRM lúc mở, nên người dùng gửi rỗng nghĩa là chủ động XOÁ, không
  // phải "chưa đổi gì" (bỏ qua rỗng sẽ khiến CRM không bao giờ xoá được 2 field này).
  const leadOverrides: Record<string, string> = {};
  if (typeof status === "string") leadOverrides.p_status = status;
  if (typeof processingDate === "string" && (processingDate === "" || /^\d{4}-\d{2}-\d{2}$/.test(processingDate))) {
    leadOverrides.processing_date = processingDate;
  }
  const today = todayIsoDate();
  for (const year of years) leadOverrides[`cpa_review_${year}`] = cpaReviewDates[year] ?? today;
  if (Object.keys(leadOverrides).length > 0) {
    await runStep("leadInfo", () => updateCrmLeadInfo(customerId, leadOverrides));
  }

  if (typeof note === "string" && note.trim()) {
    await runStep("conversationLog", () =>
      saveCrmConversationLog(customerId, { note: note.trim(), performedBy: typeof performedBy === "string" ? performedBy : "" })
    );
  }

  for (const year of years) {
    const file = form.get(`file_${year}`);
    if (!(file instanceof File) || file.size === 0) continue;
    const slot = CRM_1040X_SUBMITTED_DOC_SLOT[year];
    if (!slot) continue;
    await runStep(`upload_${year}`, async () => {
      const buffer = Buffer.from(await file.arrayBuffer());
      await uploadCrmDocument(customerId, slot.titleIndex, slot.title, {
        buffer,
        filename: file.name || `${slot.title}.pdf`,
        mimeType: file.type || "application/octet-stream",
      });
    });
  }

  if (results.length === 0) {
    return NextResponse.json({ error: "Không có gì để cập nhật — chọn ít nhất 1 năm, đổi Status, hoặc nhập Conversation Log" }, { status: 400 });
  }

  // Luôn trả 200 dù có bước lỗi — client (api-client.ts request()) coi mọi status khác 2xx
  // là lỗi cứng và throw, sẽ làm mất thông tin `results` từng bước (thành công 1 phần vẫn cần
  // hiện rõ cho người dùng, không phải "tất cả hoặc không gì cả").
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results });
}
