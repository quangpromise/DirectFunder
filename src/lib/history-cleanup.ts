import { prisma } from "@/lib/prisma";

/** Giữ lịch sử 30 ngày gần nhất — đủ để tra cứu "ai sửa gì gần đây", trong khi chặn 2 bảng
 * `edit_history_entries`/`deleted_row_entries` phình vô hạn (trước đây KHÔNG có cơ chế xoá
 * nào — mỗi lần sửa 1 ô là +1 dòng mãi mãi). `GET /api/history/edits|deletions` tải TOÀN BỘ
 * bảng mỗi lần bất kỳ ai vào dashboard (xem hydrateFromServer trong app-store.ts) — càng ít
 * dòng, payload đó càng nhỏ. */
const RETENTION_DAYS = 30;

/**
 * Xoá mọi dòng `EditHistoryEntry`/`DeletedRowEntry` cũ hơn `RETENTION_DAYS`. Gọi 1 lần/ngày,
 * piggyback trên `cron/blob-cleanup` (cùng lý do các piggyback khác trong repo — gói Vercel
 * Hobby giới hạn số Cron Job, xem comment trong route đó).
 */
export async function cleanupOldHistory(): Promise<{ deletedEdits: number; deletedDeletions: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const [edits, deletions] = await Promise.all([
    prisma.editHistoryEntry.deleteMany({ where: { editedAt: { lt: cutoff } } }),
    prisma.deletedRowEntry.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
  ]);

  return { deletedEdits: edits.count, deletedDeletions: deletions.count };
}
