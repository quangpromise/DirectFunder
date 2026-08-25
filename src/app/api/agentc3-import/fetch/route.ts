import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { formatSsn } from "@/lib/ssn";
import { splitNameLastWord } from "@/lib/client-name";
import { parseDobPaste } from "@/lib/date-format";
import { toCaseRecord } from "@/app/api/cases/route";
import {
  AgentC3ConfigError,
  AgentC3LoginError,
  AgentC3NotFoundError,
  buildAgentC3CustomerUrl,
  fetchAgentC3Customer,
  parseAgentC3CustomerId,
} from "@/lib/agentc3-client";
import type { ColumnDef, FeaturePermissions, SelectOption } from "@/lib/types";

/** Chuẩn hoá để so khớp status không phân biệt hoa/thường, dấu câu, số ít/nhiều — vd CRM trả
 * "Missing Doc"/"Missing Doc Process"/"Missing Docs Process" đều phải khớp đúng option "Missing
 * Docs" trong Direct Funder (yêu cầu 2026-08-21: "hồ sơ Missing Doc hay missing Doc process thì
 * trên Project đều lấy status có nội dung missing Docs"). Chỉ lấy 2 TỪ ĐẦU (đủ phân biệt các
 * status hiện có, tránh khớp nhầm 2 status khác nhau chỉ vì trùng 1 từ đầu như "Processing"). */
function normalizeStatusPrefix(label: string): string {
  const words = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  return words.slice(0, 2).join(" ");
}

function matchStatusId(rawStatus: string, options: SelectOption[] | undefined): string | null {
  if (!rawStatus.trim() || !options) return null;
  const exact = options.find((o) => o.label.trim().toLowerCase() === rawStatus.trim().toLowerCase());
  if (exact) return exact.id;
  const rawPrefix = normalizeStatusPrefix(rawStatus);
  if (!rawPrefix) return null;
  return options.find((o) => normalizeStatusPrefix(o.label) === rawPrefix)?.id ?? null;
}

/** Xem trước dữ liệu 1 hồ sơ trên CRM ngoài agentc3 (dán link) trước khi tạo/cập nhật hồ sơ
 * thật trong Direct Funder — chỉ ĐỌC, không ghi gì. Việc TẠO hồ sơ thật vẫn bị chặn đúng bởi
 * feature `addRow` sẵn có ở bước lưu thật (POST /api/cases) — route này gate bằng CHÍNH quyền
 * đó vì mục đích duy nhất của nó là chuẩn bị dữ liệu cho hành động tạo hồ sơ. */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const featurePermissions = config?.featurePermissions as FeaturePermissions | undefined;
  if (!featurePermissions || !hasFeature(featurePermissions, "addRow", me.role)) {
    return NextResponse.json({ error: "Không có quyền thêm hồ sơ" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { link?: string } | null;
  const link = body?.link?.trim();
  if (!link) return NextResponse.json({ error: "Thiếu link hồ sơ" }, { status: 400 });

  const customerId = parseAgentC3CustomerId(link);
  if (!customerId) return NextResponse.json({ error: "Link không hợp lệ — không đọc được mã khách hàng" }, { status: 400 });

  let raw;
  try {
    raw = await fetchAgentC3Customer(customerId);
  } catch (err) {
    if (err instanceof AgentC3ConfigError) {
      return NextResponse.json({ error: "Chưa cấu hình tài khoản CRM agentc3 (AGENTC3_USERNAME/AGENTC3_PASSWORD)" }, { status: 501 });
    }
    if (err instanceof AgentC3LoginError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    if (err instanceof AgentC3NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("[agentc3-import/fetch] Lỗi không xác định:", err);
    return NextResponse.json({ error: "Không đọc được dữ liệu từ CRM agentc3" }, { status: 502 });
  }

  const columns = (config?.columns as ColumnDef[] | undefined) ?? [];
  const statusColumn = columns.find((c) => c.id === "status");
  const matchedStatusId = matchStatusId(raw.status, statusColumn?.options);

  // "agent_leader" cũng đảm nhận được slot Agent trên hồ sơ (xem `agentUsers` trong
  // cases/page.tsx dùng cùng điều kiện) — bỏ sót role này khiến auto-match CRM thất bại cho
  // mọi Agent Leader dù tên khớp chính xác (lỗi thật gặp trên production 2026-08-25).
  const agentUsers = await prisma.user.findMany({ where: { role: { in: ["agent", "agent_leader"] } }, select: { id: true, name: true } });
  const matchedAgentUserId =
    raw.agentName.trim() && agentUsers.find((u) => u.name.trim().toLowerCase() === raw.agentName.trim().toLowerCase())?.id
      ? agentUsers.find((u) => u.name.trim().toLowerCase() === raw.agentName.trim().toLowerCase())!.id
      : null;

  const ssnPrimary = raw.ssn ? formatSsn(raw.ssn) : "";
  const ssnSpouse = raw.spouseSsn ? formatSsn(raw.spouseSsn) : "";

  // Kiểm tra trùng SSN trên TOÀN BỘ hồ sơ (không lọc theo quyền xem của người đang thao tác)
  // — đúng dữ liệu thật, tránh tạo hồ sơ mới trùng SSN đã có nhưng người dùng không thấy do
  // bị lọc RBAC (vd Agent chỉ thấy hồ sơ của mình).
  const allCases = await prisma.case.findMany({ select: { id: true, ssn: true } });
  const candidateSsns = [ssnPrimary, ssnSpouse].filter(Boolean);
  let existingCaseId: string | null = null;
  for (const c of allCases) {
    const ssnPair = (c.ssn as unknown as [string | null, string | null]) ?? [null, null];
    if (candidateSsns.some((s) => ssnPair[0] === s || ssnPair[1] === s)) {
      existingCaseId = c.id;
      break;
    }
  }

  let existingCase = null;
  if (existingCaseId) {
    const row = await prisma.case.findUnique({ where: { id: existingCaseId } });
    if (row) existingCase = toCaseRecord(row);
  }

  const address = [raw.homeAddress, raw.city, raw.state].filter(Boolean).join(", ");

  return NextResponse.json({
    customerId: raw.customerId,
    sourceUrl: buildAgentC3CustomerUrl(raw.customerId),
    taxpayer: splitNameLastWord(raw.taxpayerName),
    spouse: splitNameLastWord(raw.spouseName),
    ssn: ssnPrimary || null,
    spouseSsn: ssnSpouse || null,
    dob: parseDobPaste(raw.dob),
    spouseDob: parseDobPaste(raw.spouseDob),
    address,
    zipIrs: raw.zipIrs,
    email1: raw.email1,
    phone1: raw.phone1,
    phone2: raw.phone2,
    statusRaw: raw.status,
    matchedStatusId,
    refunds: raw.refunds,
    agentNameRaw: raw.agentName,
    matchedAgentUserId,
    bankName: raw.bankName,
    routingNumber: raw.routingNumber,
    accountNumber: raw.accountNumber,
    fcDate: raw.fullContacts || null,
    elDate: raw.engagementLetter || null,
    existingCase,
  });
}
