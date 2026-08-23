import { CaseRecord, ColumnDef, FeatureKey, FeaturePermissions, ProcessorReportTaskDef, Role, SelectOption } from "./types";
import { CHECK_INITIAL_COLUMN_ID } from "./check-initial";

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
    width: 100,
  },
  {
    id: "phone",
    key: "phone",
    label: "Phone",
    type: "phone",
    editableBy: ["manager", "agent", "processor", "support", "agent_leader", "processor_leader"],
    width: 128,
  },
  {
    id: "zipcode",
    key: "zipcode",
    label: "Zip",
    type: "zipcode",
    editableBy: ["manager", "agent", "processor", "agent_leader", "processor_leader"],
    width: 86,
  },
  // Ẩn khỏi bảng Hồ sơ theo yêu cầu (2026-08-11) — vẫn sửa được qua popup "Edit Hồ sơ"
  // (editableBy ở đây vẫn là nguồn phân quyền cho ClientProfileDialog), chỉ không còn
  // hiển thị cột riêng ngoài bảng chính nữa. Cùng cơ chế "hidden: true" với
  // dateOfBirth/phone2/email/refunds bên dưới.
  {
    id: "address",
    key: "address",
    label: "Address",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "support", "agent_leader", "processor_leader"],
    width: 90,
    hidden: true,
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
    width: 80,
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
    width: 92,
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
  // 3 ô ngày mới, đặt ngang hàng ngay dưới khối Refund trong popup "Edit Hồ sơ" (thêm
  // 2026-08-14) — cùng nhóm quyền với refunds (cùng vị trí, liên quan tới xử lý hoàn thuế).
  {
    id: "fcDate",
    key: "fcDate",
    label: "FC Date",
    type: "date",
    editableBy: ["manager", "accounting", "agent", "processor", "support", "agent_leader", "processor_leader"],
    hidden: true,
  },
  {
    id: "processingDate",
    key: "processingDate",
    label: "Processing Date",
    type: "date",
    editableBy: ["manager", "accounting", "agent", "processor", "support", "agent_leader", "processor_leader"],
    hidden: true,
  },
  {
    id: "elDate",
    key: "elDate",
    label: "EL Date",
    type: "date",
    editableBy: ["manager", "accounting", "agent", "processor", "support", "agent_leader", "processor_leader"],
    hidden: true,
  },
  // 3 ô ngân hàng, đặt ngay dưới khối 3 ô ngày ở trên trong popup "Edit Hồ sơ" (thêm
  // 2026-08-16) — chỉ dùng để điền vào email "Thông báo hoàn thuế" gửi khách hàng (xem
  // send-client-email/route.ts), cùng nhóm quyền với refunds.
  {
    id: "bankName",
    key: "bankName",
    label: "Bank Name",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "agent_leader", "processor_leader"],
    hidden: true,
  },
  {
    id: "routingNumber",
    key: "routingNumber",
    label: "Routing Number",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "agent_leader", "processor_leader"],
    hidden: true,
  },
  {
    id: "accountNumber",
    key: "accountNumber",
    label: "Account Number",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "agent_leader", "processor_leader"],
    hidden: true,
  },
  // Ghi chú tự do, đặt ngay dưới khối Taxpayer/Spouse trong popup "Edit Hồ sơ" (thêm
  // 2026-08-16) — cùng nhóm quyền với refunds/bankName, không liên quan cột "description"
  // (Mô tả, có reply threading) đã có sẵn ngoài bảng chính.
  {
    id: "note",
    key: "note",
    label: "Note",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "agent_leader", "processor_leader"],
    hidden: true,
  },
  // 2 ô "Accountant"/"Accountant Support" (thêm 2026-08-16) — cùng nhóm quyền với
  // refunds/bankName/note. accountantSupport được tự động đổ vào cột "ACCT" của tab
  // Collecting khi bấm "Send Collecting Report" (xem case-to-collecting.ts).
  {
    id: "accountant",
    key: "accountant",
    label: "Accountant",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "agent_leader", "processor_leader"],
    hidden: true,
  },
  {
    id: "accountantSupport",
    key: "accountantSupport",
    label: "Accountant Support",
    type: "text",
    editableBy: ["manager", "accounting", "agent", "processor", "agent_leader", "processor_leader"],
    hidden: true,
  },
  // Nhiều mục con độc lập (EL/Security Check/Agent guarantees SC/Bank Information/Back Tax
  // Owed/Income Variance) — cột hệ thống cố định (type "checklist", KHÔNG có trong
  // TYPE_OPTIONS của AddColumnDialog nên Admin không tự thêm thêm cột kiểu này được), giá
  // trị lưu dạng object trong custom[checkInitial] (xem CheckInitialValue trong types.ts,
  // CheckInitialCell render). Rộng hơn width mặc định cũ (150 -> 180, thêm 2026-08-13) để
  // chứa vừa nhãn dài nhất "Income Variance > 10k".
  {
    id: CHECK_INITIAL_COLUMN_ID,
    key: CHECK_INITIAL_COLUMN_ID,
    label: "Check Initial",
    type: "checklist",
    editableBy: ["manager", "processor"],
    custom: true,
    width: 180,
  },
  {
    id: "order",
    key: "order",
    label: "Order",
    type: "order",
    editableBy: ["manager", "support", "agent", "processor", "agent_leader", "processor_leader"],
    // 92 -> 118 (2026-08-23): header đổi thành "Check CRM" (dài hơn "Order") qua i18n key
    // col.header.order, tăng nhẹ để đỡ bị cắt chữ trên header.
    width: 118,
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
  // Cột GIẢ (không có field dữ liệu thật nào trong CaseRecord) chỉ dùng làm chỗ lưu trạng
  // thái ẩn/hiện dòng "Agent 2" bên trong cell "Agent" (2 slot giao việc xếp chồng trong CÙNG
  // 1 cột, xem RowCells trong cases/page.tsx) -- tái dùng đúng cơ chế `hiddenFromGrid` sẵn có
  // của các cột thường (bật/tắt qua nút cài đặt riêng cạnh header "Agent", KHÔNG phải qua
  // ColumnSettingsDialog tiêu chuẩn vì cột này không có rename/editableBy/xoá gì để quản lý).
  // `hidden: true` để loại khỏi MỌI chỗ khác lặp qua `columns` (bảng chính, Send to Sheet...)
  // -- xem types.ts cho ý nghĩa 2 flag `hidden`/`hiddenFromGrid` khác nhau thế nào.
  // `hiddenFromGrid: true` NGAY TỪ ĐẦU (khác mọi cột khác trong app, mặc định luôn là hiện) --
  // theo yêu cầu 2026-08-20 "ẩn Agent 2 ở màn hình hồ sơ" ngay lập tức, không cần Admin tự tay
  // bật lại toggle sau khi deploy. `isAgentSlot2Hidden()` (cases/page.tsx) còn tự coi CHƯA có
  // entry này trong `columns` (DB cũ chưa merge) cũng là ẩn -- giữ đồng bộ với giá trị ở đây.
  {
    id: "agentSlot2",
    key: "agentSlot2",
    label: "Agent 2",
    type: "text",
    editableBy: [],
    hidden: true,
    hiddenFromGrid: true,
  },
];

