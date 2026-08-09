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
