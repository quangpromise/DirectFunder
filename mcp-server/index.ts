#!/usr/bin/env node
/**
 * MCP server (chỉ đọc) cho Direct Funder — chạy LOCAL qua stdio, kết nối bằng Claude
 * Desktop/Claude Code. KHÔNG deploy lên đâu cả, KHÔNG dùng token/API key riêng — tự đăng
 * nhập bằng ĐÚNG tài khoản app (email/username + password, đọc từ biến môi trường) lúc
 * khởi động, rồi gọi lại các API route sẵn có (GET /api/cases, /api/users, /api/rules,
 * /api/me) — nghĩa là dữ liệu trả về đã được lọc RBAC đúng y hệt role của tài khoản đó khi
 * dùng qua giao diện web (canViewCase, phân quyền cột...), không có đường tắt nào bỏ qua
 * phân quyền hiện có.
 *
 * CHỈ ĐỌC (read-only) — không có tool nào gọi POST/PATCH/DELETE, đúng phạm vi đã chốt.
 *
 * Chạy thử độc lập: `npm run mcp` (script trong package.json).
 * Cấu hình Claude Desktop: xem mcp-server/README.md.
 */
import { config } from "dotenv";
config({ path: ".env.local" }); // nạp MCP_APP_BASE_URL/MCP_LOGIN_EMAIL/MCP_LOGIN_PASSWORD (dev) — cùng
// pattern prisma/pull-from-prod.ts. Không tự nạp gì khi chạy từ Claude Desktop (config đó
// truyền env trực tiếp qua "env" trong claude_desktop_config.json, xem README.md).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.MCP_APP_BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";
const LOGIN_IDENTIFIER = process.env.MCP_LOGIN_EMAIL;
const LOGIN_PASSWORD = process.env.MCP_LOGIN_PASSWORD;

if (!LOGIN_IDENTIFIER || !LOGIN_PASSWORD) {
  console.error(
    "[mcp-server] Thiếu MCP_LOGIN_EMAIL/MCP_LOGIN_PASSWORD trong biến môi trường — đây là email/username " +
      "và mật khẩu của MỘT tài khoản Direct Funder thật, dùng để MCP server tự đăng nhập và gọi API " +
      "đúng quyền tài khoản đó. Xem mcp-server/README.md."
  );
  process.exit(1);
}

let sessionCookie: string | null = null;

