import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { parseDateOnly, toDateInputValue } from "@/lib/dates/calendar";
import { getDateOnlyRangeInAppTimeZone, APP_TIME_ZONE } from "@/lib/dates/today";
import { buildTaskReport } from "@/lib/reports/calculations";
import type { ReportSnapshot, ReportType } from "@/lib/reports/calculations";
import { readProjectVisits } from "@/lib/visits/read";
import { getVisitStatus, getVisitAgeDays } from "@/lib/visits/status";

export const REPORT_NAMES: Record<ReportType, string> = { PROJECT: "Proje Saha Raporu", PERSONNEL: "Personel / Ekip Raporu", CUSTOMER: "Cari Saha Raporu", VISIT: "Ziyaret Raporu" };
export type ReportCriteria = { reportType: ReportType; startDate: Date; endDate: Date; projectId: string; customerId: string; personnelId: string; teamId: string; status: "ALL" | "PLANNED" | "ON_SITE" | "COMPLETED"; workforce: "ALL" | "PERSONNEL" | "CONTRACTOR" | "OBSERVER" | "UNKNOWN"; projectState: "ALL" | "ACTIVE" | "ARCHIVED" };

export function parseReportCriteria(form: FormData): ReportCriteria {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const reportType = text("reportType") as ReportType;
  if (!Object.hasOwn(REPORT_NAMES, reportType)) throw new Error("Geçerli bir rapor tipi seçin.");
  const startDate = parseDateOnly(text("startDate"));
  const endDate = parseDateOnly(text("endDate"));
  if (!startDate || !endDate) throw new Error("Başlangıç ve bitiş tarihleri zorunludur.");
  const status = text("status") || "ALL";
  const workforce = text("workforce") || "ALL";
  const projectState = text("projectState") || "ALL";
  if (!["ALL", "PLANNED", "ON_SITE", "COMPLETED"].includes(status) || !["ALL", "PERSONNEL", "CONTRACTOR", "OBSERVER", "UNKNOWN"].includes(workforce) || !["ALL", "ACTIVE", "ARCHIVED"].includes(projectState)) throw new Error("Rapor filtreleri geçersiz.");
  return { reportType, startDate: startDate <= endDate ? startDate : endDate, endDate: startDate <= endDate ? endDate : startDate, projectId: text("projectId"), customerId: text("customerId"), personnelId: text("personnelId"), teamId: text("teamId"), status: status as ReportCriteria["status"], workforce: workforce as ReportCriteria["workforce"], projectState: projectState as ReportCriteria["projectState"] };
}

export function serializeCriteria(criteria: ReportCriteria) {
  return { reportType: criteria.reportType, startDate: toDateInputValue(criteria.startDate), endDate: toDateInputValue(criteria.endDate), projectId: criteria.projectId, customerId: criteria.customerId, personnelId: criteria.personnelId, teamId: criteria.teamId, status: criteria.status, workforce: criteria.workforce, projectState: criteria.projectState };
}

function projectWhere(criteria: ReportCriteria): Prisma.ProjectWhereInput {
  return { ...(criteria.projectId ? { id: criteria.projectId } : {}), ...(criteria.customerId ? { customerId: criteria.customerId } : {}), ...(criteria.projectState !== "ALL" ? { isActive: criteria.projectState === "ACTIVE" } : {}) };
}

export async function buildReport(criteria: ReportCriteria): Promise<ReportSnapshot> {
  if (criteria.reportType === "VISIT") return withFilterLabels(await buildVisitReport(criteria), criteria);
  const assigneeWhere: Prisma.DailyTaskAssigneeWhereInput = {
    ...(criteria.personnelId ? { userId: criteria.personnelId } : {}),
    ...(criteria.teamId ? { teamId: criteria.teamId } : {}),
    ...(criteria.workforce !== "ALL" ? { workforceKindSnapshot: criteria.workforce === "UNKNOWN" ? null : criteria.workforce } : {}),
  };
  const hasAssigneeFilter = Object.keys(assigneeWhere).length > 0;
  const tasks = await prisma.dailyTask.findMany({
    where: { taskDate: { gte: criteria.startDate, lte: criteria.endDate }, project: projectWhere(criteria), ...(criteria.status !== "ALL" ? { status: criteria.status } : {}), ...(hasAssigneeFilter ? { assignees: { some: assigneeWhere } } : {}) },
    include: { project: { include: { customer: true } }, assignees: { ...(hasAssigneeFilter ? { where: assigneeWhere } : {}), include: { user: { select: { fullName: true, role: true } } } }, _count: { select: { files: true } } },
    orderBy: [{ taskDate: "asc" }, { createdAt: "asc" }], take: 10001,
  });
  if (tasks.length > 10000) throw new Error("Rapor 10.000 görev sınırını aşıyor. Tarih veya proje filtresini daraltın.");
  return withFilterLabels(buildTaskReport(criteria.reportType, tasks, serializeCriteria(criteria)), criteria);
}

