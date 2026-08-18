export interface CompressResult {
  bytes: Uint8Array;
  pageCount: number;
  /** true nếu đã chạm sàn chất lượng/DPI mà vẫn không xuống được dưới ngưỡng mục tiêu (file
   * quá nhiều trang/quá nặng) -- vẫn trả về kết quả tốt nhất có được, KHÔNG lỗi cứng. */
  hitFloor: boolean;
  finalDpi: number;
}
