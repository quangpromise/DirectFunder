import PusherClient from "pusher-js";

/**
 * Pusher (client-side) — singleton lazy, chỉ khởi tạo trong browser (không phải SSR) và
 * chỉ khi đã cấu hình NEXT_PUBLIC_PUSHER_KEY/NEXT_PUBLIC_PUSHER_CLUSTER. Auth cho private
 * channel đi qua /api/pusher/auth (POST, dùng session cookie có sẵn — xem route đó).
 * Dùng bởi src/hooks/use-realtime.ts.
 */

let cached: PusherClient | null | undefined;

export function getPusherClient(): PusherClient | null {
  if (typeof window === "undefined") return null;
  if (cached !== undefined) return cached;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  if (!key || !cluster) {
    cached = null;
    return null;
  }
  cached = new PusherClient(key, { cluster, authEndpoint: "/api/pusher/auth" });
  return cached;
}

/** socket_id của kết nối Pusher hiện tại — gắn vào header X-Pusher-Socket-Id của mọi
 * request ghi (xem api-client.ts) để server loại trừ, không bắn lại tín hiệu/thông báo cho
 * chính người vừa thao tác (họ đã tự cập nhật local ngay rồi, không cần nhận qua realtime). */
export function getSocketId(): string | null {
  const pusher = getPusherClient();
  return pusher?.connection.socket_id ?? null;
}
