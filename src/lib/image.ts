const AVATAR_SIZE = 256;

/**
 * Đọc file ảnh, crop vuông ở giữa + resize về AVATAR_SIZE để ảnh đại diện luôn hiển thị
 * đẹp ở mọi kích thước đặt trong app (avatar nhỏ 22px lẫn avatar lớn), đồng thời tránh
 * lưu ảnh gốc quá nặng vào localStorage.
 */
export function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Không đọc được file ảnh."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("File không phải ảnh hợp lệ."));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Trình duyệt không hỗ trợ xử lý ảnh."));
          return;
        }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
