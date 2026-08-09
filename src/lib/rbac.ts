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
    editableBy: ["manager", "processor", "agent"],
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
  { id: "clientName", key: "clientName", label: "Client Name", type: "text", editableBy: ["manager", "accounting", "agent", "processor", "support"], width: 210 },
  { id: "ssn", key: "ssn", label: "SSN", type: "text", editableBy: ["manager", "agent", "accounting"], width: 84 },
  { id: "phone", key: "phone", label: "Phone", type: "phone", editableBy: ["manager", "agent", "support"], width: 140 },
  { id: "zipcode", key: "zipcode", label: "Zip", type: "zipcode", editableBy: ["manager", "agent"], width: 88 },
  {
    id: "address",
    key: "address",
    label: "Address",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "support"],
    width: 90,
  },
  { id: "description", key: "description", label: "Description", type: "text", editableBy: ["manager", "agent", "processor", "support"], width: 122 },
  { id: "caseNumber", key: "caseNumber", label: "Case", type: "digits", editableBy: ["manager", "processor"], width: 78 },
  { id: "money", key: "money", label: "Money", type: "currency", editableBy: ["manager", "accounting"], width: 94 },
  { id: "order", key: "order", label: "Order", type: "order", editableBy: ["manager", "support"], width: 122 },
  // Cột Status RIÊNG của tab Order (khác với Status ở bảng Hồ sơ) — không hiển thị
  // trong bảng Hồ sơ (bị lọc bỏ khỏi otherColumns), chỉ dùng trong tab Order. Quyền
  // sửa/xóa cấu hình qua ColumnSettingsDialog giống mọi cột khác, Admin cấp thêm cho
  // nhóm nào được thì nhóm đó mới sửa được.
  {
    id: "orderStatus",
    key: "orderStatus",
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
  addRow: ["manager", "accounting", "agent", "processor", "support"],
  deleteRow: ["manager", "accounting", "agent", "processor", "support"],
  assignCase: ["manager", "accounting", "agent", "processor", "support"],
  // Quyền sửa cột Assign (giao tài khoản Support) trong tab Order — mặc định chỉ Admin,
  // Admin có thể cấp thêm cho các nhóm khác qua trang Phân quyền.
  assignSupport: ["manager"],
  manageUsers: ["manager"],
};

/** Quyền sửa từng cột hoàn toàn theo cấu hình editableBy — kể cả với Admin. */
export function canEditColumn(role: Role, column: ColumnDef): boolean {
  return column.editableBy.includes(role);
}

export function hasFeature(permissions: FeaturePermissions, feature: FeatureKey, role: Role): boolean {
  if (role === "manager") return true;
  return permissions[feature]?.includes(role) ?? false;
}

export const ASSIGNABLE_ROLES: Role[] = ["manager", "accounting", "agent", "processor", "support"];

/**
 * Agent chỉ thấy hồ sơ được gán cho mình ở cột Agent; Processor chỉ thấy hồ sơ
 * được gán cho mình ở cột Processor. Các role còn lại (Quản lý, Kế toán, Support)
 * thấy toàn bộ hồ sơ.
 */
export function canViewCase(role: Role, userId: string, kase: Pick<CaseRecord, "assignedTo" | "assignedProcessor">): boolean {
  if (role === "agent") return kase.assignedTo === userId;
  if (role === "processor") return kase.assignedProcessor === userId;
  return true;
}
