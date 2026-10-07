import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { ReportSnapshotContent, formatReportCell } from "@/components/admin/report-snapshot";
import { parseSavedReportSnapshot } from "@/lib/reports/snapshot";
import { PrintReportButton } from "@/components/admin/print-report-button";

export const dynamic = "force-dynamic";

export default async function ReportDetail({ params }: { params: Promise<{ reportId: string }> }) {
  await requireRole("ADMIN");
  const { reportId } = await params;
  const report = await prisma.savedReport.findUnique({ where: { id: reportId }, include: { createdBy: { select: { fullName: true } } } });
  if (!report) notFound();
  const snapshot = parseSavedReportSnapshot(report.snapshot);
  return <main className="p-6 text-navy"><div className="mx-auto max-w-7xl"><div className="report-no-print mb-5 flex flex-wrap items-center gap-4"><Link className="text-sm text-primary underline" href="/admin/reports">Raporlara dön</Link><a className="rounded-md border px-3 py-2 text-sm" href={`/api/admin/reports/${encodeURIComponent(report.id)}/export`}>CSV indir</a><a className="rounded-md border px-3 py-2 text-sm" href={`/api/admin/reports/${encodeURIComponent(report.id)}/export?format=xlsx`}>Excel (XLSX) indir</a><PrintReportButton /></div><article className="kagu-print-report rounded-lg border border-navy/10 bg-white p-5 shadow-card"><h1 className="text-2xl font-semibold">{report.title}</h1><p className="mt-2 text-sm text-muted-foreground">{formatReportCell(report.startDate.toISOString().slice(0, 10))} – {formatReportCell(report.endDate.toISOString().slice(0, 10))} · {snapshot.metadata?.createdByName ?? report.createdBy.fullName} · {formatReportCell(report.createdAt.toISOString())}</p><p className="mt-1 text-xs text-muted-foreground">Rapor kimliği: {report.id}</p><ReportSnapshotContent snapshot={snapshot} /></article></div></main>;
}
