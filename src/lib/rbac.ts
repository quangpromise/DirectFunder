import { CaseRecord, ColumnDef, FeatureKey, FeaturePermissions, Role } from "./types";

/**
 * Ma trận phân quyền cột: mỗi cột định nghĩa sẵn danh sách role được phép sửa,
 * kể cả "manager" (Admin) — Admin không còn mặc định bypass, quyền sửa từng cột
 * hoàn toàn cấu hình được qua nút cài đặt (⚙) trên tiêu đề cột.
 */
export const DEFAULT_COLUMNS: ColumnDef[] = [
  {
    id: "status",
    key: "status",
    label: "Status",
    type: "select",
    editableBy: ["manager", "processor", "agent", "agent_leader", "processor_leader"],
    width: 112,
    options: [
      { id: "pre_processing", label: "Pre-processing", bg: "rgba(59,130,246,0.15)", color: "#93c5fd" },
      { id: "processing", label: "Processing", bg: "rgba(245,158,11,0.15)", color: "#fcd34d" },
      { id: "missing_docs", label: "Missing Docs", bg: "rgba(249,115,22,0.15)", color: "#fdba74" },
      { id: "cpa_review", label: "CPA Review", bg: "rgba(168,85,247,0.15)", color: "#d8b4fe" },
      { id: "approved", label: "Approved", bg: "rgba(34,197,94,0.15)", color: "#86efac" },
      { id: "cancelled", label: "Cancelled", bg: "rgba(239,68,68,0.15)", color: "#fca5a5" },
      { id: "on_hold", label: "On-Hold", bg: "rgba(107,114,128,0.15)", color: "#d1d5db" },
    ],
  },
  {
    id: "clientName",
    key: "clientName",
    label: "Client Name",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "support", "agent_leader", "processor_leader"],
    width: 210,
  },
  {
    id: "ssn",
    key: "ssn",
    label: "SSN",
    type: "text",
    editableBy: ["manager", "agent", "processor", "accounting", "agent_leader", "processor_leader"],
    width: 112,
  },
  {
    id: "phone",
    key: "phone",
    label: "Phone",
    type: "phone",
    editableBy: ["manager", "agent", "processor", "support", "agent_leader", "processor_leader"],
    width: 140,
  },
  {
    id: "zipcode",
    key: "zipcode",
    label: "Zip",
    type: "zipcode",
    editableBy: ["manager", "agent", "processor", "agent_leader", "processor_leader"],
    width: 88,
  },
  {
    id: "address",
    key: "address",
    label: "Address",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "support", "agent_leader", "processor_leader"],
    width: 90,
  },
  {
    id: "description",
    key: "description",
    label: "Description",
    type: "text",
    editableBy: ["manager", "agent", "processor", "support", "agent_leader", "processor_leader"],
    width: 122,
  },
  // "caseNumber" là mã hệ thống tự tăng, đảm bảo duy nhất (unique trong DB) để tránh
  // trùng số khi Agent/Processor chỉ thấy tập hồ sơ đã lọc theo quyền — đổi tên thành
  // "Code" và ẩn khỏi bảng Hồ sơ, không còn hiển thị/sửa trực tiếp qua UI. Cột "Case"
  // hiển thị cho người dùng giờ là cột tuỳ chỉnh riêng (caseLabel) ngay bên dưới, tự do
  // nhập tay, không ràng buộc unique.
  {
    id: "caseNumber",
    key: "caseNumber",
    label: "Code",
    type: "digits",
    editableBy: ["manager", "processor", "agent", "agent_leader", "processor_leader"],
    width: 78,
    hidden: true,
  },
  // "Case" giờ là số đếm TỰ ĐỘNG (bao nhiêu năm trong "refunds" có tiền > 0) — không còn
  // cho gõ tay mã số tự do như trước, editableBy để rỗng CỐ Ý (server tự set giá trị mỗi
  // khi popup "Edit Hồ sơ" lưu refunds, xem POST /api/cases/[id]/client-profile +
  // src/lib/refund.ts). Giữ nguyên type "digits" vì giá trị vẫn là số nguyên hiển thị
  // bình thường, chỉ khác là không ai sửa tay được nữa.
  {
    id: "caseLabel",
    key: "caseLabel",
    label: "Case",
    type: "digits",
    editableBy: [],
    custom: true,
    width: 78,
  },
  // "Money" giờ LUÔN tự tính = tổng "refunds", editableBy để rỗng CỐ Ý để khoá sửa trực
  // tiếp trong bảng — chỉ đổi được gián tiếp qua popup "Edit Hồ sơ" (xem comment cột
  // "caseLabel" ở trên, cùng cơ chế).
  {
    id: "money",
    key: "money",
    label: "Money",
    type: "currency",
    editableBy: [],
    width: 94,
  },
  // 4 cột dưới đây KHÔNG hiển thị trong bảng Hồ sơ (hidden: true, giống "caseNumber") —
  // chỉ tồn tại để lưu editableBy làm nguồn phân quyền DUY NHẤT cho popup "Edit Hồ sơ"
  // (ClientProfileDialog tự đọc editableBy của từng cột này để bật/tắt input tương ứng,
  // KHÔNG có ô nào trong bảng chính tham chiếu tới các cột này). Admin không cấu hình lại
  // được qua nút ⚙ (không có gear icon cho cột hidden, đúng quy ước caseNumber) — cần
  // sửa trực tiếp DEFAULT_COLUMNS nếu muốn đổi.
  {
    id: "dateOfBirth",
    key: "dateOfBirth",
    label: "Date of Birth",
    type: "date",
    // Cùng nhóm với SSN (thông tin định danh khách hàng) — dùng chung danh sách role.
    editableBy: ["manager", "agent", "processor", "accounting", "agent_leader", "processor_leader"],
    hidden: true,
  },
  {
    id: "phone2",
    key: "phone2",
    label: "Phone 2",
    type: "phone",
    editableBy: ["manager", "agent", "processor", "support", "agent_leader", "processor_leader"],
    hidden: true,
  },
  {
    id: "email",
    key: "email",
    label: "Email",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "support", "agent_leader", "processor_leader"],
    hidden: true,
  },
  {
    id: "refunds",
    key: "refunds",
    label: "Refund",
    type: "currency",
    editableBy: ["manager", "accounting", "agent", "processor", "agent_leader", "processor_leader"],
    hidden: true,
  },
  {
    id: "order",
    key: "order",
    label: "Order",
    type: "order",
    editableBy: ["manager", "support", "agent", "processor", "agent_leader", "processor_leader"],
    width: 92,
  },
  // Cột Status RIÊNG của tab Order (khác với Status ở bảng Hồ sơ) — không hiển thị
  // trong bảng Hồ sơ (bị lọc bỏ khỏi otherColumns), chỉ dùng trong tab Order. Tách
  // riêng danh sách cho từng loại order (Order 8821 / Order TTS & WIT) — mỗi tab tự
  // quản lý (thêm/sửa/xóa/đổi màu) lựa chọn của mình, không dùng chung. Quyền sửa/xóa
  // cấu hình qua ColumnSettingsDialog giống mọi cột khác, Admin cấp thêm cho nhóm nào
  // được thì nhóm đó mới sửa được.
  {
    id: "orderStatusOrder8821",
    key: "orderStatusOrder8821",
    label: "Status",
    type: "select",
    editableBy: ["manager", "support"],
    width: 130,
    options: [
      { id: "done", label: "Done", bg: "rgba(34,197,94,0.15)", color: "#86efac" },
      { id: "pending", label: "Pending", bg: "rgba(107,114,128,0.15)", color: "#d1d5db" },
      { id: "processing", label: "Processing", bg: "rgba(245,158,11,0.15)", color: "#fcd34d" },
    ],
  },
  {
    id: "orderStatusOrderTtsWit",
    key: "orderStatusOrderTtsWit",
    label: "Status",
    type: "select",
    editableBy: ["manager", "support"],
    width: 130,
    options: [
      { id: "done", label: "Done", bg: "rgba(34,197,94,0.15)", color: "#86efac" },
      { id: "pending", label: "Pending", bg: "rgba(107,114,128,0.15)", color: "#d1d5db" },
      { id: "processing", label: "Processing", bg: "rgba(245,158,11,0.15)", color: "#fcd34d" },
    ],
  },
];

