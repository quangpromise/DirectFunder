import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_COLUMNS, DEFAULT_FEATURE_PERMISSIONS } from "@/lib/rbac";
import { INITIAL_CASES, INITIAL_NOTIFICATIONS, INITIAL_USERS } from "@/lib/mock-data";
import { getFullName } from "@/lib/client-name";
import { api, syncInBackground } from "@/lib/api-client";
import {
  AppNotification,
  CaseRecord,
  ClientNameEntry,
  ColumnDef,
  ColumnType,
  DeletedRowRecord,
  EditHistoryRecord,
  FeatureKey,
  FeaturePermissions,
  Language,
  OrderRecord,
  OrderType,
  Role,
  SelectOption,
  User,
} from "@/lib/types";

/**
 * Sinh id duy nhất KHÔNG dựa vào bộ đếm lưu trong bộ nhớ (module-level counter) —
 * bộ đếm kiểu đó reset về giá trị ban đầu mỗi lần tải lại trang, nên 2 bản ghi tạo
 * ở 2 lần tải trang khác nhau có thể bị trùng id (ví dụ 2 tài khoản cùng id khiến
 * đăng nhập tài khoản này lại hiện ra tài khoản kia). Dùng timestamp + số ngẫu
 * nhiên để đảm bảo không trùng dù reload bao nhiêu lần.
 */
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Danh sách Status mặc định đã đổi theo thời gian. Khi đổi options mặc định, KHÔNG
 * đổi tên key lưu trữ (persist name) vì sẽ xóa sạch dữ liệu người dùng đang dùng
 * (account, hồ sơ, mật khẩu...). Thay vào đó bump `version` + khai báo `migrate` bên
 * dưới để chuyển đổi dữ liệu cũ sang schema mới mà không mất dữ liệu.
 */
const OLD_STATUS_ID_MAP: Record<string, string> = {
  new: "pre_processing",
  in_progress: "processing",
  emailed: "missing_docs",
  denied: "cancelled",
  completed: "approved",
};
const OLD_DEFAULT_STATUS_IDS = ["new", "in_progress", "emailed", "approved", "denied", "completed"];

function formatHistoryValue(value: unknown, col?: ColumnDef): string {
  if (value === null || value === undefined || value === "") return "—";
  if (col?.type === "select") {
    return col.options?.find((o) => o.id === value)?.label ?? String(value);
  }
  if (col?.type === "boolean") return value ? "Có" : "Không";
  if (col?.type === "currency" && typeof value === "number") return `$${value.toLocaleString("en-US")}`;
  return String(value);
}

