/** 1 "record" = 1 khoảng trang liên tiếp trong file PDF gộp, tương ứng đúng 1 thư IRS gửi
 * cho đúng 1 khách hàng — xem detect-records.ts cho logic nhận diện ranh giới. */
export interface IrsNoticeRecord {
  /** Id nội bộ dùng để so sánh 2 trang có cùng 1 record hay không lúc quét (mã hồ sơ IRS
   * đọc được, hoặc "p{trang}" nếu không đọc được) — KHÔNG phải id nghiệp vụ, không hiển thị. */
  id: string;
  /** 1-indexed, bao gồm cả 2 đầu. */
  startPage: number;
  endPage: number;
  pageCount: number;
  noticeType: string | null;
  name: string | null;
  taxYear: string | null;
  /** true nếu thư còn gửi qua địa chỉ văn phòng (c/o) thay vì thẳng tới khách hàng. */
  hasCareOf: boolean;
}

export interface DetectOptions {
  officeStreet?: string;
  officeCity?: string;
  officeState?: string;
  officeZipPrefix?: string;
  careOfSearchWindow?: number;
  idAfterAddressWindow?: number;
}

export interface FilenameOptions {
  template?: string;
  unknownNoticeType?: string;
  unknownTaxYear?: string;
  unknownName?: string;
  careOfSuffix?: string;
}

export interface SplitResultFile {
  filename: string;
  bytes: Uint8Array;
  record: IrsNoticeRecord;
}
