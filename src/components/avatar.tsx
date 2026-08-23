export function Avatar({
  name,
  color,
  url,
  size = 36,
}: {
  name: string;
  color: string;
  url?: string | null;
  size?: number;
}) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (url) {
    // avatarUrl luôn là data URI base64 (xem fileToAvatarDataUrl trong avatar-upload.tsx),
    // không phải URL ảnh từ CDN/remote — next/image không tối ưu được gì cho data URI (đã
    // nhúng sẵn trong payload, không có network request riêng để lazy-load/resize), nên giữ
    // <img> thường thay vì đổi sang <Image> chỉ để hết warning.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt={name}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        backgroundImage: `linear-gradient(135deg, ${color}, var(--accent-to))`,
      }}
    >
      {initials}
    </div>
  );
}
