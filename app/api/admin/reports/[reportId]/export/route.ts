import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { reportApiUser } from "@/lib/reports/access";
import { snapshotToCsv } from "@/lib/reports/export";
import { snapshotToXlsx } from "@/lib/reports/xlsx";
import { parseSavedReportSnapshot } from "@/lib/reports/snapshot";

export async function GET(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const access = await reportApiUser();
  if (access.response) return access.response;
  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "xlsx") return NextResponse.json({ ok: false, error: "Desteklenmeyen çıktı biçimi." }, { status: 400 });
  const { reportId } = await params;
  const report = await prisma.savedReport.findUnique({ where: { id: reportId }, include: { createdBy: { select: { fullName: true } } } });
  if (!report) return NextResponse.json({ ok: false, error: "Rapor bulunamadı." }, { status: 404 });
  const snapshot = parseSavedReportSnapshot(report.snapshot);
  const context = { reportId: report.id, startDate: report.startDate.toISOString().slice(0, 10), endDate: report.endDate.toISOString().slice(0, 10),
    createdAt: report.createdAt.toISOString(), createdBy: snapshot.metadata?.createdByName ?? report.createdBy.fullName, reportType: report.reportType };
  try {
    const filename = `kagu-rapor-${report.id.replace(/[^a-zA-Z0-9_-]/g, "")}.${format}`;
    const content = format === "xlsx" ? new Uint8Array(snapshotToXlsx(snapshot, report.title, context)) : snapshotToCsv(snapshot, report.title, context);
    return new NextResponse(content, { headers: { "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Rapor çıktısı hazırlanamadı. Excel hücre sınırını aşan uzun notlar için CSV olarak indirin; büyük raporlarda tarih veya proje filtresini daraltın." }, { status: 422 });
  }
}
