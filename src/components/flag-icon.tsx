/**
 * Cờ Việt Nam/Anh vẽ bằng SVG thuần — KHÔNG dùng emoji cờ (🇻🇳/🇬🇧) vì nhiều máy Windows
 * thiếu font glyph cho regional indicator, hiển thị fallback thành chữ "VN"/"GB" thay vì
 * hình lá cờ thật (đúng lỗi user báo — "hiển thị theo lá cờ" nghĩa là hiện SAI hiện tại).
 */
export function FlagVN({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
      <rect width="30" height="20" fill="#DA251D" />
      <polygon points="15,3 11.13,15.62 21.82,7.88 8.18,7.88 18.87,15.62" fill="#FFCD00" />
    </svg>
  );
}

export function FlagGB({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 30" className={className} aria-hidden="true">
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="2" />
      <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}