/**
 * Quyền theo tính năng (không gắn với cột cụ thể): admin cấu hình được qua
 * trang /dashboard/permissions. "manager" luôn được phép, bất kể cấu hình,
 * để tránh admin tự khóa quyền của chính mình.
 */
export const DEFAULT_FEATURE_PERMISSIONS: FeaturePermissions = {
  addColumn: ["manager"],
  editColumn: ["manager"],
  addRow: ["manager", "accounting", "agent", "processor", "support", "agent_leader", "processor_leader"],
  deleteRow: ["manager", "accounting", "agent", "processor", "support"],
  assignCase: ["manager", "accounting", "agent", "processor", "support", "agent_leader", "processor_leader"],
  // Quyền sửa cột Assign (giao tài khoản Support) trong tab Order — Admin và Support đều
  // được giao việc cho nhau trong nhóm Support; Admin có thể cấp thêm cho nhóm khác qua
  // trang Phân quyền.
  assignSupport: ["manager", "support"],
  manageUsers: ["manager"],
  // Nút "Send mail to CPA" trong OrderCell — chỉ Quản lý (mặc định luôn được) và
  // Processor được dùng, Admin có thể cấp thêm cho role khác qua trang Phân quyền.
  // "manager" không cần liệt kê ở đây — hasFeature() luôn cho manager true mặc định
  // (xem trên), liệt kê thêm chỉ để rõ ý định lúc đọc code là thừa/dễ hiểu lầm là cấu
  // hình được (Kế toán/Agent/Support KHÔNG được cấp — chỉ Processor + Manager thấy nút).
  sendCpaEmail: ["processor"],
  // Tương tự sendCpaEmail — chỉ Processor cần liệt kê, Manager mặc định qua hasFeature().
  sendToGoogleSheet: ["processor"],
};