/**
 * Cột mặc định cho tab "Collecting" (bảng thu hồi công nợ, độc lập với bảng Hồ sơ) — lưu
 * trong AppConfig.collectingColumns, Quản lý thêm/sửa/xoá/đổi quyền tự do qua cùng cơ chế
 * ColumnSettingsDialog với bảng Hồ sơ. Mọi cột đều `custom: true` (giá trị lưu trong
 * CollectingRecord.custom, không có field cố định riêng nào khác). `editableBy` mặc định
 * chỉ "manager" cho tới khi có yêu cầu phân quyền cụ thể hơn — Quản lý tự mở rộng qua nút
 * cài đặt (⚙) trên từng cột, không cần sửa code (2026-08-12: theo yêu cầu "tính năng sẽ
 * thông báo sau", đây chỉ là khung bảng + cột, chưa gắn logic nghiệp vụ riêng nào).
 */
export const DEFAULT_COLLECTING_COLUMNS: ColumnDef[] = [
  { id: "date1", key: "date1", label: "Date", type: "date", editableBy: ["manager"], custom: true, width: 106 },
  { id: "confirmedBy", key: "confirmedBy", label: "Confirmed By", type: "text", editableBy: ["manager"], custom: true, width: 130 },
  { id: "name", key: "name", label: "Name", type: "text", editableBy: ["manager"], custom: true, width: 150 },
  { id: "phone", key: "phone", label: "Phone", type: "phone", editableBy: ["manager"], custom: true, width: 120 },
  { id: "program", key: "program", label: "Program", type: "text", editableBy: ["manager"], custom: true, width: 110 },
  { id: "taxOffset", key: "taxOffset", label: "Tax Offset", type: "text", editableBy: ["manager"], custom: true, width: 100 },
  { id: "acct", key: "acct", label: "Acct", type: "text", editableBy: ["manager"], custom: true, width: 90 },
  { id: "agent1", key: "agent1", label: "Agent 1", type: "text", editableBy: ["manager"], custom: true, width: 100 },
  { id: "agent2", key: "agent2", label: "Agent 2", type: "text", editableBy: ["manager"], custom: true, width: 100 },
  { id: "collector", key: "collector", label: "Collector", type: "text", editableBy: ["manager"], custom: true, width: 110 },
  { id: "year1", key: "year1", label: "Year", type: "text", editableBy: ["manager"], custom: true, width: 72 },
  { id: "qualAmount", key: "qualAmount", label: "Qual. Amount", type: "currency", editableBy: ["manager"], custom: true, width: 116 },
  { id: "approvedAmt", key: "approvedAmt", label: "Approved amt", type: "currency", editableBy: ["manager"], custom: true, width: 116 },
  { id: "upfrontFees", key: "upfrontFees", label: "Upfront fees", type: "currency", editableBy: ["manager"], custom: true, width: 110 },
  { id: "totalCollected", key: "totalCollected", label: "Total Collected", type: "currency", editableBy: ["manager"], custom: true, width: 124 },
  { id: "instalAmount", key: "instalAmount", label: "Instal. Amount", type: "currency", editableBy: ["manager"], custom: true, width: 116 },
  { id: "pmtMethod", key: "pmtMethod", label: "Pmt method", type: "text", editableBy: ["manager"], custom: true, width: 106 },
  { id: "note", key: "note", label: "Note", type: "text", editableBy: ["manager"], custom: true, width: 170 },
  { id: "tips", key: "tips", label: "Tips", type: "currency", editableBy: ["manager"], custom: true, width: 90 },
  { id: "var", key: "var", label: "VAR", type: "text", editableBy: ["manager"], custom: true, width: 90 },
  { id: "totalActualFees", key: "totalActualFees", label: "Total Actual fees", type: "currency", editableBy: ["manager"], custom: true, width: 126 },
  { id: "serviceFee", key: "serviceFee", label: "Service fee", type: "currency", editableBy: ["manager"], custom: true, width: 104 },
  { id: "cpaFillingFee", key: "cpaFillingFee", label: "CPA filling fee", type: "currency", editableBy: ["manager"], custom: true, width: 116 },
  { id: "receiptCheckNo", key: "receiptCheckNo", label: "Receipt/Check #", type: "text", editableBy: ["manager"], custom: true, width: 126 },
  { id: "receiptCheckAmt", key: "receiptCheckAmt", label: "Receipt/Check Amt.", type: "currency", editableBy: ["manager"], custom: true, width: 130 },
  { id: "cont1", key: "cont1", label: "Cont. 1", type: "text", editableBy: ["manager"], custom: true, width: 96 },
  { id: "cont2", key: "cont2", label: "Cont. 2", type: "text", editableBy: ["manager"], custom: true, width: 96 },
  { id: "cont3", key: "cont3", label: "Cont. 3", type: "text", editableBy: ["manager"], custom: true, width: 96 },
  { id: "ic", key: "ic", label: "IC", type: "text", editableBy: ["manager"], custom: true, width: 72 },
  { id: "year2", key: "year2", label: "Year", type: "text", editableBy: ["manager"], custom: true, width: 72 },
  { id: "checkUploaded", key: "checkUploaded", label: "Check Uploaded", type: "boolean", editableBy: ["manager"], custom: true, width: 118 },
  { id: "checker", key: "checker", label: "Checker", type: "text", editableBy: ["manager"], custom: true, width: 106 },
  { id: "date2", key: "date2", label: "Date", type: "date", editableBy: ["manager"], custom: true, width: 106 },
];

