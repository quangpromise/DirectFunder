import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { canViewCase } from "@/lib/rbac";
import {
  AgentC3ConfigError,
  AgentC3LoginError,
  AgentC3NotFoundError,
  fetchTtsWitDatesByYear,
  parseAgentC3CustomerId,
} from "@/lib/agentc3-client";

/** Nút "TTS & WIT" ở cột "Check CRM" — đọc trực tiếp CRM agentc3, trả về ngày upload mới nhất
 * của TTS/WIT cho từng năm 2023/2024/2025 để hiện popup kết quả ngay. Chỉ đọc, không ghi/so
 * sánh/thông báo gì (đơn giản hoá 2026-08-23). */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ ok: false, error: "Chưa đăng nhập" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { caseId?: string } | null;
  const caseId = body?.caseId;
  if (!caseId) return NextResponse.json({ ok: false, error: "Thiếu caseId" }, { status: 400 });

  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      clientLink: true,
      assignedTo: true,
      assignedProcessor: true,
      assignedTo2: true,
      assignedProcessor2: true,
      createdBy: true,
    },
  });
  if (!kase) return NextResponse.json({ ok: false, error: "Không tìm thấy hồ sơ" }, { status: 404 });
  if (!canViewCase(me.role, me.id, kase, me.teamMemberIds)) {
    return NextResponse.json({ ok: false, error: "Không có quyền xem hồ sơ này" }, { status: 403 });
  }

  const customerId = kase.clientLink ? parseAgentC3CustomerId(kase.clientLink) : null;
  if (!customerId) {
    return NextResponse.json({ ok: false, error: "Hồ sơ chưa liên kết với CRM agentc3 (chưa có link)" }, { status: 400 });
  }

  try {
    const { tts, wit } = await fetchTtsWitDatesByYear(customerId);
    return NextResponse.json({ ok: true, tts, wit });
  } catch (err) {
    if (err instanceof AgentC3ConfigError) {
      return NextResponse.json({ ok: false, error: "Chưa cấu hình tài khoản CRM agentc3" }, { status: 501 });
    }
    if (err instanceof AgentC3LoginError) return NextResponse.json({ ok: false, error: err.message }, { status: 502 });
    if (err instanceof AgentC3NotFoundError) return NextResponse.json({ ok: false, error: err.message }, { status: 404 });
    console.error("[agentc3-import/check-latest-tts] Lỗi không xác định:", err);
    return NextResponse.json({ ok: false, error: "Không đọc được dữ liệu từ CRM agentc3" }, { status: 502 });
  }
}