interface PersistedShape {
  cases?: Array<Record<string, unknown>>;
  columns?: Array<Record<string, unknown>>;
  users?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface AppState {
  currentUserId: string | null;
  /** Ngôn ngữ hiển thị hiện tại của app — lưu persist để giữ lựa chọn qua các lần
   * đăng nhập/tải lại trang. */
  language: Language;
  cases: CaseRecord[];
  columns: ColumnDef[];
  notifications: AppNotification[];
  users: User[];
  featurePermissions: FeaturePermissions;
  deletionHistory: DeletedRowRecord[];
  editHistory: EditHistoryRecord[];

  /** true khi đã hydrate xong dữ liệu thật từ server ít nhất 1 lần trong phiên này. */
  hydrated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  /** Nạp lại users/cases/columns/featurePermissions mới nhất từ database — gọi sau khi
   * login thành công và mỗi lần dashboard mount (đảm bảo dữ liệu luôn khớp DB, không
   * chỉ dựa vào bản cache cũ trong localStorage). */
  hydrateFromServer: () => Promise<void>;
  setLanguage: (language: Language) => void;

  updateCell: (
    caseId: string,
    columnKey: string,
    value: string | number | boolean | null,
    isCustom: boolean
  ) => void;
  addRow: (creatorId: string, creatorRole: Role) => void;
  deleteRow: (caseId: string, deletedByUserId: string) => void;
  updateClientLink: (caseId: string, link: string | null) => void;
  updateSsn: (caseId: string, slot: 0 | 1, value: string | null) => void;
  updateClientName: (caseId: string, slot: 0 | 1, field: "firstName" | "lastName", value: string) => void;
  placeOrder: (caseId: string, type: OrderType, byUserId: string) => void;
  deleteOrder: (caseId: string, orderId: string) => void;
  updateOrderStatus: (caseId: string, orderId: string, status: string | null) => void;
  assignOrderSupport: (caseId: string, orderId: string, toUserId: string) => void;
  addDescriptionReply: (caseId: string, authorId: string, text: string) => void;
  markDescriptionRead: (caseId: string, userId: string) => void;

  addColumn: (label: string, type: ColumnType, options?: Omit<SelectOption, "id">[]) => void;
  removeColumn: (columnId: string) => void;
  renameColumn: (columnId: string, label: string) => void;
  setColumnEditableBy: (columnId: string, roles: Role[]) => void;
  addColumnOption: (columnId: string, option: Omit<SelectOption, "id">) => void;
  updateColumnOption: (columnId: string, optionId: string, patch: Partial<Omit<SelectOption, "id">>) => void;
  removeColumnOption: (columnId: string, optionId: string) => void;

  assignCase: (caseId: string, toUserId: string, field: "assignedTo" | "assignedProcessor") => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  addUser: (user: Omit<User, "id">) => Promise<boolean>;
  updateUserRole: (userId: string, role: Role) => void;
  removeUser: (userId: string) => void;
  changePassword: (userId: string, currentPassword: string, newPassword: string) => Promise<boolean>;
  updateAvatar: (userId: string, avatarUrl: string | null) => void;

  setFeaturePermission: (feature: FeatureKey, role: Role, allowed: boolean) => void;

  reorderColumn: (fromId: string, toId: string) => void;
  reorderCase: (fromId: string, toId: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => {
      function logEdit(caseId: string, fieldLabel: string, oldValue: string, newValue: string) {
        if (oldValue === newValue) return;
        const state = get();
        const kase = state.cases.find((c) => c.id === caseId);
        const entry: EditHistoryRecord = {
          id: uniqueId("edit"),
          caseId,
          caseNumber: kase?.caseNumber ?? "",
          fieldLabel,
          oldValue,
          newValue,
          editedByUserId: state.currentUserId ?? "",
          editedAt: new Date().toISOString(),
        };
        set((s) => ({ editHistory: [entry, ...s.editHistory] }));
      }

      /** Đồng bộ lại field `orders` của 1 case lên server sau khi set() cục bộ đã xong
       * — dùng chung cho mọi thao tác đụng tới orders[] (đặt/xoá/đổi status/assign). */
      function syncOrders(caseId: string) {
        const kase = get().cases.find((c) => c.id === caseId);
        if (kase) syncInBackground("orders", api.patchCase(caseId, { orders: kase.orders }));
      }

      /** Đồng bộ nguyên cụm columns + featurePermissions lên AppConfig (bảng singleton)
       * sau khi set() cục bộ đã xong — dùng chung cho mọi thao tác sửa cấu hình cột /
       * ma trận phân quyền (server chỉ chấp nhận role manager, request khác sẽ bị 403
       * và log lỗi ra console, không rollback local — chấp nhận được ở giai đoạn này vì
       * trang cài đặt cột/phân quyền vốn chỉ hiện cho manager). */
      function syncConfig() {
        const state = get();
        syncInBackground("config", api.putConfig(state.columns, state.featurePermissions));
      }

      return {
      currentUserId: null,
      hydrated: false,
      language: "vi",
      cases: INITIAL_CASES,
      columns: DEFAULT_COLUMNS,
      notifications: INITIAL_NOTIFICATIONS,
      users: INITIAL_USERS,
      featurePermissions: DEFAULT_FEATURE_PERMISSIONS,
      deletionHistory: [],
      editHistory: [],

      login: async (email, password) => {
        try {
          const user = await api.login(email, password);
          set({ currentUserId: user.id });
          await get().hydrateFromServer();
          return true;
        } catch {
          return false;
        }
      },
      logout: () => {
        syncInBackground("logout", api.logout());
        set({ currentUserId: null });
      },
      // Users/Cases/Column config giờ lấy từ database thật qua API (xem
      // .claude/rules/deployment-database-sync.md) — bản trong localStorage chỉ còn là
      // cache hiển thị tạm trước khi hydrate xong, luôn bị ghi đè bởi dữ liệu server.
      hydrateFromServer: async () => {
        const [users, cases, config] = await Promise.all([api.listUsers(), api.listCases(), api.getConfig()]);
        set({
          users,
          cases,
          columns: config.columns,
          featurePermissions: config.featurePermissions,
          hydrated: true,
        });
      },
      setLanguage: (language) => set({ language }),

      updateCell: (caseId, columnKey, value, isCustom) => {
        const state = get();
        const kase = state.cases.find((c) => c.id === caseId);
        if (kase) {
          const col = state.columns.find((c) => c.key === columnKey);
          const oldRaw = isCustom ? kase.custom[columnKey] : (kase as unknown as Record<string, unknown>)[columnKey];
          logEdit(caseId, col?.label ?? columnKey, formatHistoryValue(oldRaw, col), formatHistoryValue(value, col));
        }
        set((s) => ({
          cases: s.cases.map((c) => {
            if (c.id !== caseId) return c;
            if (isCustom) {
              return { ...c, custom: { ...c.custom, [columnKey]: value }, updatedAt: new Date().toISOString() };
            }
            return { ...c, [columnKey]: value, updatedAt: new Date().toISOString() };
          }),
        }));
        syncInBackground(
          "updateCell",
          api.patchCase(
            caseId,
            (isCustom ? { custom: { [columnKey]: value } } : { [columnKey]: value }) as Partial<CaseRecord>
          )
        );
      },

      // Mỗi lần đặt order (kể cả đặt lại sau khi order trước đã Done) tạo THÊM 1 bản
      // ghi MỚI vào orders[], không ghi đè/xóa order cũ — tab Order luôn giữ đủ lịch
      // sử mọi lần order trước đó dưới dạng các row riêng biệt. Order 8821 và Order
      // TTS & WIT là 2 danh sách hoàn toàn tách biệt (lọc theo `type`).
      placeOrder: (caseId, type, byUserId) => {
        const newOrder: OrderRecord = {
          id: uniqueId("ord"),
          type,
          placedAt: new Date().toISOString(),
          placedBy: byUserId,
          status: null,
          statusUpdatedAt: null,
          assignedSupport: null,
        };
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId ? { ...c, orders: [...c.orders, newOrder], updatedAt: new Date().toISOString() } : c
          ),
        }));
        syncOrders(caseId);
      },

