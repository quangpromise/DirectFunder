import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { splitIrsPdf } from "@/lib/irs-splitter";
import { BlobFetchError, fetchBlobPdfBytes } from "@/lib/irs-splitter/fetch-blob-pdf";
import type { IrsNoticeRecord } from "@/lib/irs-splitter";
import type { FeaturePermissions } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Bước 2: nhận `{blobUrl, fileName, records}` (JSON) -- `blobUrl` trỏ tới ĐÚNG file đã dùng
 * ở bước phân tích (client tự giữ lại từ lúc upload, không upload lại lần 2), `records` là
 * danh sách đã soát/sửa. Tách thành 1 file PDF/record, đóng gói vào 1 file .zip trả về
 * thẳng cho trình duyệt tải xuống, rồi XOÁ blob khỏi Vercel Blob (không cần giữ lại nữa --
 * xem `/api/irs-splitter/blob-upload` cho lý do dùng Blob thay vì FormData trực tiếp).
 */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "useIrsNoticeSplitter", me.role)) {
    return NextResponse.json({ error: "Không có quyền dùng công cụ này" }, { status: 403 });
  }

  const { blobUrl, fileName, records: recordsRaw } = await request.json();

  const parsedRecords: unknown = recordsRaw;
  if (!Array.isArray(parsedRecords) || parsedRecords.length === 0) {
    return NextResponse.json({ error: "Danh sách record rỗng" }, { status: 400 });
  }

  // Sanitize lại từ input client (bảng soát/sửa cho phép gõ tay) — không tin thẳng số
  // trang gửi lên, ép kiểu + validate khoảng hợp lệ trước khi tách.
  const records: IrsNoticeRecord[] = [];
  for (const r of parsedRecords as Record<string, unknown>[]) {
    const startPage = Number(r.startPage);
    const endPage = Number(r.endPage);
    if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage) {
      return NextResponse.json({ error: `Khoảng trang không hợp lệ: ${JSON.stringify(r)}` }, { status: 400 });
    }
    records.push({
      id: typeof r.id === "string" ? r.id : `p${startPage}`,
      startPage,
      endPage,
      pageCount: endPage - startPage + 1,
      noticeType: typeof r.noticeType === "string" && r.noticeType.trim() ? r.noticeType.trim() : null,
      name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : null,
      taxYear: typeof r.taxYear === "string" && r.taxYear.trim() ? r.taxYear.trim() : null,
      hasCareOf: !!r.hasCareOf,
    });
  }

  let bytes: Uint8Array;
  try {
    bytes = await fetchBlobPdfBytes(blobUrl);
  } catch (err) {
    if (err instanceof BlobFetchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  let response: NextResponse;
  try {
    const files = await splitIrsPdf(bytes, records);

    const zip = new JSZip();
    for (const f of files) zip.file(`${f.filename}.pdf`, f.bytes);
    const zipBytes = await zip.generateAsync({ type: "uint8array" });

    const zipName = (typeof fileName === "string" && fileName.replace(/\.pdf$/i, "")) || "notices";
    response = new NextResponse(new Uint8Array(zipBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName} - split.zip"`,
      },
    });
  } catch (err) {
    console.error("[irs-splitter/split]", err);
    return NextResponse.json({ error: "Tách file thất bại (khoảng trang có thể vượt quá số trang file gốc)." }, { status: 400 });
  }

  // Xoá blob ngay sau khi đã tách xong -- không cần giữ lại nữa. Best-effort: lỗi xoá không
  // chặn trả kết quả về cho người dùng (chỉ log lại, tối đa để mồ côi 1 file trên Blob thay
  // vì làm hỏng cả thao tác đã thành công).
  if (typeof blobUrl === "string") {
    try {
      await del(blobUrl);
    } catch (err) {
      console.error("[irs-splitter/split] xoá blob thất bại (không chặn response)", err);
    }
  }

  return response;
}
