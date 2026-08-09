export type Language = "vi" | "en";

export type Role = "manager" | "accounting" | "agent" | "processor" | "support";

export const ROLE_LABEL: Record<Language, Record<Role, string>> = {
  vi: {
    manager: "Quản lý (Admin)",
    accounting: "Kế toán",
    agent: "Agent",
    processor: "Processor",
    support: "Support",
  },
  en: {
    manager: "Manager (Admin)",
    accounting: "Accounting",
    agent: "Agent",
    processor: "Processor",
    support: "Support",
  },
};

export const ASSIGNABLE_FEATURES = [
  "addColumn",
  "editColumn",
  "addRow",
  "deleteRow",
  "assignCase",
  "assignSupport",
  "manageUsers",
] as const;
export type FeatureKey = (typeof ASSIGNABLE_FEATURES)[number];

export const FEATURE_LABEL: Record<Language, Record<FeatureKey, string>> = {
  vi: {
    addColumn: "Thêm cột mới",
    editColumn: "Sửa / xóa cột",
    addRow: "Thêm dòng mới",
    deleteRow: "Xóa hồ sơ",
    assignCase: "Giao việc cho người khác",
    assignSupport: "Sửa cột Assign (giao Support) trong tab Order",
    manageUsers: "Quản lý tài khoản",
  },
  en: {
    addColumn: "Add new column",
    editColumn: "Edit / delete columns",
    addRow: "Add new row",
    deleteRow: "Delete case",
    assignCase: "Assign to others",
    assignSupport: "Edit Assign column (Support) in Order tab",
    manageUsers: "Manage accounts",
  },
};

export type FeaturePermissions = Record<FeatureKey, Role[]>;

/** Giá trị của cột "select" (vd. Status) — id tham chiếu tới SelectOption.id của cột đó. */
export type CaseStatus = string;

export interface User {
  id: string;
  name: string;
  email: string;
  /** Chỉ có giá trị khi TẠO tài khoản mới (gửi lên server để hash) — user lấy về từ
   * API không bao giờ có field này (server chỉ lưu passwordHash, không trả plaintext). */
  password?: string;
  role: Role;
  avatarColor: string;
  /** Ảnh đại diện dạng data URL (base64) do người dùng tự upload — null/undefined thì
   * dùng fallback là vòng tròn màu + chữ cái đầu tên (avatarColor). */
  avatarUrl?: string | null;
}

export type ColumnType = "text" | "number" | "currency" | "boolean" | "date" | "select" | "phone" | "order" | "zipcode" | "digits";

export interface SelectOption {
  id: string;
  label: string;
  bg: string;
  color: string;
}

export interface ColumnDef {
  id: string;
  key: string;
  label: string;
  type: ColumnType;
  editableBy: Role[];
  custom?: boolean;
  width?: number;
  options?: SelectOption[];
}

export interface DescriptionReply {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
}

export interface ClientNameEntry {
  firstName: string;
  lastName: string;
}

export type OrderType = "order8821" | "orderTtsWit";

/**
 * Mỗi lần bấm đặt order (kể cả đặt lại sau khi order trước đã Done) tạo ra MỘT bản ghi
 * MỚI, hoàn toàn độc lập — không ghi đè lên order trước, nên tab Order luôn giữ lại
 * lịch sử đầy đủ mọi lần order (dạng nhiều row) thay vì chỉ 1 trạng thái duy nhất mỗi
 * hồ sơ. Order 8821 và Order TTS & WIT là 2 danh sách bản ghi tách biệt hoàn toàn
 * (lọc theo `type`) — không dùng chung Status/Assign như trước.
 */
export interface OrderRecord {
  id: string;
  type: OrderType;
  placedAt: string;
  placedBy: string;
  /** Trạng thái xử lý của RIÊNG lần order này (Done/Pending/Processing...). */
  status: string | null;
  /** Thời điểm gần nhất status của lần order này thay đổi. */
  statusUpdatedAt: string | null;
  /** Tài khoản nhóm Support được giao xử lý RIÊNG lần order này. */
  assignedSupport: string | null;
}

export interface CaseRecord {
  id: string;
  status: CaseStatus;
  /** 2 dòng khách hàng cho hồ sơ này (giống layout SSN) — mỗi dòng gồm First Name và
   * Last Name nằm chung 1 hàng. */
  clients: [ClientNameEntry, ClientNameEntry];
  /** Đường link đính kèm cho tên khách hàng (kiểu hyperlink trong Excel). */
  clientLink: string | null;
  zipcode: string;
  phone: string;
  address: string;
  /** Nội dung mô tả gốc — không cho sửa trực tiếp, chỉ có thể "reply" thêm nội dung mới. */
  description: string;
  /** Lịch sử các lần reply vào Description, mới nhất ở cuối mảng. */
  descriptionReplies: DescriptionReply[];
  /** Danh sách userId đã xem reply mới nhất. Mỗi lần có reply mới, danh sách reset về
   * chỉ chứa người gửi — các tài khoản khác vẫn thấy màu đỏ cho tới khi họ tự mở xem. */
  descriptionReadBy: string[];
  caseNumber: string;
  money: number;
  /** Lịch sử đầy đủ mọi lần đặt order (cả Order 8821 lẫn Order TTS & WIT), mới nhất
   * KHÔNG tự động lên đầu — hiển thị/sắp xếp do tab Order tự xử lý. */
  orders: OrderRecord[];
  /** 2 số SSN cho hồ sơ này, mỗi số định dạng xxx-xx-xxxx, không được trùng với bất kỳ số SSN nào khác trong hệ thống. */
  ssn: [string | null, string | null];
  /** Người phụ trách vai trò Agent cho hồ sơ này. */
  assignedTo: string | null;
  /** Người phụ trách vai trò Processor cho hồ sơ này. */
  assignedProcessor: string | null;
  custom: Record<string, string | number | boolean | null>;
  updatedAt: string;
}

/** Lịch sử xóa hồ sơ — lưu lại toàn bộ snapshot của dòng đã xóa để có thể tra cứu/kiểm tra sau này. */
export interface DeletedRowRecord {
  id: string;
  caseSnapshot: CaseRecord;
  deletedByUserId: string;
  deletedAt: string;
}

/** Lịch sử chỉnh sửa 1 ô dữ liệu — áp dụng cho mọi cột (kể cả Client Name, SSN, Status...). */
export interface EditHistoryRecord {
  id: string;
  caseId: string;
  caseNumber: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
  editedByUserId: string;
  editedAt: string;
}

export type NotificationType = "assigned" | "status_change" | "mention";

export interface AppNotification {
  id: string;
  type: NotificationType;
  toUserId: string;
  fromUserId: string;
  caseId: string;
  message: string;
  read: boolean;
  createdAt: string;
}
