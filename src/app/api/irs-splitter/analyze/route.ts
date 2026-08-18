import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import { hasFeature } from "@/lib/rbac";
import { analyzeIrsPdf } from "@/lib/irs-splitter";
import type { FeaturePermissions } from "@/lib/types";

// Chạy trên Node runtime (không phải Edge) -- pdfjs-dist/pdf-lib cần Buffer/API Node đầy đủ.
export const runtime = "nodejs";
// File PDF gộp nhiều thư có thể khá lớn (scan nhiều trang) -- nới thời gian xử lý so với
// mặc định 10s (Vercel Hobby)/không giới hạn (route handler local).
export const maxDuration = 60;

/**
 * Bước 1 của công cụ "Notice Splitter": đọc 1 file PDF gộp nhiều thư IRS, trả về danh sách
 * record (khoảng trang + tên/loại thư/tax year/cờ "Not Update CRM" đoán được) để hiện bảng
 * soát/sửa ở client TRƯỚC khi tách file thật -- xem lib/irs-splitter/index.ts. Chưa ghi gì
 * xuống DB/đĩa, chỉ xử lý trong bộ nhớ của request này.
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
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Thiếu file PDF" }, { status: 400 });
  }
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "File phải là PDF" }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { pageCount, records } = await analyzeIrsPdf(bytes);
    return NextResponse.json({ pageCount, records });
  } catch (err) {
    console.error("[irs-splitter/analyze]", err);
    return NextResponse.json({ error: "Không đọc được file PDF (file có thể bị hỏng hoặc không đúng định dạng)." }, { status: 400 });
  }
}
