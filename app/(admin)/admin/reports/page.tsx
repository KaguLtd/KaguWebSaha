import { ReportsDashboard } from "@/components/admin/reports-dashboard";
import { requireRole } from "@/lib/auth/session";
import { toDateInputValue } from "@/lib/dates/calendar";
import { getTodayDateOnly } from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requireRole("ADMIN");
  const today = getTodayDateOnly();
  const weekStart = new Date(today); weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const [projects, reports] = await Promise.all([
    prisma.project.findMany({ where: { isActive: true }, include: { customer: true }, orderBy: { name: "asc" } }),
    prisma.savedReport.findMany({ include: { createdBy: true, project: true }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return <main className="p-6 text-navy"><div className="mx-auto max-w-7xl"><header className="mb-6"><h1 className="text-3xl font-semibold">Raporlar</h1><p className="mt-2 text-muted-foreground">Rapor tipini secin, kriterleri belirleyin ve sonucu kaydedin.</p></header><ReportsDashboard projects={projects.map((project) => ({ customerName: project.customer.name, id: project.id, name: project.name }))} reports={reports.map((report) => ({ createdAt: report.createdAt.toISOString(), createdBy: report.createdBy.fullName, endDate: report.endDate.toISOString(), id: report.id, projectName: report.project?.name ?? null, reportType: report.reportType, snapshot: report.snapshot as never, startDate: report.startDate.toISOString(), title: report.title }))} today={toDateInputValue(today)} weekStart={toDateInputValue(weekStart)} /></div></main>;
}
