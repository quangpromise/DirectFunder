import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { canEditCase, canViewCase } from "@/lib/rbac";
import {
  AgentC3ConfigError,
  AgentC3LoginError,
  AgentC3NotFoundError,
  fetchCrmFormContext,
  parseAgentC3CustomerId,
} from "@/lib/agentc3-client";

/** Đọc danh sách Status + Performed By hiện có trên CRM agentc3 cho popup "Update to CRM" —
 * chỉ ĐỌC, không ghi gì. `caseId` phải đã có `clientLink` trỏ về agentc3 (do tính năng "Nhập
 * từ CRM" tự gắn, hoặc Admin/user tự dán) — nếu không có, coi như hồ sơ này chưa liên kết CRM. */
export async function GET(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const caseId = request.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "Thiếu caseId" }, { status: 400 });

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

  try {
    const context = await fetchCrmFormContext(customerId);
    return NextResponse.json({
      statusOptions: context.statusOptions,
      performerOptions: context.performerOptions,
      // Giá trị Status/Processing Date ĐANG có trên CRM ngay lúc mở popup — để popup hiện
      // sẵn đúng trạng thái hiện tại (thay vì mặc định "—" trống), người dùng chỉ cần đổi
      // đúng những gì muốn thay, không phải tự tra cứu lại trên CRM trước khi sửa.
      currentStatus: context.fields.p_status ?? "",
      currentProcessingDate: context.fields.processing_date ?? "",
    });
  } catch (err) {
    if (err instanceof AgentC3ConfigError) {
      return NextResponse.json({ error: "Chưa cấu hình tài khoản CRM agentc3" }, { status: 501 });
    }
    if (err instanceof AgentC3LoginError) return NextResponse.json({ error: err.message }, { status: 502 });
    if (err instanceof AgentC3NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error("[agentc3-import/crm-context] Lỗi không xác định:", err);
    return NextResponse.json({ error: "Không đọc được dữ liệu từ CRM agentc3" }, { status: 502 });
  }
}
