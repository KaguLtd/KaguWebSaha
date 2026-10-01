import type { Prisma } from "@prisma/client";
import { ReportsDashboard } from "@/components/admin/reports-dashboard";
import { requireRole } from "@/lib/auth/session";
import { toDateInputValue } from "@/lib/dates/calendar";
import { getTodayDateOnly } from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";
import { parseSavedReportSnapshot } from "@/lib/reports/snapshot";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams?: Promise<{ q?: string; type?: string; page?: string }> }) {
  await requireRole("ADMIN");
  const params = await searchParams;
  const query = params?.q?.trim().slice(0, 120) ?? "";
  const selectedType = ["PROJECT", "PERSONNEL", "CUSTOMER", "VISIT"].includes(params?.type ?? "") ? params!.type! : "";
  const where: Prisma.SavedReportWhereInput = { ...(query ? { title: { contains: query, mode: "insensitive" } } : {}), ...(selectedType ? { reportType: selectedType } : {}) };
  const total = await prisma.savedReport.count({ where });
  const pages = Math.max(1, Math.ceil(total / 25));
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(Number(params?.page)) ? Number(params?.page) : 1));
  const today = getTodayDateOnly();
  const weekStart = new Date(today); weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const [projects, customers, personnel, teams, reports] = await Promise.all([
    prisma.project.findMany({ include: { customer: { select: { name: true } } }, orderBy: { name: "asc" } }),
    prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ select: { id: true, fullName: true, isActive: true }, orderBy: { fullName: "asc" } }),
    prisma.team.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" } }),
    prisma.savedReport.findMany({ where, include: { createdBy: { select: { fullName: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 25, take: 25 }),
  ]);
  return <main className="p-6 text-navy"><div className="mx-auto max-w-7xl"><header className="mb-6"><h1 className="text-3xl font-semibold">Raporlar</h1><p className="mt-2 text-muted-foreground">Plan, sahaya varış ve ekip beyanını ayrı inceleyin; kayıtlı raporları Excel uyumlu CSV veya yazdırılabilir PDF olarak alın.</p></header><ReportsDashboard projects={projects.map((project) => ({ customerName: project.customer.name, id: project.id, name: project.name, isActive: project.isActive }))} customers={customers} personnel={personnel.map((user) => ({ id: user.id, name: `${user.fullName}${user.isActive ? "" : " (pasif)"}` }))} teams={teams.map((team) => ({ id: team.id, name: `${team.name}${team.isActive ? "" : " (pasif)"}` }))} reports={reports.map((report) => ({ createdAt: report.createdAt.toISOString(), createdBy: report.createdBy.fullName, endDate: report.endDate.toISOString(), id: report.id, reportType: report.reportType, snapshot: parseSavedReportSnapshot(report.snapshot), startDate: report.startDate.toISOString(), title: report.title }))} today={toDateInputValue(today)} weekStart={toDateInputValue(weekStart)} query={query} selectedType={selectedType} page={page} pages={pages} total={total} /></div></main>;
}
