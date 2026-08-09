import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  return NextResponse.json(user);
}
