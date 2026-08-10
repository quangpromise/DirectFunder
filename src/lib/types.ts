export type Language = "vi" | "en";

/** Giao diện tối/sáng — áp dụng ở mọi màn hình sau khi đăng nhập, KHÔNG áp dụng cho
 * trang Login (trang Login luôn giữ nguyên nền gradient tối cố định). */
export type Theme = "dark" | "light";

export type Role = "manager" | "accounting" | "agent" | "processor" | "support" | "agent_leader" | "processor_leader";

/** 2 role "trưởng nhóm": chỉ xem (không sửa) toàn bộ hồ sơ của các thành viên trong
 * nhóm mình phụ trách — nhóm do Admin gán qua field User.teamMemberIds. */
export const LEADER_ROLES: Role[] = ["agent_leader", "processor_leader"];

/** Với mỗi leader role, role của các thành viên hợp lệ có thể thêm vào nhóm. */
export const LEADER_MANAGES_ROLE: Partial<Record<Role, Role>> = {
  agent_leader: "agent",
  processor_leader: "processor",
};

export const ROLE_LABEL: Record<Language, Record<Role, string>> = {
  vi: {
    manager: "Quản lý (Admin)",
    accounting: "Kế toán",
    agent: "Agent",
    processor: "Processor",
    support: "Support",
    agent_leader: "Agent Leader",
    processor_leader: "Processor Leader",
  },
  en: {
    manager: "Manager (Admin)",
    accounting: "Accounting",
    agent: "Agent",
    processor: "Processor",
    support: "Support",
    agent_leader: "Agent Leader",
    processor_leader: "Processor Leader",
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
  "sendCpaEmail",
  "sendToGoogleSheet",
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
    sendCpaEmail: "Gửi email cho CPA",
    sendToGoogleSheet: "Gửi dòng dữ liệu lên Google Sheet",
  },
  en: {
    addColumn: "Add new column",
    editColumn: "Edit / delete columns",
    addRow: "Add new row",
    deleteRow: "Delete case",
    assignCase: "Assign to others",
    assignSupport: "Edit Assign column (Support) in Order tab",
    manageUsers: "Manage accounts",
    sendCpaEmail: "Send email to CPA",
    sendToGoogleSheet: "Send row to Google Sheet",
  },
};

/** Danh sách To/Cc + mẫu Subject/Body mặc định khi gửi email CPA — cấu hình chung toàn app
 * (Admin sửa qua dialog cài đặt ở trang Phân quyền), áp dụng như nhau cho mọi hồ sơ.
 * subjectTemplate/bodyTemplate hỗ trợ biến dạng {clientName}, {ssn}... (xem cpa-email-template.ts);
 * rỗng/undefined = dùng mẫu mặc định trong code. */
export interface CpaEmailDefaults {
  to: string[];
  cc: string[];
  subjectTemplate?: string;
  bodyTemplate?: string;
}

/** "iso" = giữ nguyên định dạng lưu trữ YYYY-MM-DD. "mdy2" = ghi vào Sheet dạng
 * Month/Day/Year với năm lấy 2 số cuối, vd "8/10/26". Chỉ ảnh hưởng cách GHI vào Google
 * Sheet, không đổi cách lưu/hiển thị cột Date trong bảng app. */
export type DateFormat = "iso" | "mdy2";

/** Sheet đích + cột nào/thứ tự nào được đẩy vào dòng mới khi bấm nút "Send" ở cột
 * Status (chỉ hiện khi status = cpa_review) — cấu hình chung toàn app (Admin sửa qua
 * dialog cài đặt ở trang Phân quyền). columnIds tham chiếu ColumnDef.id trong `columns`
 * state, theo đúng thứ tự sẽ ghi vào các ô của dòng mới trên Sheet. dateFormat áp dụng
 * cho MỌI cột type "date" nằm trong columnIds (không cấu hình riêng từng cột). */
