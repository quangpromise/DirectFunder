export interface PageJpegResult {
  /** 1-indexed, khớp số trang trong file PDF gốc. */
  pageIndex: number;
  jpegBase64: string;
}