      // Xóa hẳn 1 dòng order cụ thể khỏi lịch sử (không xóa hồ sơ) — mọi tài khoản xem
      // được tab Order đều có quyền xóa (không giới hạn theo feature permission riêng).
      deleteOrder: (caseId, orderId) => {
        const kase = get().cases.find((c) => c.id === caseId);
        const target = kase?.orders.find((o) => o.id === orderId);
        if (target) {
          const label = target.type === "order8821" ? "Order 8821" : "Order TTS & WIT";
          logEdit(caseId, label, "Đã đặt", "Đã xóa khỏi tab Order");
        }
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId
              ? { ...c, orders: c.orders.filter((o) => o.id !== orderId), updatedAt: new Date().toISOString() }
              : c
          ),
        }));
        syncOrders(caseId);
      },

      // Status RIÊNG của từng lần order — mỗi lần đổi giá trị tự ghi lại mốc thời gian
      // thay đổi (statusUpdatedAt) để hiển thị ở cột "Ngày thực hiện".
      updateOrderStatus: (caseId, orderId, status) => {
        const kase = get().cases.find((c) => c.id === caseId);
        const target = kase?.orders.find((o) => o.id === orderId);
        if (target) {
          const label = target.type === "order8821" ? "Order 8821 - Status" : "Order TTS & WIT - Status";
          logEdit(caseId, label, formatHistoryValue(target.status), formatHistoryValue(status));
        }
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId
              ? {
                  ...c,
                  orders: c.orders.map((o) =>
                    o.id === orderId ? { ...o, status, statusUpdatedAt: new Date().toISOString() } : o
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
        }));
        syncOrders(caseId);
      },

      // Giao tài khoản Support xử lý RIÊNG 1 lần order — tách biệt hoàn toàn giữa Order
      // 8821 và Order TTS & WIT (không dùng chung Assign như trước).
      assignOrderSupport: (caseId, orderId, toUserId) => {
        const state = get();
        const fromUserId = state.currentUserId ?? "u-admin";
        const fromUser = state.users.find((u) => u.id === fromUserId);
        const targetCase = state.cases.find((c) => c.id === caseId);
        const targetOrder = targetCase?.orders.find((o) => o.id === orderId);
        const orderLabel = targetOrder?.type === "orderTtsWit" ? "Order TTS & WIT" : "Order 8821";
        set((s) => ({
          cases: s.cases.map((c) =>
            c.id === caseId
              ? {
                  ...c,
                  orders: c.orders.map((o) => (o.id === orderId ? { ...o, assignedSupport: toUserId } : o)),
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          notifications: [
            {
              id: uniqueId("n"),
              type: "assigned",
              toUserId,
              fromUserId,
              caseId,
              message: `${fromUser?.name ?? "Ai đó"} đã giao cho bạn ${orderLabel} của hồ sơ ${targetCase?.caseNumber ?? ""} (${targetCase ? getFullName(targetCase) : ""})`,
              read: false,
              createdAt: new Date().toISOString(),
            },
            ...s.notifications,
          ],
        }));
        syncOrders(caseId);
      },

      addRow: (creatorId, creatorRole) => {
        const state = get();
        const id = uniqueId("c");
        // Số hồ sơ hiển thị (dạng số thuần) tính theo số lớn nhất đang có (kể cả hồ sơ
        // đã xóa trong lịch sử) + 1 — đọc trực tiếp từ dữ liệu hiện tại thay vì bộ đếm
        // riêng, nên không bao giờ lặp lại số dù reload trang bao nhiêu lần. Đây chỉ là
        // giá trị TẠM để hiển thị ngay: state.cases có thể đã bị lọc theo quyền xem (Agent/
        // Processor chỉ thấy hồ sơ của mình) nên số này dễ bị trùng — server luôn tự tính
        // lại caseNumber thật trên toàn bộ dữ liệu và trả về, xem phần reconcile bên dưới.
        const maxCaseNum = [...state.cases, ...state.deletionHistory.map((d) => d.caseSnapshot)].reduce(
          (max, c) => {
            const m = /^(\d+)$/.exec(c.caseNumber);
            return m ? Math.max(max, Number(m[1])) : max;
          },
          1000
        );
        const optimistic: CaseRecord = {
          id,
          status: "pre_processing",
          clients: [
            { firstName: "", lastName: "" },
            { firstName: "", lastName: "" },
          ],
          clientLink: null,
          zipcode: "",
          address: "",
          phone: "",
          description: "",
          caseNumber: `${maxCaseNum + 1}`,
          money: 0,
          orders: [],
          // Tự gán cho người tạo nếu là Agent/Processor, để hồ sơ mới không biến mất
          // khỏi danh sách hồ sơ họ được thấy (đã lọc theo canViewCase).
          assignedTo: creatorRole === "agent" ? creatorId : null,
          assignedProcessor: creatorRole === "processor" ? creatorId : null,
          ssn: [null, null],
          descriptionReplies: [],
          descriptionReadBy: [],
          custom: {},
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ cases: [...s.cases, optimistic] }));

        // Đợi phản hồi rồi thay case tạm bằng bản server trả về (có caseNumber thật);
        // nếu request lỗi (vd. hết quyền), rollback bỏ dòng tạm để không hiển thị nhầm
        // 1 hồ sơ chưa thực sự được lưu.
        api.createCase(optimistic).then(
          (serverCase) => {
            set((s) => ({ cases: s.cases.map((c) => (c.id === optimistic.id ? serverCase : c)) }));
          },
          (err) => {
            console.error("[sync:addRow] Tạo hồ sơ thất bại, hoàn tác dòng tạm:", err);
            set((s) => ({ cases: s.cases.filter((c) => c.id !== optimistic.id) }));
          }
        );
      },

      deleteRow: (caseId, deletedByUserId) => {
        set((state) => {
          const target = state.cases.find((c) => c.id === caseId);
          if (!target) return {};
          return {
            cases: state.cases.filter((c) => c.id !== caseId),
            deletionHistory: [
              {
                id: uniqueId("del"),
                caseSnapshot: target,
                deletedByUserId,
                deletedAt: new Date().toISOString(),
              },
              ...state.deletionHistory,
            ],
          };
        });
        syncInBackground("deleteRow", api.deleteCase(caseId));
      },

      updateClientLink: (caseId, link) => {
        const kase = get().cases.find((c) => c.id === caseId);
        if (kase) logEdit(caseId, "Client Name - Link", formatHistoryValue(kase.clientLink), formatHistoryValue(link));
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId ? { ...c, clientLink: link, updatedAt: new Date().toISOString() } : c
          ),
        }));
        syncInBackground("clientLink", api.patchCase(caseId, { clientLink: link }));
      },

      updateSsn: (caseId, slot, value) => {
        const kase = get().cases.find((c) => c.id === caseId);
        if (kase) logEdit(caseId, `SSN #${slot + 1}`, formatHistoryValue(kase.ssn[slot]), formatHistoryValue(value));
        let nextSsn: [string | null, string | null] = ["", ""] as unknown as [string | null, string | null];
        set((state) => ({
          cases: state.cases.map((c) => {
            if (c.id !== caseId) return c;
            const ssn: [string | null, string | null] = [...c.ssn];
            ssn[slot] = value;
            nextSsn = ssn;
            return { ...c, ssn, updatedAt: new Date().toISOString() };
          }),
        }));
        syncInBackground("ssn", api.patchCase(caseId, { ssn: nextSsn }));
      },

      updateClientName: (caseId, slot, field, value) => {
        const kase = get().cases.find((c) => c.id === caseId);
        if (kase) {
          const fieldLabel = `Client Name #${slot + 1} - ${field === "firstName" ? "First Name" : "Last Name"}`;
          logEdit(caseId, fieldLabel, formatHistoryValue(kase.clients[slot][field]), formatHistoryValue(value));
        }
        let nextClients: [ClientNameEntry, ClientNameEntry] | null = null;
        set((state) => ({
          cases: state.cases.map((c) => {
            if (c.id !== caseId) return c;
            const clients: [ClientNameEntry, ClientNameEntry] = [...c.clients];
            clients[slot] = { ...clients[slot], [field]: value };
            nextClients = clients;
            return { ...c, clients, updatedAt: new Date().toISOString() };
          }),
        }));
        if (nextClients) syncInBackground("clients", api.patchCase(caseId, { clients: nextClients }));
      },

      addDescriptionReply: (caseId, authorId, text) => {
        set((state) => {
          const updated = state.cases.map((c) =>
            c.id === caseId
              ? {
                  ...c,
                  descriptionReplies: [
                    ...c.descriptionReplies,
                    { id: uniqueId("dr"), authorId, text, createdAt: new Date().toISOString() },
                  ],
                  // Reply mới chỉ tính là "đã đọc" với người vừa gửi — các tài khoản khác
                  // vẫn thấy màu đỏ cho tới khi tự mở xem.
                  descriptionReadBy: [authorId],
                  updatedAt: new Date().toISOString(),
                }
              : c
          );
          // Có description mới thì đẩy hẳn row của hồ sơ đó lên đầu bảng, giống thứ tự
          // hội thoại có tin nhắn mới nhất — không chỉ đổi màu chữ mà đổi cả vị trí row.
          const idx = updated.findIndex((c) => c.id === caseId);
          if (idx <= 0) return { cases: updated };
          const [moved] = updated.splice(idx, 1);
          updated.unshift(moved);
          return { cases: updated };
        });
        const kase = get().cases.find((c) => c.id === caseId);
        if (kase) {
          syncInBackground(
            "descriptionReply",
            api.patchCase(caseId, { descriptionReplies: kase.descriptionReplies, descriptionReadBy: kase.descriptionReadBy })
          );
        }
      },

      markDescriptionRead: (caseId, userId) => {
        set((state) => ({
          cases: state.cases.map((c) =>
            c.id === caseId && !c.descriptionReadBy.includes(userId)
              ? { ...c, descriptionReadBy: [...c.descriptionReadBy, userId] }
              : c
          ),
        }));
        const kase = get().cases.find((c) => c.id === caseId);
        if (kase) syncInBackground("descriptionReadBy", api.patchCase(caseId, { descriptionReadBy: kase.descriptionReadBy }));
      },

      addColumn: (label, type, options) => {
        set((state) => {
          const key = uniqueId("custom");
          const col: ColumnDef = {
            id: key,
            key,
            label,
            type,
            editableBy: ["manager", "accounting", "agent", "processor", "support"],
            custom: true,
            width: 160,
            options:
              type === "select"
                ? (options ?? []).map((o) => ({ ...o, id: uniqueId("opt") }))
                : undefined,
          };
          return { columns: [...state.columns, col] };
        });
        syncConfig();
      },

      removeColumn: (columnId) => {
        set((state) => ({ columns: state.columns.filter((c) => c.id !== columnId) }));
        syncConfig();
      },

      renameColumn: (columnId, label) => {
        set((state) => ({
          columns: state.columns.map((c) => (c.id === columnId ? { ...c, label } : c)),
        }));
        syncConfig();
      },

      setColumnEditableBy: (columnId, roles) => {
        set((state) => ({
          columns: state.columns.map((c) => (c.id === columnId ? { ...c, editableBy: roles } : c)),
        }));
        syncConfig();
      },

      addColumnOption: (columnId, option) => {
        set((state) => ({
          columns: state.columns.map((c) =>
            c.id === columnId
              ? { ...c, options: [...(c.options ?? []), { ...option, id: uniqueId("opt") }] }
              : c
          ),
        }));
        syncConfig();
      },

      updateColumnOption: (columnId, optionId, patch) => {
        set((state) => ({
          columns: state.columns.map((c) =>
            c.id === columnId
              ? { ...c, options: (c.options ?? []).map((o) => (o.id === optionId ? { ...o, ...patch } : o)) }
              : c
          ),
        }));
        syncConfig();
      },

      removeColumnOption: (columnId, optionId) => {
        set((state) => ({
          columns: state.columns.map((c) =>
            c.id === columnId ? { ...c, options: (c.options ?? []).filter((o) => o.id !== optionId) } : c
          ),
        }));
        syncConfig();
      },

      assignCase: (caseId, toUserId, field) => {
        const state = get();
        const fromUserId = state.currentUserId ?? "u-admin";
        const fromUser = state.users.find((u) => u.id === fromUserId);
        const targetCase = state.cases.find((c) => c.id === caseId);
        const roleLabel = field === "assignedProcessor" ? "Processor" : "Agent";
        set((s) => ({
          cases: s.cases.map((c) =>
            c.id === caseId ? { ...c, [field]: toUserId, updatedAt: new Date().toISOString() } : c
          ),
          notifications: [
            {
              id: uniqueId("n"),
              type: "assigned",
              toUserId,
              fromUserId,
              caseId,
              message: `${fromUser?.name ?? "Ai đó"} đã giao cho bạn hồ sơ ${targetCase?.caseNumber ?? ""} (${targetCase ? getFullName(targetCase) : ""}) vai trò ${roleLabel}`,
              read: false,
              createdAt: new Date().toISOString(),
            },
            ...s.notifications,
          ],
        }));
        syncInBackground("assignCase", api.patchCase(caseId, { [field]: toUserId } as Partial<CaseRecord>));
      },

      markNotificationRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        })),

      markAllNotificationsRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.toUserId === state.currentUserId ? { ...n, read: true } : n
          ),
        })),

      // Server tự sinh id thật (khác uniqueId cục bộ) + hash mật khẩu — phải đợi response
      // rồi mới thêm vào state để id luôn khớp với DB, tránh 2 nguồn id lệch nhau.
      addUser: async (user) => {
        try {
          const created = await api.createUser(user);
          set((state) => ({ users: [...state.users, { ...created, password: undefined }] }));
          return true;
        } catch (err) {
          console.error("[addUser] Tạo tài khoản thất bại:", err);
          return false;
        }
      },

      updateUserRole: (userId, role) => {
        set((state) => ({
          users: state.users.map((u) => (u.id === userId ? { ...u, role } : u)),
        }));
        syncInBackground("updateUserRole", api.updateUserRole(userId, role));
      },

      removeUser: (userId) => {
        set((state) => ({
          users: state.users.filter((u) => u.id !== userId),
          currentUserId: state.currentUserId === userId ? null : state.currentUserId,
        }));
        syncInBackground("removeUser", api.removeUser(userId));
      },

      // Xác minh mật khẩu hiện tại + hash mật khẩu mới đều do server làm (bcrypt) — local
      // không còn lưu password nên không tự kiểm tra được nữa, phải hỏi server.
      changePassword: async (userId, currentPassword, newPassword) => {
        try {
          await api.changePassword(userId, currentPassword, newPassword);
          return true;
        } catch {
          return false;
        }
      },

      updateAvatar: (userId, avatarUrl) => {
        set((state) => ({
          users: state.users.map((u) => (u.id === userId ? { ...u, avatarUrl } : u)),
        }));
        syncInBackground("updateAvatar", api.updateUserAvatar(userId, avatarUrl));
      },

      setFeaturePermission: (feature, role, allowed) => {
        set((state) => {
          const current = state.featurePermissions[feature] ?? [];
          const next = allowed ? Array.from(new Set([...current, role])) : current.filter((r) => r !== role);
          return { featurePermissions: { ...state.featurePermissions, [feature]: next } };
        });
        syncConfig();
      },

      // Ghi chú: reorderColumn/reorderCase chỉ đổi thứ tự hiển thị cục bộ, AppConfig/Case
      // hiện chưa có field lưu thứ tự nên chưa đồng bộ lên server ở giai đoạn này.
      reorderColumn: (fromId, toId) => {
        set((state) => {
          if (fromId === toId) return {};
          const cols = [...state.columns];
          const fromIdx = cols.findIndex((c) => c.id === fromId);
          const toIdx = cols.findIndex((c) => c.id === toId);
          if (fromIdx === -1 || toIdx === -1) return {};
          const [moved] = cols.splice(fromIdx, 1);
          cols.splice(toIdx, 0, moved);
          return { columns: cols };
        });
        syncConfig();
      },

      reorderCase: (fromId, toId) =>
        set((state) => {
          if (fromId === toId) return {};
          const list = [...state.cases];
          const fromIdx = list.findIndex((c) => c.id === fromId);
          const toIdx = list.findIndex((c) => c.id === toId);
          if (fromIdx === -1 || toIdx === -1) return {};
          const [moved] = list.splice(fromIdx, 1);
          list.splice(toIdx, 0, moved);
          return { cases: list };
        }),
      };
    },
    {
      name: "direct-funder-store-v10",
      version: 23,
      migrate: (persisted, version) => {
        const state = persisted as PersistedShape;
        if (!state) return state as unknown as AppState;

        if (version < 1) {
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const oldStatus = c.status as string | undefined;
              const mapped = oldStatus ? OLD_STATUS_ID_MAP[oldStatus] : undefined;
              return mapped ? { ...c, status: mapped } : c;
            });
          }
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) => {
              if (col.id !== "status" || !Array.isArray(col.options)) return col;
              const currentIds = (col.options as Array<{ id: string }>).map((o) => o.id);
              const isUntouchedDefault =
                currentIds.length === OLD_DEFAULT_STATUS_IDS.length &&
                OLD_DEFAULT_STATUS_IDS.every((id) => currentIds.includes(id));
              if (!isUntouchedDefault) return col;
              const newStatusCol = DEFAULT_COLUMNS.find((c) => c.id === "status");
              return newStatusCol ? { ...col, options: newStatusCol.options } : col;
            });
          }
        }

        if (version < 2) {
          // Bỏ cột tick "done" và đổi cột "emailed" thành "order" (2 nút order8821 /
          // orderTtsWit) — giữ nguyên mọi tùy biến khác (label, editableBy, width...)
          // của cột, chỉ đổi định danh để khớp với ô render mới.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const { done, emailed, ...rest } = c as Record<string, unknown> & { done?: unknown; emailed?: unknown };
              return {
                ...rest,
                order8821: typeof rest.order8821 === "boolean" ? rest.order8821 : Boolean(emailed),
                orderTtsWit: typeof rest.orderTtsWit === "boolean" ? rest.orderTtsWit : false,
              };
            });
          }
          if (Array.isArray(state.columns)) {
            state.columns = state.columns
              .filter((col) => col.id !== "done")
              .map((col) => {
                if (col.id !== "emailed") return col;
                // Width cũ (62px) là cho checkbox, quá hẹp cho 2 nút order mới — luôn
                // dùng width mặc định mới, các tùy biến khác (label, editableBy...) giữ nguyên.
                const newWidth = DEFAULT_COLUMNS.find((c) => c.id === "order")?.width ?? 130;
                return { ...col, id: "order", key: "order", type: "order", width: newWidth };
              });
          }
        }

        if (version < 3) {
          // Tách "clientName" (1 chuỗi) thành clientFirstName/clientLastName (2 dòng,
          // giống layout SSN) — tách theo khoảng trắng đầu tiên, không mất dữ liệu tên cũ.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              if (typeof rec.clientFirstName === "string" && typeof rec.clientLastName === "string") return c;
              const oldName = typeof rec.clientName === "string" ? rec.clientName.trim() : "";
              const spaceIdx = oldName.indexOf(" ");
              const { clientName, ...rest } = rec;
              void clientName;
              return {
                ...rest,
                clientFirstName: spaceIdx === -1 ? oldName : oldName.slice(0, spaceIdx),
                clientLastName: spaceIdx === -1 ? "" : oldName.slice(spaceIdx + 1),
              };
            });
          }
        }

        if (version < 4) {
          // Client Name giờ có 2 dòng (2 khách hàng), mỗi dòng gồm First + Last Name
          // cùng 1 hàng — gộp clientFirstName/clientLastName cũ (1 khách) vào dòng đầu
          // của mảng `clients`, dòng thứ 2 để trống cho khách hàng phụ (nếu có).
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              if (Array.isArray(rec.clients)) return c;
              const { clientFirstName, clientLastName, ...rest } = rec;
              return {
                ...rest,
                clients: [
                  { firstName: typeof clientFirstName === "string" ? clientFirstName : "", lastName: typeof clientLastName === "string" ? clientLastName : "" },
                  { firstName: "", lastName: "" },
                ],
              };
            });
          }
        }

        if (version < 5) {
          // Cột Client Name giờ cho phép TẤT CẢ tài khoản sửa (kể cả chèn link), không
          // còn giới hạn Admin/Agent như trước — áp dụng bắt buộc vì đây không phải tùy
          // chọn có thể cấu hình qua UI cho cột này.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) =>
              col.id === "clientName"
                ? { ...col, editableBy: ["manager", "accounting", "agent", "processor", "support"] }
                : col
            );
          }
        }

        if (version < 6) {
          // Tính năng "Xóa hồ sơ" giờ mặc định mở cho TẤT CẢ bộ phận (không riêng Admin) —
          // ép cập nhật cho dữ liệu cũ đang bị kẹt ở quyền mặc định trước đây (chỉ manager).
          const fp = state.featurePermissions as Record<string, string[]> | undefined;
          if (fp) {
            fp.deleteRow = ["manager", "accounting", "agent", "processor", "support"];
          }
        }

        if (version < 7) {
          // Tách quyền cột "manageColumns" (gộp thêm/sửa/xóa) thành 2 quyền riêng:
          // "addColumn" (thêm cột mới) và "editColumn" (sửa/xóa cột) để phân quyền linh
          // hoạt hơn — role nào đã có quyền cũ thì được cấp cả 2 quyền mới, không mất quyền.
          const fp = state.featurePermissions as Record<string, string[]> | undefined;
          if (fp && Array.isArray(fp.manageColumns)) {
            fp.addColumn = fp.addColumn ?? [...fp.manageColumns];
            fp.editColumn = fp.editColumn ?? [...fp.manageColumns];
            delete fp.manageColumns;
          }
        }

        if (version < 8) {
          // Cột "order" trước đây giữ nguyên label cũ ("Emailed") khi đổi từ checkbox
          // sang 2 nút order — ép về đúng label "Order" và nới rộng width để hiển thị
          // đủ chữ "Order TTS & WIT" không bị cắt, không đụng tới dữ liệu case khác.
          if (Array.isArray(state.columns)) {
            const defaultOrderWidth = DEFAULT_COLUMNS.find((c) => c.id === "order")?.width ?? 150;
            state.columns = state.columns.map((col) =>
              col.id === "order" ? { ...col, label: "Order", width: defaultOrderWidth } : col
            );
          }
        }

        if (version < 9) {
          // Thêm mốc thời gian đặt order (order8821PlacedAt/orderTtsWitPlacedAt) để tab
          // Order sắp xếp được theo thời gian — hồ sơ cũ đã đặt order trước đây không có
          // mốc thời gian gốc nên để null (rơi xuống cuối danh sách), không suy đoán sai.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => ({
              ...c,
              order8821PlacedAt: typeof c.order8821PlacedAt === "string" ? c.order8821PlacedAt : null,
              orderTtsWitPlacedAt: typeof c.orderTtsWitPlacedAt === "string" ? c.orderTtsWitPlacedAt : null,
            }));
          }
        }

        if (version < 10) {
          // Thêm field "address" (dùng cho cột Address mới trong bảng Hồ sơ và bảng
          // Order) — chèn cột vào ngay sau "zipcode" cho tài khoản đang dùng, giữ
          // nguyên toàn bộ cột/tùy biến khác, không xóa dữ liệu.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => ({
              ...c,
              address: typeof c.address === "string" ? c.address : "",
            }));
          }
          if (Array.isArray(state.columns) && !state.columns.some((col) => col.id === "address")) {
            const addressCol = DEFAULT_COLUMNS.find((c) => c.id === "address");
            if (addressCol) {
              const zipIdx = state.columns.findIndex((col) => col.id === "zipcode");
              const insertAt = zipIdx === -1 ? state.columns.length : zipIdx + 1;
              state.columns = [
                ...state.columns.slice(0, insertAt),
                addressCol as unknown as Record<string, unknown>,
                ...state.columns.slice(insertAt),
              ];
            }
          }
        }

        if (version < 11) {
          // Thêm cột "Tài khoản đã Order" (order8821By/orderTtsWitBy) trong tab Order —
          // hồ sơ cũ đã đặt order từ trước không xác định lại được ai đã bấm nên để
          // null, không suy đoán sai. Đồng thời mở quyền sửa Address cho TẤT CẢ bộ
          // phận (giống chủ trương chung của các cột khác), ép cập nhật cho tài khoản
          // đang dùng vì đổi hằng số mặc định không tự áp dụng lên dữ liệu đã lưu.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => ({
              ...c,
              order8821By: typeof c.order8821By === "string" ? c.order8821By : null,
              orderTtsWitBy: typeof c.orderTtsWitBy === "string" ? c.orderTtsWitBy : null,
            }));
          }
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) =>
              col.id === "address"
                ? { ...col, editableBy: ["manager", "accounting", "agent", "processor", "support"] }
                : col
            );
          }
        }

        if (version < 12) {
          // Fix lỗi: id các bản ghi mới (tài khoản, hồ sơ...) từng được sinh bằng bộ
          // đếm lưu trong bộ nhớ (module-level), không lưu trữ — bộ đếm này reset về
          // giá trị ban đầu mỗi lần tải lại trang, nên 2 bản ghi tạo ở 2 lần tải trang
          // khác nhau có thể bị sinh TRÙNG id (ví dụ 2 tài khoản khác nhau cùng có id
          // "u-new-1" khiến đăng nhập tài khoản Support lại hiện ra tài khoản Processor
          // do trùng id). Việc sinh id giờ đã đổi sang uniqueId() (không còn bộ đếm) —
          // ở đây chỉ cần dò và tách các id bị trùng đã tồn tại sẵn trong dữ liệu cũ:
          // giữ nguyên id của bản ghi xuất hiện đầu tiên, chỉ đổi id cho (các) bản ghi
          // trùng phía sau, không xóa bất kỳ tài khoản/hồ sơ nào.
          if (Array.isArray(state.users)) {
            const seenUserIds = new Set<string>();
            state.users = state.users.map((u) => {
              const id = String(u.id ?? "");
              if (seenUserIds.has(id)) return { ...u, id: uniqueId("u") };
              seenUserIds.add(id);
              return u;
            });
          }
          if (Array.isArray(state.cases)) {
            const seenCaseIds = new Set<string>();
            state.cases = state.cases.map((c) => {
              const id = String(c.id ?? "");
              if (seenCaseIds.has(id)) return { ...c, id: uniqueId("c") };
              seenCaseIds.add(id);
              return c;
            });
          }
        }

        if (version < 13) {
          // Thêm field "assignedSupport" cho tính năng "Assign" trong tab Order (chỉ
          // gán được cho tài khoản nhóm Support) — hồ sơ cũ chưa gán ai nên để null.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => ({
              ...c,
              assignedSupport: typeof c.assignedSupport === "string" ? c.assignedSupport : null,
            }));
          }
        }

        if (version < 14) {
          // Bản trước từng chèn nhầm cột "Format Name" vào BẢNG HỒ SƠ chính — tính
          // năng này thực ra chỉ nên nằm trong tab Order, không phải bảng Hồ sơ. Dọn
          // lại cột đã lỡ chèn cho các tài khoản đã từng tải qua bản đó.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.filter((col) => col.id !== "formatName");
          }
        }

        if (version < 15) {
          // Thêm quyền riêng "assignSupport" cho cột Assign (giao tài khoản Support)
          // trong tab Order — tài khoản đang dùng chưa có quyền này nên ép mặc định
          // chỉ Admin, giữ nguyên mọi quyền khác đã cấu hình.
          const fp = state.featurePermissions as Record<string, string[]> | undefined;
          if (fp && !Array.isArray(fp.assignSupport)) {
            fp.assignSupport = ["manager"];
          }
        }

        if (version < 16) {
          // Thêm cột "Status" riêng cho tab Order (Done/Pending/Processing, khác với
          // Status ở bảng Hồ sơ) + field orderStatusUpdatedAt cho cột "Ngày thực hiện"
          // (tự ghi lại mốc thời gian mỗi khi Status trong tab Order đổi). Cột này
          // không hiển thị ở bảng Hồ sơ — chỉ chèn định nghĩa cột vào state để có chỗ
          // lưu quyền sửa/xóa (Admin cấu hình qua cùng dialog cài đặt cột như mọi cột
          // khác), không đụng tới dữ liệu case hiện có ngoài việc thêm field mới = null.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => ({
              ...c,
              orderStatus: typeof c.orderStatus === "string" ? c.orderStatus : null,
              orderStatusUpdatedAt: typeof c.orderStatusUpdatedAt === "string" ? c.orderStatusUpdatedAt : null,
            }));
          }
          if (Array.isArray(state.columns) && !state.columns.some((col) => col.id === "orderStatus")) {
            const orderStatusCol = DEFAULT_COLUMNS.find((c) => c.id === "orderStatus");
            if (orderStatusCol) {
              state.columns = [...state.columns, orderStatusCol as unknown as Record<string, unknown>];
            }
          }
        }

        if (version < 17) {
          // Cho phép Support sửa giá trị + thêm lựa chọn mới ở cột Status trong tab
          // Order (trước đây mặc định chỉ Admin) — ép cập nhật cho tài khoản đang dùng
          // vì đổi hằng số mặc định không tự áp dụng lên dữ liệu đã lưu.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) => {
              if (col.id !== "orderStatus") return col;
              const editableBy = Array.isArray(col.editableBy) ? (col.editableBy as string[]) : [];
              return editableBy.includes("support") ? col : { ...col, editableBy: [...editableBy, "support"] };
            });
          }
        }

        if (version < 18) {
          // Chuyển từ mô hình "1 hồ sơ = tối đa 1 order 8821 + 1 order TTS & WIT" (ghi
          // đè mỗi lần đặt lại) sang mô hình LỊCH SỬ: orders[] chứa TẤT CẢ các lần đặt
          // order, mỗi lần là 1 bản ghi độc lập (không ghi đè, không mất order cũ khi
          // đặt lại). Đồng thời tách hẳn Status/Assign của Order 8821 và Order TTS &
          // WIT — trước đây dùng chung 1 field ở cấp hồ sơ, giờ mỗi order có Status/
          // Assign riêng. Dữ liệu order cũ (nếu có) được chuyển nguyên vào bản ghi đầu
          // tiên tương ứng, không mất thông tin.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              if (Array.isArray(rec.orders)) return c;
              const orders: Record<string, unknown>[] = [];
              if (rec.order8821) {
                orders.push({
                  id: uniqueId("ord"),
                  type: "order8821",
                  placedAt: typeof rec.order8821PlacedAt === "string" ? rec.order8821PlacedAt : new Date().toISOString(),
                  placedBy: typeof rec.order8821By === "string" ? rec.order8821By : "",
                  status: typeof rec.orderStatus === "string" ? rec.orderStatus : null,
                  statusUpdatedAt: typeof rec.orderStatusUpdatedAt === "string" ? rec.orderStatusUpdatedAt : null,
                  assignedSupport: typeof rec.assignedSupport === "string" ? rec.assignedSupport : null,
                });
              }
              if (rec.orderTtsWit) {
                orders.push({
                  id: uniqueId("ord"),
                  type: "orderTtsWit",
                  placedAt:
                    typeof rec.orderTtsWitPlacedAt === "string" ? rec.orderTtsWitPlacedAt : new Date().toISOString(),
                  placedBy: typeof rec.orderTtsWitBy === "string" ? rec.orderTtsWitBy : "",
                  status: typeof rec.orderStatus === "string" ? rec.orderStatus : null,
                  statusUpdatedAt: typeof rec.orderStatusUpdatedAt === "string" ? rec.orderStatusUpdatedAt : null,
                  assignedSupport: typeof rec.assignedSupport === "string" ? rec.assignedSupport : null,
                });
              }
              const {
                order8821: _order8821,
                orderTtsWit: _orderTtsWit,
                order8821PlacedAt: _order8821PlacedAt,
                orderTtsWitPlacedAt: _orderTtsWitPlacedAt,
                order8821By: _order8821By,
                orderTtsWitBy: _orderTtsWitBy,
                orderStatus: _orderStatus,
                orderStatusUpdatedAt: _orderStatusUpdatedAt,
                assignedSupport: _assignedSupport,
                ...rest
              } = rec;
              return { ...rest, orders };
            });
          }
        }

        if (version < 19) {
          // Cột Case đổi format từ chuỗi "CASE-xxxx" sang số thuần "xxxx" — chỉ bỏ tiền
          // tố hiển thị, giữ nguyên số thứ tự nên không mất dữ liệu/lịch sử cũ.
          if (Array.isArray(state.cases)) {
            state.cases = state.cases.map((c) => {
              const rec = c as Record<string, unknown>;
              if (typeof rec.caseNumber !== "string") return c;
              return { ...c, caseNumber: rec.caseNumber.replace(/^CASE-/i, "") };
            });
          }
          if (Array.isArray(state.deletionHistory)) {
            state.deletionHistory = state.deletionHistory.map((d) => {
              const snap = d.caseSnapshot as unknown as Record<string, unknown>;
              if (typeof snap.caseNumber !== "string") return d;
              return { ...d, caseSnapshot: { ...d.caseSnapshot, caseNumber: snap.caseNumber.replace(/^CASE-/i, "") } };
            });
          }
          if (Array.isArray(state.editHistory)) {
            state.editHistory = state.editHistory.map((h) =>
              typeof h.caseNumber === "string" ? { ...h, caseNumber: h.caseNumber.replace(/^CASE-/i, "") } : h
            );
          }
        }

        if (version < 20) {
          // Header cột đổi sang chữ in hoa (rộng hơn chữ thường) khiến cột Money bị cắt
          // chữ ("MON…") ở width mặc định cũ (90px) — nới rộng cho các store đã lưu.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) =>
              col.id === "money" && col.width === 90 ? { ...col, width: 104 } : col
            );
          }
        }

        if (version < 21) {
          // Header dịch sang tiếng Việt dài hơn tiếng Anh (vd. "Phone" -> "Số điện
          // thoại", "Case" -> "Mã hồ sơ") khiến bị cắt chữ ở width mặc định cũ — nới
          // rộng cho các store đã lưu.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) => {
              if (col.id === "phone" && col.width === 112) return { ...col, width: 140 };
              if (col.id === "caseNumber" && col.width === 84) return { ...col, width: 104 };
              if (col.id === "zipcode" && col.width === 68) return { ...col, width: 92 };
              return col;
            });
          }
        }

        if (version < 22) {
          // Cột Case đổi text về "Case" (bỏ dịch "Mã hồ sơ") và bóp nhỏ lại vừa đủ, các
          // cột khác thu gọn để nhường chỗ cho cột Description mở rộng — mục tiêu xem
          // được cả bảng trong 1 màn hình, không cần kéo ngang.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) => {
              if (col.id === "clientName" && col.width === 230) return { ...col, width: 170 };
              if (col.id === "ssn" && col.width === 118) return { ...col, width: 84 };
              if (col.id === "zipcode" && col.width === 92) return { ...col, width: 92 };
              if (col.id === "address" && col.width === 180) return { ...col, width: 104 };
              if (col.id === "description" && col.width === 110) return { ...col, width: 150 };
              if (col.id === "caseNumber" && col.width === 104) return { ...col, width: 78 };
              if (col.id === "money" && col.width === 104) return { ...col, width: 100 };
              return col;
            });
          }
        }

        if (version < 23) {
          // Client Name/Agent/Processor bị cắt chữ ("Giao ...", "First na...") — nới
          // rộng vừa đủ để hiện đầy đủ text, đồng thời thu gọn thêm các cột khác
          // (Zip/Address/Description-min/Money/Order) để cả bảng vẫn vừa 1 màn hình.
          if (Array.isArray(state.columns)) {
            state.columns = state.columns.map((col) => {
              if (col.id === "clientName" && col.width === 170) return { ...col, width: 210 };
              if (col.id === "zipcode" && col.width === 92) return { ...col, width: 88 };
              if (col.id === "address" && col.width === 104) return { ...col, width: 90 };
              if (col.id === "description" && col.width === 150) return { ...col, width: 122 };
              if (col.id === "money" && col.width === 100) return { ...col, width: 94 };
              if (col.id === "order" && col.width === 150) return { ...col, width: 122 };
              return col;
            });
          }
        }

        return state as unknown as AppState;
      },
    }
  )
);

export function useCurrentUser() {
  const currentUserId = useAppStore((s) => s.currentUserId);
  const users = useAppStore((s) => s.users);
  return users.find((u) => u.id === currentUserId) ?? null;
}
