import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { reportApiUser } from "@/lib/reports/access";
import { assertReportSize, buildReport, parseReportCriteria, REPORT_NAMES } from "@/lib/reports/build";
import { reportFingerprint } from "@/lib/reports/fingerprint";
import { ReportError } from "@/lib/reports/errors";

export async function POST(request: Request) {
  const access = await reportApiUser();
  if (access.response) return access.response;
  const user = access.user!;
  if (process.env.REPORTS_NEW_GENERATION_DISABLED === "true") return NextResponse.json({ ok: false, error: "Yeni rapor üretimi geçici olarak kapalı. Kaydedilmiş raporları açabilirsiniz." }, { status: 503 });
  try {
    const form = await request.formData();
    const operation = form.get("operation");
    if (operation !== "preview" && operation !== "save") return NextResponse.json({ ok: false, error: "Önizle veya kaydet işlemi seçin." }, { status: 400 });
    const expected = String(form.get("previewFingerprint") ?? "");
    if (operation === "save" && !/^[a-f0-9]{64}$/.test(expected)) return NextResponse.json({ ok: false, error: "Kaydetmeden önce raporu önizleyin." }, { status: 400 });
    const criteria = parseReportCriteria(form);
    const snapshot = await buildReport(criteria);
    const title = `${REPORT_NAMES[criteria.reportType]}${snapshot.filterLabels?.Proje ? ` - ${snapshot.filterLabels.Proje}` : ""}`;
    const fingerprint = reportFingerprint(snapshot);
    if (operation === "preview") return NextResponse.json({ ok: true, title, snapshot, fingerprint });
    if (fingerprint !== expected) return NextResponse.json({ ok: false, error: "Önizlemeden sonra rapor verisi değişti. Güncel sonucu inceleyip yeniden kaydedin.", title, snapshot, fingerprint }, { status: 409 });
    const id = randomUUID();
    snapshot.metadata = { ...snapshot.metadata!, reportId: id, title, createdByUserId: user.id, createdByName: user.fullName };
    assertReportSize(snapshot);
    const saved = await prisma.savedReport.create({ data: { id, reportType: criteria.reportType, title,
      startDate: criteria.startDate, endDate: criteria.endDate, projectId: criteria.projectId || null,
      createdByUserId: user.id, snapshot: snapshot as unknown as Prisma.InputJsonValue }, select: { id: true } });
    // The save already succeeded even if an optional UI cache refresh fails.
    try { revalidatePath("/admin/reports"); } catch { /* The client can refresh later. */ }
    return NextResponse.json({ id: saved.id, ok: true });
  } catch (error) {
    const known = error instanceof ReportError;
    return NextResponse.json({ ok: false, error: known ? error.message : "Rapor verisi şu anda okunamadı. Yeniden deneyin." }, { status: known ? 400 : 503 });
  }
}
