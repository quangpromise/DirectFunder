import { sanitizeNotesHtml } from "./rich-text";

/**
 * Cấu trúc dữ liệu nhiều tab cho "My Notes" (thêm 2026-08-24, thay cho 1 ghi chú duy nhất
 * trước đó) — vẫn lưu trong ĐÚNG cột `User.myNotesHtml` cũ (String?, không đổi schema/không
 * cần migration), chỉ đổi NỘI DUNG lưu từ raw HTML sang JSON.stringify(MyNotesData). Isomorphic
 * (dùng chung client lẫn server, xem GET/PATCH /api/me/notes) — không phụ thuộc DOM.
 */
export interface MyNoteTab {
  id: string;
  name: string;
  html: string;
}

export interface MyNotesData {
  tabs: MyNoteTab[];
  activeTabId: string;
}

export const MAX_TAB_NAME_LENGTH = 40;
export const MAX_TABS = 20;

function makeTabId(): string {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultTabName(index: number, language: "vi" | "en"): string {
  return language === "vi" ? `Ghi chú ${index}` : `Note ${index}`;
}

export function createTab(index: number, language: "vi" | "en"): MyNoteTab {
  return { id: makeTabId(), name: defaultTabName(index, language), html: "" };
}

/** Parse chuỗi lưu trong cột `myNotesHtml` thành cấu trúc nhiều tab — tự nhận diện + bọc dữ
 * liệu CŨ (raw HTML 1 ghi chú duy nhất, trước khi có tab, hoặc JSON hỏng/không hợp lệ) thành
 * 1 tab đầu tiên, LUÔN trả về ít nhất 1 tab hợp lệ + `activeTabId` khớp đúng 1 tab có thật. */
export function parseMyNotesData(raw: string | null | undefined, language: "vi" | "en" = "vi"): MyNotesData {
  if (raw && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { tabs?: unknown }).tabs)) {
        const rawTabs = (parsed as { tabs: unknown[] }).tabs;
        const tabs: MyNoteTab[] = rawTabs
          .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
          .map((t, i) => ({
            id: typeof t.id === "string" && t.id ? t.id : makeTabId(),
            name:
              typeof t.name === "string" && t.name.trim()
                ? t.name.trim().slice(0, MAX_TAB_NAME_LENGTH)
                : defaultTabName(i + 1, language),
            html: typeof t.html === "string" ? t.html : "",
          }));
        if (tabs.length > 0) {
          const wantedActive = (parsed as { activeTabId?: unknown }).activeTabId;
          const activeTabId = tabs.some((t) => t.id === wantedActive) ? (wantedActive as string) : tabs[0].id;
          return { tabs, activeTabId };
        }
      }
    } catch {
      // Không parse được JSON -> dữ liệu CŨ (raw HTML trước khi có tab) -> bọc thành 1 tab
      // bên dưới, dùng nguyên `raw` làm nội dung tab đó.
    }
    const legacyTab: MyNoteTab = { id: makeTabId(), name: defaultTabName(1, language), html: raw };
    return { tabs: [legacyTab], activeTabId: legacyTab.id };
  }
  const tab = createTab(1, language);
  return { tabs: [tab], activeTabId: tab.id };
}

export function serializeMyNotesData(data: MyNotesData): string {
  return JSON.stringify(data);
}

/** Dựng lại + sanitize từ payload CLIENT gửi lên (PATCH /api/me/notes) — KHÔNG tin thẳng cấu
 * trúc client gửi: ép kiểu/độ dài tên tab, cắt bớt nếu vượt MAX_TABS, sanitize HTML từng tab
 * riêng lẻ qua `sanitizeNotesHtml` (server là nguồn xử lý chính, client cũng gọi lại hàm này
 * trước khi hiện lại phòng hờ — cùng quy ước với Rules). Luôn trả về cấu trúc hợp lệ, không
 * bao giờ ném lỗi — input rác/thiếu field tự rơi về 1 tab rỗng mặc định. */
export function sanitizeMyNotesData(input: unknown, language: "vi" | "en" = "vi"): MyNotesData {
  if (input && typeof input === "object" && Array.isArray((input as { tabs?: unknown }).tabs)) {
    const rawTabs = (input as { tabs: unknown[] }).tabs.slice(0, MAX_TABS);
    const tabs: MyNoteTab[] = rawTabs
      .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
      .map((t, i) => ({
        id: typeof t.id === "string" && t.id ? t.id : makeTabId(),
        name:
          typeof t.name === "string" && t.name.trim()
            ? t.name.trim().slice(0, MAX_TAB_NAME_LENGTH)
            : defaultTabName(i + 1, language),
        html: sanitizeNotesHtml(typeof t.html === "string" ? t.html : ""),
      }));
    if (tabs.length > 0) {
      const wantedActive = (input as { activeTabId?: unknown }).activeTabId;
      const activeTabId = tabs.some((t) => t.id === wantedActive) ? (wantedActive as string) : tabs[0].id;
      return { tabs, activeTabId };
    }
  }
  const tab = createTab(1, language);
  return { tabs: [tab], activeTabId: tab.id };
}
