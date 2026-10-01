import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

// Legacy browser drafts have no reliable author ID. Only an administrator may
// inspect them for manual recovery; this endpoint never adopts or uploads them.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Oturum süresi doldu." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Eski kayıt kurtarma işlemi yönetici içindir." }, { status: 403 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
