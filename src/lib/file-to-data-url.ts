/** Đọc 1 file bất kỳ (không riêng ảnh — dùng cho đính kèm email CPA) thành data URL
 * base64 — tách riêng khỏi image.ts vì hàm đó có thêm bước crop/resize canvas chỉ hợp
 * cho ảnh đại diện, không áp dụng được cho file đính kèm loại bất kỳ (pdf, docx...). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Không đọc được file."));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}
