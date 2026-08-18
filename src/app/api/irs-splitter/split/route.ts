import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { splitIrsPdf } from "@/lib/irs-splitter";
import type { IrsNoticeRecord } from "@/lib/irs-splitter";
import type { FeaturePermissions } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Bước 2: nhận LẠI đúng file PDF gốc (client tự giữ File object từ lúc chọn, gửi lại chứ
 * không lưu tạm ở server giữa 2 bước -- không cần dọn dẹp state) + danh sách record đã soát/
 * sửa ở bước phân tích, tách thành 1 file PDF/record rồi đóng gói vào 1 file .zip trả về
 * thẳng cho trình duyệt tải xuống.
 */
export async function POST(request: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const permissions = config?.featurePermissions as unknown as FeaturePermissions | undefined;
  if (!permissions || !hasFeature(permissions, "useIrsNoticeSplitter", me.role)) {
    return NextResponse.json({ error: "Không có quyền dùng công cụ này" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const recordsRaw = formData.get("records");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Thiếu file PDF" }, { status: 400 });
  }
  if (typeof recordsRaw !== "string") {
    return NextResponse.json({ error: "Thiếu danh sách record" }, { status: 400 });
  }

  let parsedRecords: unknown;
  try {
    parsedRecords = JSON.parse(recordsRaw);
  } catch {
    return NextResponse.json({ error: "Danh sách record không hợp lệ (JSON lỗi)" }, { status: 400 });
  }
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

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const files = await splitIrsPdf(bytes, records);

    const zip = new JSZip();
    for (const f of files) zip.file(`${f.filename}.pdf`, f.bytes);
    const zipBytes = await zip.generateAsync({ type: "uint8array" });

    const zipName = file.name.replace(/\.pdf$/i, "") || "notices";
    return new NextResponse(new Uint8Array(zipBytes), {
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
}
