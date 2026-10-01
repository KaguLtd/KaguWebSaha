import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { snapshotToCsv } from "@/lib/reports/export";
import { parseSavedReportSnapshot } from "@/lib/reports/snapshot";

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  await requireRole("ADMIN");
  const { reportId } = await params;
  const report = await prisma.savedReport.findUnique({ where: { id: reportId } });
  if (!report) return NextResponse.json({ error: "Rapor bulunamadı." }, { status: 404 });
  return new NextResponse(snapshotToCsv(parseSavedReportSnapshot(report.snapshot), report.title), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="kagu-rapor-${report.id.replace(/[^a-zA-Z0-9_-]/g, "")}.csv"`, "Cache-Control": "private, no-store" } });
}
