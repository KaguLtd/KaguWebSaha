import type { Prisma } from "@prisma/client";
import { getDateOnlyRangeInAppTimeZone } from "../dates/today";
import { assignmentWhere, projectWhere } from "./criteria";
import type { ReportCriteria } from "./criteria";
import type { ReportData, ReportMediaJob } from "./model";
import type { VisitRecord } from "../visits/read";
import { ReportError } from "./errors";

export const MAX_REPORT_ROWS = 10_000;
const MAX_SOURCE_TEXT = 2_000_000;
const limit = MAX_REPORT_ROWS + 1;
function bounded<T>(rows: T[], label: string): T[] {
  if (rows.length > MAX_REPORT_ROWS) throw new ReportError(`${label} 10.000 kayıt sınırını aşıyor. Tarih veya proje filtresini daraltın.`);
  return rows;
}

/** Reporting projections never invoke operational readers, workers or writes. */
export async function readReportData(criteria: ReportCriteria, db: Prisma.TransactionClient): Promise<ReportData> {
  const start = getDateOnlyRangeInAppTimeZone(criteria.startDate).start;
  const end = getDateOnlyRangeInAppTimeZone(criteria.endDate).end;
  const period = { gte: start, lt: end };
  const assignment = assignmentWhere(criteria);
  const hasAssignment = Object.keys(assignment).length > 0;
  const taskOnly = Boolean(criteria.teamId || criteria.workforce !== "ALL" || criteria.status !== "ALL");
  const visitSelect = { id: true, projectId: true, visitedByUserId: true, visitedAt: true, note: true,
    visitedBy: { select: { fullName: true } }, _count: { select: { files: true } } } satisfies Prisma.ProjectVisitSelect;
  const legacySelect = { id: true, projectId: true, userId: true, createdAt: true, description: true,
    user: { select: { fullName: true } } } satisfies Prisma.ProjectTimelineEventSelect;
  const projects = bounded(await db.project.findMany({
    where: { ...projectWhere(criteria), createdAt: { lt: end } },
    select: { id: true, name: true, city: true, description: true, isActive: true, createdAt: true,
      customer: { select: { id: true, name: true } },
      visits: { where: { visitedAt: { lt: end } }, orderBy: [{ visitedAt: "desc" }, { id: "desc" }], take: 1, select: visitSelect },
      timelineEvents: { where: { eventType: "SITE_VISITED", projectVisitId: null, createdAt: { lt: end } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: legacySelect },
    }, orderBy: [{ name: "asc" }, { id: "asc" }], take: limit,
  }), "Proje kapsamı");
  const projectIds = projects.map((project) => project.id);
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  if (!projectIds.length) return { projects: [], tasks: [], activity: [], notes: [], files: [], siteEvents: [], visits: [], latestVisits: [], mediaJobs: [], warnings: [], visitsAvailable: !taskOnly };
  const projectFilter = { in: projectIds };
  const taskRows = criteria.reportType === "VISIT" ? [] : bounded(await db.dailyTask.findMany({
    where: { projectId: projectFilter, taskDate: { gte: criteria.startDate, lte: criteria.endDate },
      ...(criteria.status !== "ALL" ? { status: criteria.status } : {}), ...(hasAssignment ? { assignees: { some: assignment } } : {}) },
    select: { id: true, projectId: true, title: true, managerNote: true, taskDate: true, status: true,
      arrivedAt: true, leftAt: true, durationMinutes: true,
      project: { select: { name: true, customer: { select: { id: true, name: true } } } },
      _count: { select: { files: true } },
    }, orderBy: [{ taskDate: "asc" }, { id: "asc" }], take: limit,
  }), "Görev raporu");
  const taskIds = taskRows.map((task) => task.id);
  const assignments = !taskIds.length ? [] : bounded(await db.dailyTaskAssignee.findMany({
    where: { dailyTaskId: { in: taskIds }, ...assignment },
    select: { id: true, dailyTaskId: true, userId: true, teamId: true, teamNameSnapshot: true, headcountSnapshot: true,
      actualHeadcount: true, workforceKindSnapshot: true, user: { select: { fullName: true, role: true } } },
    orderBy: [{ dailyTaskId: "asc" }, { id: "asc" }], take: limit,
  }), "Atama ayrıntısı");
  const assignmentMap = new Map<string, typeof assignments>();
  for (const item of assignments) {
    const group = assignmentMap.get(item.dailyTaskId) ?? [];
    group.push(item); assignmentMap.set(item.dailyTaskId, group);
  }
  const tasks = taskRows.map((task) => ({ ...task, assignees: assignmentMap.get(task.id) ?? [] }));
  const actorIds = [...new Set(tasks.flatMap((task) => task.assignees.map((item) => item.userId)))];
  const author = criteria.personnelId ? { equals: criteria.personnelId } : hasAssignment ? { in: actorIds } : undefined;
  const taskContext = { dailyTaskId: { in: taskIds } };
  const contextOrPeriod = taskOnly ? taskContext : { OR: [taskContext, { createdAt: period }] };
  const visits = taskOnly ? [] : bounded(await db.projectVisit.findMany({
    where: { projectId: projectFilter, visitedAt: period, ...(criteria.personnelId ? { visitedByUserId: criteria.personnelId } : {}) },
    select: visitSelect, orderBy: [{ visitedAt: "asc" }, { id: "asc" }], take: limit,
  }), "Ziyaret raporu");
  const legacy = taskOnly ? [] : bounded(await db.projectTimelineEvent.findMany({
    where: { projectId: projectFilter, eventType: "SITE_VISITED", projectVisitId: null, createdAt: period,
      ...(criteria.personnelId ? { userId: criteria.personnelId } : {}) },
    select: legacySelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit,
  }), "Eski ziyaret raporu");
  const visitIds = visits.map((visit) => visit.id);
  const activityContext = criteria.reportType === "VISIT"
    ? { OR: [{ projectVisitId: { in: visitIds } }, { eventType: "SITE_VISITED" as const, projectVisitId: null, createdAt: period, ...(criteria.personnelId ? { userId: criteria.personnelId } : {}) }] }
    : contextOrPeriod;
  // A visit-author filter selects visits, including attachments added by an admin.
  const contributionAuthor = criteria.reportType === "VISIT" ? undefined : author;
  const [activityRows, noteRows, fileRows, eventRows] = await Promise.all([
    db.projectTimelineEvent.findMany({ where: { projectId: projectFilter, ...activityContext, ...(contributionAuthor ? { userId: contributionAuthor } : {}) },
      select: { id: true, projectId: true, dailyTaskId: true, projectVisitId: true, userId: true, eventType: true,
        title: true, description: true, createdAt: true, user: { select: { fullName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit }),
    taskOnly || criteria.reportType === "VISIT" ? [] : db.projectNote.findMany({
      where: { projectId: projectFilter, createdAt: period, ...(author ? { userId: author } : {}) },
      select: { id: true, projectId: true, userId: true, note: true, createdAt: true, user: { select: { fullName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit }),
    db.projectFile.findMany({ where: { projectId: projectFilter,
      ...(criteria.reportType === "VISIT" ? { projectVisitId: { in: visitIds } }
        : criteria.reportType === "MEDIA" && !taskOnly ? { createdAt: period } : contextOrPeriod),
      ...(contributionAuthor ? { uploadedByUserId: contributionAuthor } : {}) },
      select: { id: true, projectId: true, dailyTaskId: true, projectVisitId: true, uploadedByUserId: true,
        originalName: true, mimeType: true, sizeBytes: true, note: true, createdAt: true, uploadedBy: { select: { fullName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit }),
    !taskIds.length ? [] : db.taskEvent.findMany({
      where: { dailyTaskId: { in: taskIds }, type: { in: ["ARRIVED_SITE", "LEFT_SITE"] }, ...(author ? { userId: author } : {}) },
      select: { id: true, projectId: true, dailyTaskId: true, userId: true, type: true, createdAt: true,
        latitude: true, longitude: true, user: { select: { fullName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit }),
  ]);
  bounded(activityRows, "Olay ayrıntısı"); bounded(noteRows, "Proje not arşivi"); bounded(fileRows, "Dosya envanteri"); bounded(eventRows, "Saha olayı ayrıntısı");
  const toVisit = (visit: typeof visits[number]): VisitRecord => ({ id: visit.id, source: "VISIT", projectId: visit.projectId,
    projectName: projectMap.get(visit.projectId)!.name, customerName: projectMap.get(visit.projectId)!.customer.name,
    userId: visit.visitedByUserId, userName: visit.visitedBy.fullName, visitedAt: visit.visitedAt, note: visit.note, fileCount: visit._count.files });
  const toLegacy = (visit: typeof legacy[number]): VisitRecord => ({ id: visit.id, source: "LEGACY", projectId: visit.projectId,
    projectName: projectMap.get(visit.projectId)!.name, customerName: projectMap.get(visit.projectId)!.customer.name,
    userId: visit.userId, userName: visit.user?.fullName ?? "Eski kayıt", visitedAt: visit.createdAt, note: visit.description, fileCount: null });
  const latestVisits: VisitRecord[] = [];
  for (const project of projects) {
    const candidates = [...project.visits.map(toVisit), ...project.timelineEvents.map(toLegacy)].sort((a, b) => b.visitedAt.getTime() - a.visitedAt.getTime() || b.id.localeCompare(a.id));
    if (candidates[0]) latestVisits.push(candidates[0]);
  }
  const allVisits = bounded([...visits.map(toVisit), ...legacy.map(toLegacy)].sort((a, b) => a.visitedAt.getTime() - b.visitedAt.getTime() || a.id.localeCompare(b.id)), "Birleşik ziyaret raporu");
  let mediaJobs: ReportMediaJob[] = [];
  if (["MEDIA", "QUALITY", "OPERATIONS"].includes(criteria.reportType)) {
    const jobContext = taskOnly ? taskContext : { OR: [taskContext, { createdAt: period }] };
    const [uploads, heic, thumbnails] = await Promise.all([
      db.uploadSession.findMany({ where: { projectId: projectFilter, ...jobContext, status: { in: ["OPEN", "PROCESSING"] }, ...(author ? { uploadedByUserId: author } : {}) },
        select: { id: true, projectId: true, status: true, createdAt: true, updatedAt: true }, orderBy: { id: "asc" }, take: limit }),
      db.heicConversionJob.findMany({ where: { projectId: projectFilter, ...jobContext, status: { in: ["PENDING", "PROCESSING", "FAILED"] }, ...(author ? { uploadedByUserId: author } : {}) },
        select: { id: true, projectId: true, status: true, createdAt: true, updatedAt: true }, orderBy: { id: "asc" }, take: limit }),
      db.imageThumbnailJob.findMany({ where: { projectFileId: { in: fileRows.map((file) => file.id) }, status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
        select: { id: true, status: true, createdAt: true, updatedAt: true, projectFile: { select: { projectId: true } } }, orderBy: { id: "asc" }, take: limit }),
    ]);
    mediaJobs = bounded([...bounded(uploads, "Aktarım durumu").map((job) => ({ ...job, kind: "UPLOAD" as const })),
      ...bounded(heic, "HEIC durumu").map((job) => ({ ...job, kind: "HEIC" as const })),
      ...bounded(thumbnails, "Önizleme durumu").map(({ projectFile, ...job }) => ({ ...job, projectId: projectFile.projectId, kind: "THUMBNAIL" as const }))], "Medya iş durumu");
  }
  const taskSet = new Set(taskIds);
  const data: ReportData = {
    projects: projects.map((project) => ({ id: project.id, name: project.name, city: project.city, description: project.description, isActive: project.isActive, createdAt: project.createdAt, customer: project.customer })), tasks,
    activity: activityRows.map(({ user, ...event }) => ({ ...event, userName: user?.fullName ?? "Sistem / eski kayıt" })),
    notes: noteRows.map(({ user, ...note }) => ({ ...note, userName: user.fullName })),
    files: fileRows.map(({ uploadedBy, sizeBytes, ...file }) => ({ ...file, sizeBytes: Number(sizeBytes), userName: uploadedBy.fullName, scope: file.dailyTaskId && taskSet.has(file.dailyTaskId) ? "TASK" : "PERIOD" })),
    siteEvents: eventRows.map(({ user, latitude, longitude, ...event }) => ({ ...event, userName: user.fullName, hasLocation: latitude !== null && longitude !== null })),
    visits: allVisits, latestVisits, mediaJobs, visitsAvailable: !taskOnly,
    warnings: [
      ...(taskOnly ? ["Görev durumu veya ekip/işgücü filtresi nedeniyle görev dışı faaliyet ve ziyaret listesi bu rapora alınmadı. Görev ayrıntıları seçilen atamalara aittir."] : []),
      ...(hasAssignment && !["VISIT", "MEDIA"].includes(criteria.reportType) ? ["Not, olay ve dosya ayrıntıları seçilen kullanıcı veya ekip temsilcisinin kaydettiği katkılardır; görevdeki toplam ek sayısı bütün yükleyenleri kapsar."] : []),
    ],
  };
  const length = (...values: Array<string | null | undefined>) => values.reduce<number>((sum, value) => sum + (value?.length ?? 0), 0);
  const textSize = data.activity.reduce((sum, row) => sum + length(row.title, row.description, row.userName), 0)
    + data.notes.reduce((sum, row) => sum + length(row.note, row.userName), 0)
    + data.tasks.reduce((sum, row) => sum + length(row.title, row.managerNote), 0)
    + assignments.reduce((sum, row) => sum + length(row.teamNameSnapshot, row.user.fullName), 0)
    + data.projects.reduce((sum, row) => sum + length(row.name, row.city, row.description, row.customer.name), 0)
    + data.files.reduce((sum, row) => sum + length(row.note, row.originalName, row.mimeType, row.userName), 0)
    + [...data.visits, ...data.latestVisits].reduce((sum, row) => sum + length(row.note, row.userName), 0);
  if (textSize > MAX_SOURCE_TEXT) throw new ReportError("Rapor not içeriği sınırını aşıyor. Tarih veya proje filtresini daraltın; kayıtlar kırpılmadı.");
  return data;
}