async function withFilterLabels(snapshot: ReportSnapshot, criteria: ReportCriteria) {
  const [project, customer, person, team] = await Promise.all([
    criteria.projectId ? prisma.project.findUnique({ where: { id: criteria.projectId }, select: { name: true } }) : null,
    criteria.customerId ? prisma.customer.findUnique({ where: { id: criteria.customerId }, select: { name: true } }) : null,
    criteria.personnelId ? prisma.user.findUnique({ where: { id: criteria.personnelId }, select: { fullName: true } }) : null,
    criteria.teamId ? prisma.team.findUnique({ where: { id: criteria.teamId }, select: { name: true } }) : null,
  ]);
  if (criteria.projectId && !project || criteria.customerId && !customer || criteria.personnelId && !person || criteria.teamId && !team) throw new Error("Filtredeki proje, cari, kullanıcı veya ekip bulunamadı.");
  const statusNames = { ALL: "Tümü", PLANNED: "Planlandı", ON_SITE: "Sahada", COMPLETED: "Tamamlandı" };
  const kindNames = { ALL: "Tümü", PERSONNEL: "Personel", CONTRACTOR: "Taşeron ekip", OBSERVER: "Saha kontrol", UNKNOWN: "Eski / bilinmeyen" };
  snapshot.filterLabels = { ...(project ? { Proje: project.name } : {}), ...(customer ? { Cari: customer.name } : {}), ...(person ? { Kullanıcı: person.fullName } : {}), ...(team ? { Ekip: team.name } : {}), Kapsam: criteria.projectState === "ACTIVE" ? "Aktif projeler" : criteria.projectState === "ARCHIVED" ? "Arşiv projeler" : "Aktif ve arşiv", ...(criteria.reportType !== "VISIT" ? { Durum: statusNames[criteria.status], "İşgücü": kindNames[criteria.workforce] } : {}) };
  return snapshot;
}

async function buildVisitReport(criteria: ReportCriteria): Promise<ReportSnapshot> {
  const start = getDateOnlyRangeInAppTimeZone(criteria.startDate).start;
  const end = getDateOnlyRangeInAppTimeZone(criteria.endDate).end;
  const projects = await prisma.project.findMany({ where: projectWhere(criteria), include: { customer: true }, orderBy: { name: "asc" } });
  const projectIds = projects.map((project) => project.id);
  const visits = await readProjectVisits({ projectIds, ...(criteria.personnelId ? { userId: criteria.personnelId } : {}), start, end });
  if (visits.length > 10000) throw new Error("Rapor 10.000 ziyaret sınırını aşıyor. Tarih veya proje filtresini daraltın.");
  const latest = await readProjectVisits({ projectIds, end, latestPerProject: true });
  const byProject = new Map(latest.map((visit) => [visit.projectId, visit]));
  const reference = new Date(end.getTime() - 1);
  const overdue = projects.filter((project) => project.isActive && project.createdAt < end && ["WARNING", "OVERDUE", "NEVER"].includes(getVisitStatus(byProject.get(project.id)?.visitedAt, reference)));
  return {
    schemaVersion: 2, calculationVersion: "v1.1-1", generatedAt: new Date().toISOString(), filters: serializeCriteria(criteria),
    headers: ["Proje", "Cari", "Ziyaret eden", "Tarih / saat", "Not", "Dosya", "Kaynak"],
    rows: visits.map((visit) => [visit.projectName, visit.customerName, visit.userName, visit.visitedAt.toISOString(), visit.note ?? "—", visit.fileCount ?? "Bilinmiyor", visit.source === "LEGACY" ? "Eski program ziyareti" : "Ziyaret"]),
    rowLinks: visits.map((visit) => ({ href: `/admin/visits/${encodeURIComponent(visit.projectId)}`, label: "Ziyaret geçmişi" })),
    totals: { "Ziyaret": visits.length, "Ziyaret edilen şantiye": new Set(visits.map((visit) => visit.projectId)).size, "16–30 gün": overdue.filter((project) => getVisitStatus(byProject.get(project.id)?.visitedAt, reference) === "WARNING").length, "31+ gün": overdue.filter((project) => getVisitStatus(byProject.get(project.id)?.visitedAt, reference) === "OVERDUE").length, "Hiç ziyaret yok": overdue.filter((project) => !byProject.has(project.id)).length },
    definitions: [`Ziyaret tarihi ve gün sınırları ${APP_TIME_ZONE} saat dilimindedir.`, "Programın eski ziyaret olayları ve yeni ziyaret kayıtları birlikte okunur; yeni ziyaretin timeline karşılığı yeniden sayılmaz.", "Gecikme özeti bitiş gününün sonuna kadar bütün ziyaretleri kullanır; ziyaret eden kişi filtresi yalnız ziyaret listesini süzer.", "Aktif/arşiv kapsamı rapor üretildiği andaki proje durumudur. Bitiş tarihinden sonra oluşturulan projeler gecikme özetine girmez.", "Arşiv projeler gecikme uyarısından çıkarılır. Eski program ziyaretlerinin dosya sayısı kanıtlanamıyorsa bilinmiyor gösterilir."],
    warnings: visits.some((visit) => visit.source === "LEGACY") ? ["Listede tarihsel program ziyaretleri bulunuyor; bu kayıtların dosya sayısı bilinmiyor olabilir."] : [],
    details: { headers: ["Aktif proje / gecikme", "Cari", "Son ziyaret", "Geçen gün", "Durum"], rows: overdue.map((project) => { const visit = byProject.get(project.id); const status = getVisitStatus(visit?.visitedAt, reference); return [project.name, project.customer.name, visit?.visitedAt.toISOString() ?? "Henüz ziyaret edilmedi", visit ? getVisitAgeDays(visit.visitedAt, reference) : "—", status === "WARNING" ? "Turuncu" : status === "OVERDUE" ? "Kırmızı" : "Ziyaret yok"]; }), rowLinks: overdue.map((project) => ({ href: `/admin/visits/${encodeURIComponent(project.id)}`, label: "Ziyaret geçmişi" })) },
  };
}