/**
 * Danh sách "task" (hàng) mặc định cho bảng Report trong popup "For Processor" — transcribe
 * đúng 6 nhóm việc từ 2 ảnh mẫu Processor.png (bảng cá nhân Processor, cột = ngày) và
 * processor Leader.png (bảng tổng hợp, cột = tên Processor) — 2 ảnh dùng chung 1 danh sách
 * task. Lưu trong AppConfig.processorReportTasks, Processor Leader/Quản lý tự thêm/sửa/xoá
 * qua UI (feature manageProcessorReportTasks) — đây chỉ là giá trị khởi tạo khi
 * AppConfig.processorReportTasks còn null.
 */
export const DEFAULT_PROCESSOR_REPORT_TASKS: ProcessorReportTaskDef[] = [
  { id: "process1040x_full", sectionId: "process1040x", sectionLabel: "Process 1040X", sectionOrder: 1, label: "1040-X - Full process", order: 1 },
  { id: "process1040x_resubmit", sectionId: "process1040x", sectionLabel: "Process 1040X", sectionOrder: 1, label: "Resubmit", order: 2 },
  { id: "process1040x_reverse", sectionId: "process1040x", sectionLabel: "Process 1040X", sectionOrder: 1, label: "Reverse", order: 3 },

  { id: "supportSales_checkInitials", sectionId: "supportSales", sectionLabel: "Support Sales", sectionOrder: 2, label: "Check Initials", order: 1 },
  { id: "supportSales_collectDocs", sectionId: "supportSales", sectionLabel: "Support Sales", sectionOrder: 2, label: "Collect docs/info", order: 2 },
  { id: "supportSales_others", sectionId: "supportSales", sectionLabel: "Support Sales", sectionOrder: 2, label: "Others", order: 3 },

  { id: "csSupport_solvedIrsLetters", sectionId: "csSupport", sectionLabel: "CS Support", sectionOrder: 3, label: "Solved IRS Letters", order: 1 },
  { id: "csSupport_solvingIrsLetters", sectionId: "csSupport", sectionLabel: "CS Support", sectionOrder: 3, label: "Solving IRS Letters", order: 2 },
  { id: "csSupport_check1040xTts", sectionId: "csSupport", sectionLabel: "CS Support", sectionOrder: 3, label: "Check 1040X/TTS", order: 3 },
  { id: "csSupport_fcSupport", sectionId: "csSupport", sectionLabel: "CS Support", sectionOrder: 3, label: "FC Support", order: 4 },
  { id: "csSupport_others", sectionId: "csSupport", sectionLabel: "CS Support", sectionOrder: 3, label: "Others", order: 5 },

  { id: "tts8821_eSigned", sectionId: "tts8821", sectionLabel: "8821-TTS Support", sectionOrder: 4, label: "8821 E-Signed", order: 1 },
  { id: "tts8821_uploaded", sectionId: "tts8821", sectionLabel: "8821-TTS Support", sectionOrder: 4, label: "TTS uploaded", order: 2 },
  { id: "tts8821_checkF8821", sectionId: "tts8821", sectionLabel: "8821-TTS Support", sectionOrder: 4, label: "Check F8821 / Setup Alert & update CRM", order: 3 },
  { id: "tts8821_contactClient", sectionId: "tts8821", sectionLabel: "8821-TTS Support", sectionOrder: 4, label: "Contact the client for TTS (TryChart)", order: 4 },

  { id: "collectionSupport_check1040xTts", sectionId: "collectionSupport", sectionLabel: "Collection Support", sectionOrder: 5, label: "Check 1040X/TTS", order: 1 },
  { id: "collectionSupport_checkProcessIrsLetters", sectionId: "collectionSupport", sectionLabel: "Collection Support", sectionOrder: 5, label: "Check & process IRS Letters", order: 2 },
  { id: "collectionSupport_checkUploadChecks", sectionId: "collectionSupport", sectionLabel: "Collection Support", sectionOrder: 5, label: "Check & upload checks", order: 3 },
  { id: "collectionSupport_confirmFees", sectionId: "collectionSupport", sectionLabel: "Collection Support", sectionOrder: 5, label: "Confirm fees", order: 4 },
  { id: "collectionSupport_others", sectionId: "collectionSupport", sectionLabel: "Collection Support", sectionOrder: 5, label: "Others", order: 5 },

  { id: "otherTasks_checkFilesStatus", sectionId: "otherTasks", sectionLabel: "Other tasks", sectionOrder: 6, label: "Check files status (based on GGS - CPA/CRM)", order: 1 },
  { id: "otherTasks_prepareF911", sectionId: "otherTasks", sectionLabel: "Other tasks", sectionOrder: 6, label: "Prepare F911 package", order: 2 },
  { id: "otherTasks_prepareF8822", sectionId: "otherTasks", sectionLabel: "Other tasks", sectionOrder: 6, label: "Prepare F8822", order: 3 },
  { id: "otherTasks_others1", sectionId: "otherTasks", sectionLabel: "Other tasks", sectionOrder: 6, label: "Others 1", order: 4 },
  { id: "otherTasks_others2", sectionId: "otherTasks", sectionLabel: "Other tasks", sectionOrder: 6, label: "Others 2", order: 5 },
];

