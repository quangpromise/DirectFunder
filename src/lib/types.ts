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
  "sendClientEmail",
  "manageRules",
  "viewCollecting",
  "addCollectingColumn",
  "editCollectingColumn",
  "addCollectingRow",
  "deleteCollectingRow",
  "manageCpaReviewSheet",
  "viewCpaReview",
  "addCpaReviewRow",
  "deleteCpaReviewRow",
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
    sendClientEmail: "Gửi email cho khách hàng",
    manageRules: "Thêm / sửa / xóa Rules",
    viewCollecting: "Xem tab Collecting",
    addCollectingColumn: "Thêm cột mới (tab Collecting)",
    editCollectingColumn: "Sửa / xóa cột (tab Collecting)",
    addCollectingRow: "Thêm dòng mới (tab Collecting)",
    deleteCollectingRow: "Xóa dòng (tab Collecting)",
    manageCpaReviewSheet: "Cấu hình đồng bộ Google Sheet CPA Review",
    viewCpaReview: "Xem tab CPA Review",
    addCpaReviewRow: "Thêm dòng mới (tab CPA Review)",
    deleteCpaReviewRow: "Xóa dòng (tab CPA Review)",
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
    sendClientEmail: "Send email to client",
    manageRules: "Add / edit / delete Rules",
    viewCollecting: "View Collecting tab",
    addCollectingColumn: "Add new column (Collecting tab)",
    editCollectingColumn: "Edit / delete columns (Collecting tab)",
    addCollectingRow: "Add new row (Collecting tab)",
    deleteCollectingRow: "Delete row (Collecting tab)",
    manageCpaReviewSheet: "Configure CPA Review Google Sheet sync",
    viewCpaReview: "View CPA Review tab",
    addCpaReviewRow: "Add new row (CPA Review tab)",
    deleteCpaReviewRow: "Delete row (CPA Review tab)",
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

/** Mẫu Subject/Body cố định cho tính năng "Gửi email cho khách hàng" (popup Edit Hồ sơ,
 * nút cạnh ô Email) — Admin cấu hình chung toàn app qua dialog cài đặt ở trang Phân quyền.
 * Không có to/cc: người nhận LUÔN là email khách hàng của hồ sơ đang mở. Biến hỗ trợ khác
 * CpaEmailDefaults (xem client-email-template.ts) — không có {ssn}/{money}/{status}. Rỗng/
 * undefined = dùng mẫu mặc định trong code. */
export interface ClientEmailTemplate {
  subjectTemplate?: string;
  bodyTemplate?: string;
}

/** "iso" = giữ nguyên định dạng lưu trữ YYYY-MM-DD. "mdy2" = ghi vào Sheet dạng
 * Month/Day/Year với năm lấy 2 số cuối, vd "8/10/26". Chỉ ảnh hưởng cách GHI vào Google
 * Sheet, không đổi cách lưu/hiển thị cột Date trong bảng app. */
export type DateFormat = "iso" | "mdy2";

/** 1 cột dữ liệu app + đúng chữ cái cột Sheet đích (vd "B", "AA") mà nó sẽ ghi vào khi bấm
 * Send — Admin tự gõ chữ cái, KHÔNG suy ra từ thứ tự danh sách. Cột Sheet nào không xuất
 * hiện trong danh sách mapping (kể cả nằm giữa 2 cột có mapping) sẽ KHÔNG BAO GIỜ bị động
 * tới khi ghi — an toàn tuyệt đối cho dropdown/công thức/định dạng Admin đã cấu hình sẵn ở
 * các cột đó trên Sheet thật (khác thiết kế cũ dùng "Để trống" chèn giữ chỗ theo vị trí,
 * dễ ghi đè nhầm nếu tính sai thứ tự hoặc Sheet tự mở rộng validation sang dòng mới). */
/** Cấu hình đồng bộ 2 chiều "CPA Review" (xem deployment-database-sync.md mục 4.22) —
 * mapping cột CỐ ĐỊNH (không cấu hình qua UI như GoogleSheetColumnMapping), chỉ dán link
 * Sheet + chọn tab (gid) 1 lần. `rowIndex` cache số dòng theo SSN, tự chữa nếu lệch.
 * `nameToUserId` ánh xạ tên Processor/Agent xuất hiện trong Sheet (thường viết tắt, vd
 * "Toan") sang đúng User.id trong app — Admin xác nhận/sửa qua UI sau lần quét đầu. */
export interface CpaReviewSheetConfig {
  sheetId: string;
  gid: string;
  /** Tên tab thật (vd "Aug26") tra ra từ `gid` lúc kết nối — dùng cho mọi range Sheets
   * API (range tham chiếu theo tên tab, không phải gid). Nếu Admin đổi tên tab sau khi
   * kết nối, cần ngắt kết nối rồi dán lại link để tra lại tên mới. */
  tabName: string;
  rowIndex: Record<string, number>;
  webhookSecret: string;
  nameToUserId: Record<string, string>;
  connectedAt: string;
  connectedByUserId: string;
}

