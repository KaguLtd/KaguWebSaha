import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { buildReport, parseReportCriteria, REPORT_NAMES } from "@/lib/reports/build";

export async function POST(request: Request) {
  const user = await requireRole("ADMIN");
  try {
    const form = await request.formData();
    const criteria = parseReportCriteria(form);
    const snapshot = await buildReport(criteria);
    const project = criteria.projectId ? await prisma.project.findUnique({ where: { id: criteria.projectId }, select: { name: true } }) : null;
    if (criteria.projectId && !project) throw new Error("Proje bulunamadı.");
    const title = `${REPORT_NAMES[criteria.reportType]}${project ? ` - ${project.name}` : ""}`;
    if (form.get("operation") === "preview") return NextResponse.json({ ok: true, title, snapshot });
    const saved = await prisma.savedReport.create({ data: { reportType: criteria.reportType, title, startDate: criteria.startDate, endDate: criteria.endDate, projectId: criteria.projectId || null, createdByUserId: user.id, snapshot: snapshot as unknown as Prisma.InputJsonValue } });
    revalidatePath("/admin/reports");
    return NextResponse.json({ id: saved.id, ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rapor kaydedilemedi." }, { status: 400 });
  }
}