/**
 * Danh sách trạng thái mặc định cho popup "Refund by years" (nút mắt cạnh cột Case) —
 * lưu trong AppConfig.refundYearStatusOptions, Quản lý thêm/sửa/xoá tự do qua UI (xem
 * CaseRefundStatusButton) giống cơ chế options của cột kiểu select. Option id "pending"
 * là id đặc biệt được code tham chiếu trực tiếp (nhấp nháy đỏ + ô nhập lý do, xem
 * hasPendingRefundYear trong refund-status.ts) — KHÔNG thể xoá qua UI dù đổi tên/màu tự do.
 */
export const DEFAULT_REFUND_YEAR_STATUS_OPTIONS: SelectOption[] = [
  { id: "preProcessing", label: "Pre-processing", bg: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  { id: "processing", label: "Processing", bg: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  { id: "pending", label: "Pending", bg: "rgba(239,68,68,0.15)", color: "#fca5a5" },
  { id: "cpaReview", label: "CPA Review", bg: "rgba(168,85,247,0.15)", color: "#d8b4fe" },
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
  // Tương tự sendCpaEmail — chỉ Processor cần liệt kê, Manager mặc định qua hasFeature().
  sendClientEmail: ["processor"],
  // Icon nhắn tin SMS (RingCentral) cạnh Status/Send Data mỗi hồ sơ — cùng nhóm role hay
  // liên hệ trực tiếp khách hàng nhất, Admin cấp thêm/thu hồi qua trang Phân quyền.
  sendSms: ["agent", "processor", "agent_leader", "processor_leader"],
  // Thêm/sửa/xoá rule ở tab Rules — mặc định CHỈ Quản lý (mảng rỗng, Manager luôn được qua
  // hasFeature() không cần liệt kê), Admin có thể cấp thêm cho role khác qua trang Phân
  // quyền. Mọi user đã đăng nhập đều XEM được tab Rules bất kể quyền này (không giới hạn xem).
  manageRules: [],
  // Ai được THẤY tab "Collecting" ở nav + truy cập trực tiếp route — trước đây hard-code
  // roles: ["manager","accounting"] ở top-nav.tsx (2026-08-12), giờ cấu hình được qua trang
  // Phân quyền (2026-08-13). Giữ "accounting" làm mặc định để hành vi hiện có không đổi cho
  // tới khi Admin chủ động cấp/thu hồi quyền cho role khác.
  viewCollecting: ["accounting"],
  // Thêm/sửa/xoá cột và thêm/xoá dòng ở tab "Collecting" — mặc định CHỈ Quản lý (mảng rỗng,
  // Manager luôn được qua hasFeature() không cần liệt kê), Admin cấp thêm cho role khác qua
  // trang Phân quyền khi tính năng/phân công cụ thể cho tab này được xác định (2026-08-12).
  // Chỉ role có viewCollecting mới thấy các nút này (không cần liệt kê ở đây, tab đã ẩn
  // hoàn toàn với role không có viewCollecting).
  addCollectingColumn: [],
  editCollectingColumn: [],
  addCollectingRow: [],
  deleteCollectingRow: [],
  // Dán link/ngắt kết nối Sheet CPA Review + sửa bảng ánh xạ tên — mặc định CHỈ Quản lý
  // (mảng rỗng, Manager luôn được qua hasFeature() không cần liệt kê).
  manageCpaReviewSheet: [],
  // Tab "CPA Review" — mặc định đúng 4 nhóm user cần dùng bảng này theo yêu cầu, Admin có
  // thể mở/thu hồi thêm qua trang Phân quyền.
  viewCpaReview: ["agent", "agent_leader", "processor", "processor_leader"],
  addCpaReviewRow: ["agent", "agent_leader", "processor", "processor_leader"],
  deleteCpaReviewRow: ["agent", "agent_leader", "processor", "processor_leader"],
  // Ai thấy nút "For Processor" (cạnh EC Qualification, bảng Hồ sơ) + popup báo cáo công
  // việc — đúng 2 nhóm dùng tính năng này theo yêu cầu, Admin có thể mở/thu hồi thêm qua
  // trang Phân quyền.
  viewForProcessor: ["processor", "processor_leader"],
  // Thêm/sửa/xoá task (hàng) trong bảng Report — mặc định CHỈ Quản lý (mảng rỗng, Manager
  // luôn được qua hasFeature() không cần liệt kê), Admin cấp thêm cho Processor Leader qua
  // trang Phân quyền khi cần.
  manageProcessorReportTasks: [],
  // Kết nối/ngắt/resync Google Sheet cho bảng tổng hợp Processor Leader — cùng lý do trên.
  manageProcessorReportSheet: [],
  // Công cụ tách 1 file PDF gộp nhiều thư IRS thành 1 file/khách hàng (tab "Notice
  // Splitter" trong popup "For Processor") — nhóm hay xử lý thư IRS thật (Processor) + Kế
  // toán/Manager, Admin cấp thêm qua trang Phân quyền.
  useIrsNoticeSplitter: ["manager", "accounting", "processor"],
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
 * Agent chỉ thấy hồ sơ được gán cho mình ở cột Agent (slot 1 HOẶC slot 2 — "Agent 2" có
 * cùng chức năng/quyền với "Agent", thêm 2026-08-12); Processor tương tự ở cột Processor
 * (2 slot). Agent Leader/Processor Leader thấy hồ sơ của các thành viên trong nhóm mình
 * phụ trách (teamMemberIds, do Admin gán) CỘNG hồ sơ gán TRỰC TIẾP cho chính leader (vì
 * leader cũng có thể được chọn trong danh sách assign cột Agent/Processor, cả 2 slot),
 * CỘNG THÊM hồ sơ do chính leader tự thêm vào (createdBy) dù chưa gán cho ai — để hồ sơ
 * vừa tạo không biến mất khỏi bảng của họ. Các role còn lại (Quản lý, Kế toán, Support)
 * thấy toàn bộ hồ sơ. assignedTo2/assignedProcessor2 optional trong Pick — caller chưa
 * kịp select 2 field mới vẫn type-check được (coi như chưa gán slot 2, an toàn).
 */
export function canViewCase(
  role: Role,
  userId: string,
  kase: Pick<CaseRecord, "assignedTo" | "assignedProcessor"> &
    Partial<Pick<CaseRecord, "createdBy" | "assignedTo2" | "assignedProcessor2">>,
  teamMemberIds?: string[]
): boolean {
  if (role === "agent") return kase.assignedTo === userId || kase.assignedTo2 === userId;
  if (role === "processor") return kase.assignedProcessor === userId || kase.assignedProcessor2 === userId;
  if (role === "agent_leader") {
    return (
      kase.assignedTo === userId ||
      kase.assignedTo2 === userId ||
      (kase.assignedTo != null && teamMemberIds?.includes(kase.assignedTo)) ||
      (kase.assignedTo2 != null && teamMemberIds?.includes(kase.assignedTo2)) ||
      kase.createdBy === userId
    );
  }
  if (role === "processor_leader") {
    return (
      kase.assignedProcessor === userId ||
      kase.assignedProcessor2 === userId ||
      (kase.assignedProcessor != null && teamMemberIds?.includes(kase.assignedProcessor)) ||
      (kase.assignedProcessor2 != null && teamMemberIds?.includes(kase.assignedProcessor2)) ||
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
  kase: Pick<CaseRecord, "assignedTo" | "assignedProcessor" | "createdBy"> &
    Partial<Pick<CaseRecord, "assignedTo2" | "assignedProcessor2">>,
  teamMemberIds?: string[]
): boolean {
  if (role === "agent_leader" || role === "processor_leader") {
    return canViewCase(role, userId, kase, teamMemberIds);
  }
  return true;
}