/** Đăng nhập 1 lần lúc khởi động, giữ cookie session để tái dùng cho mọi request sau. */
async function login(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: LOGIN_IDENTIFIER, password: LOGIN_PASSWORD }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Đăng nhập thất bại (status ${res.status}): ${body}`);
  }
  // Node's fetch (undici) hỗ trợ getSetCookie() lấy đủ mọi Set-Cookie header — chỉ có 1
  // cookie session duy nhất (direct-funder-session, xem src/lib/auth.ts).
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookie[0]?.split(";")[0];
  if (!cookie) throw new Error("Đăng nhập thành công nhưng không nhận được cookie session");
  sessionCookie = cookie;
}

/** GET 1 API route đã đăng nhập — tự đăng nhập lại 1 lần nếu cookie hết hạn (401). */
async function apiGet<T>(path: string): Promise<T> {
  if (!sessionCookie) await login();
  let res = await fetch(`${BASE_URL}${path}`, { headers: { Cookie: sessionCookie! } });
  if (res.status === 401) {
    await login();
    res = await fetch(`${BASE_URL}${path}`, { headers: { Cookie: sessionCookie! } });
  }
  if (!res.ok) throw new Error(`GET ${path} thất bại (status ${res.status})`);
  return res.json() as Promise<T>;
}

interface ClientNameEntry {
  firstName: string;
  lastName: string;
}
interface CaseRecord {
  id: string;
  status: string;
  clients: [ClientNameEntry, ClientNameEntry];
  phone: string;
  email: string;
  address: string;
  caseNumber: string;
  money: number;
  ssn: [string | null, string | null];
  assignedTo: string | null;
  assignedProcessor: string | null;
  assignedTo2: string | null;
  assignedProcessor2: string | null;
  description: string;
}
interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: string;
}
interface RuleRecord {
  id: string;
  content: string;
  createdBy: string | null;
  createdAt: string;
  deletedAt: string | null;
}

function fullName(c: { firstName: string; lastName: string }): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
}

function caseSummary(c: CaseRecord) {
  return {
    id: c.id,
    caseNumber: c.caseNumber,
    status: c.status,
    clientName: fullName(c.clients[0]) || fullName(c.clients[1]),
    ssn: c.ssn[0] || c.ssn[1],
    phone: c.phone,
    email: c.email,
    money: c.money,
    assignedTo: c.assignedTo,
    assignedProcessor: c.assignedProcessor,
  };
}

const server = new McpServer({ name: "direct-funder", version: "0.1.0" });

server.registerTool(
  "whoami",
  {
    title: "Thông tin tài khoản đang đăng nhập",
    description: "Trả về tài khoản Direct Funder mà MCP server đang dùng để gọi API (id, tên, email, role).",
    inputSchema: {},
  },
  async () => {
    const me = await apiGet<UserRecord>("/api/me");
    return { content: [{ type: "text", text: JSON.stringify(me, null, 2) }] };
  }
);

server.registerTool(
  "list_cases",
  {
    title: "Liệt kê hồ sơ (Case)",
    description:
      "Liệt kê hồ sơ khách hàng mà tài khoản đang đăng nhập có quyền xem (đã lọc RBAC theo role đúng như trên " +
      "giao diện web). Có thể lọc theo status, và/hoặc tìm theo tên/SSN/số điện thoại (search).",
    inputSchema: {
      status: z.string().optional().describe("Lọc đúng theo status (vd \"processing\", \"approved\")"),
      search: z.string().optional().describe("Tìm theo tên khách hàng, SSN, hoặc số điện thoại (không phân biệt hoa/thường)"),
      limit: z.number().int().positive().max(200).optional().describe("Số dòng tối đa trả về, mặc định 50"),
    },
  },
  async ({ status, search, limit }) => {
    const cases = await apiGet<CaseRecord[]>("/api/cases");
    let filtered = cases;
    if (status) filtered = filtered.filter((c) => c.status.toLowerCase() === status.toLowerCase());
    if (search) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((c) => {
        const name = `${fullName(c.clients[0])} ${fullName(c.clients[1])}`.toLowerCase();
        const ssn = `${c.ssn[0] ?? ""} ${c.ssn[1] ?? ""}`;
        return name.includes(q) || ssn.includes(q) || c.phone.includes(q) || c.caseNumber.toLowerCase().includes(q);
      });
    }
    const capped = filtered.slice(0, limit ?? 50);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { total: filtered.length, returned: capped.length, cases: capped.map(caseSummary) },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "get_case",
  {
    title: "Xem chi tiết 1 hồ sơ",
    description: "Lấy đầy đủ thông tin 1 hồ sơ theo id hoặc SSN (xxx-xx-xxxx).",
    inputSchema: {
      idOrSsn: z.string().describe("id hồ sơ hoặc SSN (xxx-xx-xxxx)"),
    },
  },
  async ({ idOrSsn }) => {
    const cases = await apiGet<CaseRecord[]>("/api/cases");
    const found = cases.find((c) => c.id === idOrSsn || c.ssn[0] === idOrSsn || c.ssn[1] === idOrSsn);
    if (!found) {
      return { content: [{ type: "text", text: `Không tìm thấy hồ sơ với id/SSN "${idOrSsn}" (hoặc bạn không có quyền xem).` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(found, null, 2) }] };
  }
);

server.registerTool(
  "list_users",
  {
    title: "Liệt kê tài khoản",
    description: "Liệt kê mọi tài khoản trong hệ thống (id, tên, email, role) — dùng để tra tên Agent/Processor.",
    inputSchema: {
      role: z.string().optional().describe("Lọc theo role (vd \"agent\", \"processor\", \"manager\")"),
    },
  },
  async ({ role }) => {
    const users = await apiGet<UserRecord[]>("/api/users");
    const filtered = role ? users.filter((u) => u.role === role) : users;
    return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
  }
);

server.registerTool(
  "list_rules",
  {
    title: "Liệt kê Rules (bảng tin nội bộ)",
    description: "Liệt kê các rule/thông báo nội bộ đang có hiệu lực (không bao gồm rule đã xoá, trừ khi includeDeleted).",
    inputSchema: {
      includeDeleted: z.boolean().optional().describe("true để bao gồm cả rule đã xoá mềm"),
    },
  },
  async ({ includeDeleted }) => {
    const rules = await apiGet<RuleRecord[]>("/api/rules");
    const filtered = includeDeleted ? rules : rules.filter((r) => !r.deletedAt);
    return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
  }
);

async function main() {
  await login();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mcp-server] Direct Funder MCP server đã sẵn sàng (${BASE_URL}, tài khoản ${LOGIN_IDENTIFIER}).`);
}

main().catch((err) => {
  console.error("[mcp-server] Khởi động thất bại:", err);
  process.exit(1);
});
