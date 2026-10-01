import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { readRecentUploadResults } from "@/lib/uploads/recent-results";

export async function GET() {
  const user = await getCurrentUser();
  const headers = { "Cache-Control": "private, no-store" };
  if (!user) return NextResponse.json({ ok: false, error: "Oturum süresi doldu. Tekrar giriş yapın." }, { status: 401, headers });
  if (user.role !== "PERSONNEL") return NextResponse.json({ ok: false, error: "Bu ekran yalnız personel hesabı içindir." }, { status: 403, headers });
  try {
    return NextResponse.json({ ok: true, userId: user.id, results: await readRecentUploadResults(user) }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "Gönderim sonuçları şu anda okunamadı. Biraz sonra tekrar deneyin." }, { status: 503, headers });
  }
}