export interface GoogleSheetConfig {
  sheetId: string;
  columnIds: string[];
  dateFormat?: DateFormat;
}

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
  /** Chỉ có ý nghĩa với role agent_leader/processor_leader — danh sách id các Agent/
   * Processor mà leader này được xem hồ sơ. Do Admin gán qua trang Quản lý tài khoản. */
  teamMemberIds?: string[];
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
  /** Cột vẫn tồn tại trong dữ liệu (id nội bộ, unique...) nhưng không hiển thị trong bảng
   * Hồ sơ và không có nút cấu hình (⚙) — dùng cho "caseNumber" (đổi tên thành "Code", ẩn
   * đi) khi cột "Case" hiển thị được thay bằng 1 cột tuỳ chỉnh khác cho người dùng tự gõ. */
  hidden?: boolean;
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
  /** Ngày chọn tay (yyyy-mm-dd, không phải mốc thời gian hệ thống) — ý nghĩa khác nhau
   * theo type: "Sign Date" cho Order 8821, "Downloaded Date" cho Order TTS & WIT. */
  milestoneDate: string | null;
  /** CHỈ có ý nghĩa với Order 8821 (đặt qua popup chọn Taxpayer/Spouse/Cả 2) — order
   * này lấy Client Name + SSN của đúng client nào (0 = dòng 1, 1 = dòng 2) — áp dụng cho
   * cả Order 8821 lẫn Order TTS & WIT (cả 2 đều đặt qua popup chọn client). null = order
   * cũ trước khi có tính năng chọn client (vẫn tách hiển thị theo số Client Name đã điền
   * như trước, xem getClientEntries). */
  clientSlot: 0 | 1 | null;
  /** Id chung cho các order được tạo CÙNG 1 LẦN chọn "Cả 2" (2 bản ghi, mỗi bản ghi 1
   * client). null nếu không thuộc lô nào (đặt lẻ 1 client, hoặc order cũ trước khi có
   * tính năng này). */
  groupId: string | null;
  /** CHỈ có ý nghĩa với Order TTS & WIT (nhập ở popup chọn client lúc đặt order, bắt
   * buộc) — mô tả riêng cho lần order này. null cho Order 8821 hoặc order cũ. */
  description: string | null;
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
  /** Số điện thoại phụ — chỉ sửa được qua popup "Edit Hồ sơ" (ClientProfileDialog). */
  phone2: string;
  /** Email liên hệ — chỉ sửa được qua popup "Edit Hồ sơ". */
  email: string;
  /** Ngày sinh ISO "YYYY-MM-DD" của 2 khách hàng, cùng thứ tự với `clients`/`ssn`. null =
   * chưa nhập. Chỉ sửa được qua popup "Edit Hồ sơ". */
  dateOfBirth: [string | null, string | null];
  address: string;
  /** Nội dung mô tả gốc — không cho sửa trực tiếp, chỉ có thể "reply" thêm nội dung mới. */
  description: string;
  /** Lịch sử các lần reply vào Description, mới nhất ở cuối mảng. */
  descriptionReplies: DescriptionReply[];
  /** Danh sách userId đã xem reply mới nhất. Mỗi lần có reply mới, danh sách reset về
   * chỉ chứa người gửi — các tài khoản khác vẫn thấy màu đỏ cho tới khi họ tự mở xem. */
  descriptionReadBy: string[];
  caseNumber: string;
  /** Tổng tiền hoàn thuế — LUÔN được server tự tính = tổng `refunds`, không nhận sửa
   * trực tiếp (cột "money" có editableBy rỗng, xem DEFAULT_COLUMNS). Chỉ đổi gián tiếp
   * qua popup "Edit Hồ sơ" khi lưu refunds. */
  money: number;
  /** key năm dạng "2022".."2025", value = số tiền hoàn thuế năm đó (0 = chưa nhập).
   * `money` = tổng mọi giá trị trong đây, tự tính ở server mỗi lần popup "Edit Hồ sơ"
   * lưu — xem src/lib/refund.ts. */
  refunds: Record<string, number>;
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
  /** Id người tạo hồ sơ này — dùng để Agent Leader/Processor Leader tự sửa được hồ sơ
   * do chính mình thêm vào, kể cả khi chưa gán cho thành viên nào trong nhóm. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lịch sử xóa hồ sơ — lưu lại toàn bộ snapshot của dòng đã xóa để có thể tra cứu/kiểm tra sau này. */
export interface DeletedRowRecord {
  id: string;
  caseSnapshot: CaseRecord;
  deletedByUserId: string;
  deletedAt: string;
}

/** Lịch sử chỉnh sửa 1 ô dữ liệu — áp dụng cho mọi cột (kể cả Client Name, SSN, Status...).
 * Định danh hồ sơ trong lịch sử dùng SSN (kèm tên Client) thay vì mã hồ sơ (Case Code) —
 * theo quy ước dự án, xem workflow-conventions.md. */
export interface EditHistoryRecord {
  id: string;
  caseId: string;
  /** SSN đại diện của hồ sơ tại thời điểm sửa (xem primarySsn trong lib/client-name.ts)
   * — null nếu hồ sơ chưa có SSN nào. */
  ssn: string | null;
  clientName: string;
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