/** Quyền sửa từng cột hoàn toàn theo cấu hình editableBy — kể cả với Admin. */
export function canEditColumn(role: Role, column: ColumnDef): boolean {
  return column.editableBy.includes(role);
}

export function hasFeature(permissions: FeaturePermissions, feature: FeatureKey, role: Role): boolean {
  if (role === "manager") return true;
  return permissions[feature]?.includes(role) ?? false;
}

export const ASSIGNABLE_ROLES: Role[] = [
  "manager",
  "accounting",
  "agent",
  "processor",
  "support",
  "agent_leader",
  "processor_leader",
];

/**
 * Agent chỉ thấy hồ sơ được gán cho mình ở cột Agent; Processor chỉ thấy hồ sơ
 * được gán cho mình ở cột Processor. Agent Leader/Processor Leader thấy hồ sơ của
 * các thành viên trong nhóm mình phụ trách (teamMemberIds, do Admin gán) CỘNG hồ sơ
 * gán TRỰC TIẾP cho chính leader (vì leader cũng có thể được chọn trong danh sách
 * assign cột Agent/Processor), CỘNG THÊM hồ sơ do chính leader tự thêm vào (createdBy)
 * dù chưa gán cho ai — để hồ sơ vừa tạo không biến mất khỏi bảng của họ. Các role còn
 * lại (Quản lý, Kế toán, Support) thấy toàn bộ hồ sơ.
 */
export function canViewCase(
  role: Role,
  userId: string,
  kase: Pick<CaseRecord, "assignedTo" | "assignedProcessor"> & Partial<Pick<CaseRecord, "createdBy">>,
  teamMemberIds?: string[]
): boolean {
  if (role === "agent") return kase.assignedTo === userId;
  if (role === "processor") return kase.assignedProcessor === userId;
  if (role === "agent_leader") {
    return (
      kase.assignedTo === userId ||
      (kase.assignedTo != null && teamMemberIds?.includes(kase.assignedTo)) ||
      kase.createdBy === userId
    );
  }
  if (role === "processor_leader") {
    return (
      kase.assignedProcessor === userId ||
      (kase.assignedProcessor != null && teamMemberIds?.includes(kase.assignedProcessor)) ||
      kase.createdBy === userId
    );
  }
  return true;
}

/**
 * Quyền SỬA một hồ sơ cụ thể (không chỉ theo cột) — chặt hơn canViewCase với Agent
 * Leader/Processor Leader: chỉ được sửa hồ sơ do chính mình thêm vào (createdBy) hoặc
 * đang được gán cho một thành viên trong nhóm mình phụ trách. Các role khác giữ
 * nguyên hành vi cũ (quyền sửa hoàn toàn theo canEditColumn/hasFeature, không giới
 * hạn theo từng dòng) vì Agent/Processor vốn chỉ thấy đúng hồ sơ của mình rồi.
 */
export function canEditCase(
  role: Role,
  userId: string,
  kase: Pick<CaseRecord, "assignedTo" | "assignedProcessor" | "createdBy">,
  teamMemberIds?: string[]
): boolean {
  if (role === "agent_leader" || role === "processor_leader") {
    return canViewCase(role, userId, kase, teamMemberIds);
  }
  return true;
}