export interface GoogleSheetColumnMapping {
  /** id cột dữ liệu — ColumnDef.id thật, hoặc id ảo (send_date/năm refund cụ thể/CPA
   * review money) — xem sheet-row-columns.ts. */
  colId: string;
  /** Chữ cái cột Sheet đích, luôn viết hoa (vd "B", "AA"). */
  sheetColumn: string;
}

/** Sheet đích + cột nào được đẩy vào dòng mới khi bấm nút "Send" ở cột Status (chỉ hiện
 * khi status = cpa_review) — cấu hình chung toàn app (Admin sửa qua dialog cài đặt ở
 * trang Phân quyền). dateFormat áp dụng cho MỌI cột type "date" trong columnMappings
 * (không cấu hình riêng từng cột). */
export interface GoogleSheetConfig {
  sheetId: string;
  columnMappings: GoogleSheetColumnMapping[];
  dateFormat?: DateFormat;
}

export type FeaturePermissions = Record<FeatureKey, Role[]>;

/** Giá trị của cột "select" (vd. Status) — id tham chiếu tới SelectOption.id của cột đó. */
export type CaseStatus = string;

export interface User {
  id: string;
  name: string;
  email: string;
  /** Tên đăng nhập thay thế cho email — không bắt buộc, Admin đặt qua trang Quản lý tài
   * khoản. null/undefined = chưa đặt, chỉ đăng nhập được bằng email. */
  username?: string | null;
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

export type ColumnType =
  | "text"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "select"
  | "phone"
  | "order"
  | "zipcode"
  | "digits"
  // Cột hệ thống cố định "Check Initial" (4 checkbox độc lập: EL/Security Check/Agent
  // guarantees SC/Bank Information) — giống "order", KHÔNG nằm trong TYPE_OPTIONS của
  // AddColumnDialog nên Admin không tự thêm cột kiểu này được, chỉ có đúng 1 cột cố định
  // trong DEFAULT_COLUMNS (xem CHECK_INITIAL_COLUMN_ID trong check-initial.ts).
  | "checklist";

/** Giá trị của cột "Check Initial" — lưu trong CaseRecord.custom[CHECK_INITIAL_COLUMN_ID]
 * dạng object (khác mọi cột custom khác vốn chỉ string/number/boolean/null). */
export interface CheckInitialValue {
  /** Trước đây là "el" — đổi tên 2026-08-11 để tách 2 mốc EL trước/sau 07/16 (loại trừ
   * lẫn nhau, xem check-initial-cell.tsx). */
  elBefore0716: boolean;
  elAfter0716: boolean;
  securityCheck: boolean;
  agentGuaranteesSc: boolean;
  bankInfo: boolean;
  /** null = chưa chọn. "yes"/"no" tô đỏ/xanh; "collected" ("Đã thu phí tạm ứng") tô xanh +
   * thêm hậu tố "(Collected)" vào nhãn — 3 lựa chọn loại trừ nhau, chọn qua 3 nút con hiện
   * ra khi bấm vào nút "Back Tax Owed" (xem check-initial-cell.tsx). Thêm 2026-08-13. */
  backTaxOwed: "yes" | "no" | "collected" | null;
}

/** Trạng thái xử lý của 1 năm refund — chọn qua dropdown trong popup nút mắt cạnh cột
 * "Case" (CaseRefundStatusButton). Là id của 1 SelectOption trong AppConfig.refundYearStatusOptions
 * (Quản lý thêm/sửa/xoá được qua UI, xem DEFAULT_REFUND_YEAR_STATUS_OPTIONS trong rbac.ts) —
 * KHÔNG còn là union cố định, chỉ còn alias của string để phân biệt ý nghĩa tham số. */
export type RefundYearStatus = string;

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
  /** KHÁC `hidden` ở trên (field cố định/kỹ thuật, ẩn vĩnh viễn) — đây là cột BÌNH THƯỜNG bị
   * Admin/người có quyền editColumn chủ động ẨN khỏi bảng cho MỌI user (thêm 2026-08-15, yêu
   * cầu "thêm tính năng ẩn các cột không muốn xem cho tất cả user"), có thể bật lại bất cứ
   * lúc nào qua nút cấu hình (⚙) của cột. Dùng cho Cases/Orders/Collecting (đều dùng chung
   * `ColumnDef`) — CPA Review dùng cơ chế riêng (`cpaReviewHiddenColumns`, cột cố định không
   * có `ColumnDef`). */
  hiddenFromGrid?: boolean;
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
  /** Slot Agent thứ 2 — cùng chức năng/quyền với assignedTo, chỉ khác không tự động gán
   * cho người tạo hồ sơ (xem addRow trong app-store.ts). */
  assignedTo2: string | null;
  /** Slot Processor thứ 2 — cùng chức năng/quyền với assignedProcessor. */
  assignedProcessor2: string | null;
  custom: Record<string, string | number | boolean | null | CheckInitialValue>;
  /** ISO datetime lần gần nhất đã "Send row to Google Sheet" (gửi thật hoặc bấm "Mark as
   * sent" đánh dấu thủ công) — null = chưa gửi/vừa xác nhận "muốn gửi lại". Lưu ở server
   * (không chỉ React state) để nút Send giữ đúng màu xanh qua reload — xem
   * SendToSheetButton. */
  sheetSentAt: string | null;
  /** Tương tự sheetSentAt nhưng cho nút "Send mail to CPA" — xem SendCpaEmailDialog. */
  cpaEmailSentAt: string | null;
  /** Tương tự sheetSentAt/cpaEmailSentAt nhưng cho nút "Test Sheet" (gửi hồ sơ sang tab
   * "CPA Review") — xem TestSheetButton. */
  cpaReviewTestSentAt: string | null;
  /** Thứ tự hiển thị dòng trên bảng Hồ sơ (kéo-thả) — số càng nhỏ hiển thị càng lên trên.
   * Xem ghi chú fractional indexing ở reorderCase (app-store.ts) và Case.sortOrder
   * (schema.prisma). */
  sortOrder: number;
  /** Trạng thái xử lý riêng cho từng năm refund (key = năm "2022".."2025") — chọn qua
   * popup nút mắt cạnh cột "Case" (CaseRefundStatusButton). Năm có refund > 0 nhưng chưa
   * có key ở đây mặc định coi là "processing" — xem src/lib/refund-status.ts. */
  refundYearStatus: Record<string, RefundYearStatus>;
  /** Lý do Pending nhập tay (key = năm) — chỉ hiển thị/có ý nghĩa khi năm đó đang
   * "pending". Khác refundYearStatus: KHÔNG giới hạn theo role, mọi user đăng nhập đều
   * sửa được (xem PATCH /api/cases/[id]). */
  refundYearPendingReason: Record<string, string>;
  /** Ngày E-file ISO "YYYY-MM-DD" riêng cho từng năm refund (key = năm) — dùng cho đồng
   * bộ 2 chiều "CPA Review" với Google Sheet, sửa qua popup "Refund by years" cạnh
   * Status/Số tiền của mỗi năm. */
  refundYearEfileDate: Record<string, string | null>;
  /** 3 ô ngày ISO "YYYY-MM-DD" (hiển thị mm/dd/yy) đặt ngang hàng ngay dưới khối Refund
   * trong popup "Edit Hồ sơ" — chỉ sửa được ở đó, không hiển thị như cột riêng trong bảng
   * chính (giống phone2/email). null = chưa nhập. Thêm 2026-08-14. */
  fcDate: string | null;
  processingDate: string | null;
  elDate: string | null;
  /** Id người tạo hồ sơ này — dùng để Agent Leader/Processor Leader tự sửa được hồ sơ
   * do chính mình thêm vào, kể cả khi chưa gán cho thành viên nào trong nhóm. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 1 dòng trong tab "Collecting" — bảng dữ liệu kiểu Excel độc lập với bảng Hồ sơ (không
 * liên kết Case). Mọi cột (kể cả cột mặc định lẫn cột Admin tự thêm) đều lưu trong `custom`,
 * cấu trúc cột lấy từ AppConfig.collectingColumns (state.collectingColumns trong store) —
 * xem DEFAULT_COLLECTING_COLUMNS trong rbac.ts. */
export interface CollectingRecord {
  id: string;
  custom: Record<string, string | number | boolean | null>;
  /** Thứ tự hiển thị dòng (kéo-thả) — cùng cơ chế fractional indexing với Case.sortOrder. */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Bảng "CPA Review" — độc lập hoàn toàn với Case (xem prisma model `CpaReviewRecord`,
 * src/lib/cpa-review-columns.ts cho cấu trúc cột cố định). */
export interface CpaReviewRecord {
  id: string;
  /** "YYYY-MM" — tháng dữ liệu này thuộc về, xem bộ chọn tháng trên tab CPA Review. */
  month: string;
  custom: Record<string, string | number | boolean | null>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Record<monthKey ("YYYY-MM"), CpaReviewSheetConfig> — mỗi tháng 1 kết nối Sheet riêng. */
export type CpaReviewSheetConfigMap = Record<string, CpaReviewSheetConfig>;

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

/** 1 mục trong bảng tin "Rules" (quy định nội bộ, tab riêng sau Orders). `deletedAt` !=
 * null nghĩa là đã "xoá" nhưng vẫn hiển thị (đẩy xuống cuối, gạch ngang chữ) — xem
 * GET /api/rules cho thứ tự sắp xếp, ruleIsNewToday() trong lib/rules.ts cho badge "New". */
export interface RuleRecord {
  id: string;
  content: string;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
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
