import type { Prisma } from "@prisma/client";
import { ReportsDashboard } from "@/components/admin/reports-dashboard";
import { requireRole } from "@/lib/auth/session";
import { parseDateOnly, toDateInputValue } from "@/lib/dates/calendar";
import { getTodayDateOnly } from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";
import { REPORT_NAMES } from "@/lib/reports/criteria";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams?: Promise<{ q?: string; type?: string; page?: string; start?: string; end?: string; creator?: string }> }) {
  await requireRole("ADMIN");
  const params = await searchParams;
  const query = params?.q?.trim().slice(0, 120) ?? "";
  const selectedType = Object.hasOwn(REPORT_NAMES, params?.type ?? "") ? params!.type! : "";
  const start = parseDateOnly(params?.start), end = parseDateOnly(params?.end);
  const archiveStart = start ? toDateInputValue(start) : "", archiveEnd = end ? toDateInputValue(end) : "";
  const archiveCreator = params?.creator?.trim().slice(0, 120) ?? "";
  const where: Prisma.SavedReportWhereInput = {
    ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { createdBy: { fullName: { contains: query, mode: "insensitive" } } }, { project: { name: { contains: query, mode: "insensitive" } } }] } : {}),
    ...(selectedType ? { reportType: selectedType } : {}), ...(start ? { endDate: { gte: start } } : {}),
    ...(end ? { startDate: { lte: end } } : {}), ...(archiveCreator ? { createdByUserId: archiveCreator } : {}),
  };
  const total = await prisma.savedReport.count({ where });
  const pages = Math.max(1, Math.ceil(total / 25));
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(Number(params?.page)) ? Number(params?.page) : 1));
  const today = getTodayDateOnly();
  const weekStart = new Date(today); weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const [projects, customers, personnel, teams, reports] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true, isActive: true, customer: { select: { name: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ select: { id: true, fullName: true, isActive: true }, orderBy: { fullName: "asc" } }),
    prisma.team.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" } }),
    prisma.savedReport.findMany({ where, select: { id: true, title: true, reportType: true, startDate: true, endDate: true, createdAt: true, createdBy: { select: { fullName: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 25, take: 25 }),
  ]);
  return <main className="p-6 text-navy"><div className="mx-auto max-w-7xl"><header className="mb-6"><h1 className="text-3xl font-semibold">Rapor Merkezi</h1><p className="mt-2 text-muted-foreground">Saha faaliyetlerini, ekip katılımını, ziyaretleri ve kayıt kalitesini kaynak ayrıntılarıyla inceleyin.</p></header>
    <ReportsDashboard projects={projects.map((project) => ({ customerName: project.customer.name, id: project.id, name: project.name, isActive: project.isActive }))}
      customers={customers} personnel={personnel.map((user) => ({ id: user.id, name: `${user.fullName}${user.isActive ? "" : " (pasif)"}` }))}
      teams={teams.map((team) => ({ id: team.id, name: `${team.name}${team.isActive ? "" : " (pasif)"}` }))}
      reports={reports.map((report) => ({ createdAt: report.createdAt.toISOString(), createdBy: report.createdBy.fullName, endDate: report.endDate.toISOString(), id: report.id, reportType: report.reportType, startDate: report.startDate.toISOString(), title: report.title }))}
      today={toDateInputValue(today)} weekStart={toDateInputValue(weekStart)} query={query} selectedType={selectedType} page={page} pages={pages} total={total}
      archiveStart={archiveStart} archiveEnd={archiveEnd} archiveCreator={archiveCreator} />
  </div></main>;
}
