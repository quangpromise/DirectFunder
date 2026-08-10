import { CaseRecord, ColumnDef, DateFormat, Language } from "./types";
import { getAllClientNames } from "./client-name";
import { translateOptionLabel } from "./i18n";
import { formatDateValue, formatDateOfBirth } from "./date-format";

/** id đặc biệt cho trường "Ngày gửi" ảo trong GoogleSheetConfig.columnIds — không tham
 * chiếu ColumnDef thật nào, giá trị luôn là ngày hiện tại lúc bấm Send (không phải dữ
 * liệu hồ sơ). Không trùng id cột thật vì không đứng trong `columns` state. */
export const SEND_DATE_COLUMN_ID = "__send_date__";

/** id đặc biệt cho ô "Để trống" ảo trong GoogleSheetConfig.columnIds — dùng để chừa 1 ô
 * trống giữa các cột khi thứ tự cột trên Sheet thật không khớp liền kề với dữ liệu app
 * đẩy lên. Không cần xử lý riêng ở server: vì id này không tồn tại trong `columns` state,
 * getColumnValue's caller (route send-to-sheet) đã tự trả "" cho mọi id không tìm thấy
 * trong columnById — đúng hành vi mong muốn, chỉ khai báo hằng số ở đây cho rõ ràng. */
export const BLANK_COLUMN_ID = "__blank__";

/** id đặc biệt cho 4 cột ảo "2022"/"2023"/"2024"/"2025" trong GoogleSheetConfig.columnIds
 * — mỗi cột lấy đúng 1 năm trong `row.refunds` (object nhiều năm, không có ColumnDef
 * phẳng riêng cho từng năm — xem refund.ts), không trùng id cột thật vì không đứng trong
 * `columns` state. */
const REFUND_YEAR_COLUMN_PREFIX = "__refund_";
const REFUND_YEAR_COLUMN_SUFFIX = "__";

export function refundYearColumnId(year: string): string {
  return `${REFUND_YEAR_COLUMN_PREFIX}${year}${REFUND_YEAR_COLUMN_SUFFIX}`;
}

function parseRefundYearColumnId(id: string): string | null {
  if (!id.startsWith(REFUND_YEAR_COLUMN_PREFIX) || !id.endsWith(REFUND_YEAR_COLUMN_SUFFIX)) return null;
  return id.slice(REFUND_YEAR_COLUMN_PREFIX.length, -REFUND_YEAR_COLUMN_SUFFIX.length);
}

/** id đặc biệt cho cột ảo "Số tiền CPA Review" trong GoogleSheetConfig.columnIds — KHÁC
 * 4 cột năm cố định ở trên (mỗi cột đó luôn gắn với đúng 1 năm cụ thể); cột này lấy giá
 * trị theo năm được người dùng CHỌN NGAY LÚC BẤM SEND (popup "Bạn muốn CPA Review năm
 * nào?" ở SendToSheetButton) — không cấu hình sẵn năm nào trong GoogleSheetConfig, giá
 * trị phụ thuộc `reviewYear` truyền vào getColumnValue mỗi lần gửi. */
export const CPA_REVIEW_MONEY_COLUMN_ID = "__cpa_review_money__";

/** Đọc giá trị của 1 cột bất kỳ trên 1 hồ sơ — dùng để build dòng dữ liệu đẩy lên Google
 * Sheet (nút "Send" ở cột Status), theo đúng thứ tự cột Admin đã chọn trong
 * GoogleSheetConfig.columnIds. Các field đặc biệt không nằm phẳng trên CaseRecord
 * (clientName gộp 2 client, ssn gộp 2 slot) xử lý riêng theo id; cột custom (kể cả
 * "caseLabel") đọc từ row.custom[col.id]; còn lại fallback rỗng (vd cột "order" dạng
 * object phức tạp, Admin không nên chọn cột này để đẩy lên Sheet). Cột type "date" được
 * format lại theo GoogleSheetConfig.dateFormat (xem date-format.ts) — không đổi giá trị
 * ISO lưu trong DB, chỉ đổi chuỗi ghi vào ô Sheet. Cột tiền trả về NUMBER (không phải
 * string "$1,234") — appendRowToSheet ghi thẳng dạng số, để Google Sheet tự hiển thị theo
 * đúng định dạng số/tiền tệ Ô ĐÓ ĐANG CÓ SẴN (mặc định của chính Sheet), không ép định
 * dạng riêng từ phía app. */
export function getColumnValue(
  row: CaseRecord,
  col: ColumnDef,
  language: Language,
  dateFormat?: DateFormat,
  reviewYears?: string[]
): string | number {
  const refundYear = parseRefundYearColumnId(col.id);
  if (refundYear) {
    // Chỉ lấy dữ liệu năm nào NGƯỜI DÙNG ĐÃ CHỌN ở popup "Bạn muốn CPA Review năm nào?"
    // (SendToSheetButton) — năm không chọn để trống, dù case có refund > 0 năm đó.
    // reviewYears undefined (không qua bước chọn năm) = giữ hành vi cũ, luôn lấy đủ.
    if (reviewYears && !reviewYears.includes(refundYear)) return "";
    const value = row.refunds[refundYear];
    return typeof value === "number" && value > 0 ? value : "";
  }

  if (col.id === CPA_REVIEW_MONEY_COLUMN_ID) {
    const sum = (reviewYears ?? []).reduce((acc, year) => {
      const value = row.refunds[year];
      return typeof value === "number" && value > 0 ? acc + value : acc;
    }, 0);
    return sum > 0 ? sum : "";
  }

  switch (col.id) {
    case "clientName":
      return getAllClientNames(row) || "";
    // Taxpayer (slot 0) luôn ở dòng trên, Spouse (slot 1) ở dòng dưới trong CÙNG 1 ô —
    // xuống dòng bằng "\n" (Google Sheets hiển thị như Alt+Enter, không cần cấu hình
    // thêm). Bỏ dòng nào rỗng, không chèn dòng trống cho slot chưa có dữ liệu.
    case "ssn":
      return row.ssn.filter(Boolean).join("\n");
    // Cùng quy tắc Taxpayer trên/Spouse dưới như ssn/phone. LUÔN format mm/dd/yyyy (4 số
    // năm) — KHÔNG theo GoogleSheetConfig.dateFormat chung (khác cột date tuỳ chỉnh ở
    // nhánh col.custom bên dưới) — không đổi giá trị ISO gốc lưu trong DB.
    case "dateOfBirth":
      return row.dateOfBirth
        .filter((d): d is string => Boolean(d))
        .map((d) => formatDateOfBirth(d))
        .join("\n");
    case "status": {
      const opt = col.options?.find((o) => o.id === row.status);
      return opt ? translateOptionLabel(language, opt.id, opt.label) : row.status;
    }
    // Phone 1 ở dòng trên, Phone 2 (nếu có nhập ở popup Edit Hồ sơ) ở dòng dưới, cùng 1 ô.
    case "phone":
      return [row.phone, row.phone2].filter(Boolean).join("\n");
    case "zipcode":
      return row.zipcode || "";
    case "address":
      return row.address || "";
    case "description":
      return row.description || "";
    case "caseNumber":
      return row.caseNumber || "";
    case "money":
      return row.money;
  }

  if (col.custom) {
    const value = row.custom[col.id];
    if (value === null || value === undefined) return "";
    if (col.type === "date" && typeof value === "string") return formatDateValue(value, dateFormat);
    if (col.type === "currency" && typeof value === "number") return value;
    return String(value);
  }

  return "";
}
