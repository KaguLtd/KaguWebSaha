import { prisma } from "@/lib/db/prisma";

export type VisitRecord = {
  id: string;
  source: "VISIT" | "LEGACY";
  projectId: string;
  projectName: string;
  customerName: string;
  userId: string | null;
  userName: string;
  visitedAt: Date;
  note: string | null;
  fileCount: number | null;
};

export type VisitReadOptions = {
  projectId?: string;
  projectIds?: string[];
  userId?: string;
  start?: Date;
  end?: Date;
  activeOnly?: boolean;
  latestPerProject?: boolean;
};

// The timeline counterpart of a ProjectVisit must never count as another visit.
// Old schedule visits have no projectVisitId and remain readable without rewriting history.
export async function readProjectVisits(
  options: VisitReadOptions = {},
  database: Pick<typeof prisma, "projectVisit" | "projectTimelineEvent"> = prisma,
): Promise<VisitRecord[]> {
  if (options.projectIds?.length === 0) return [];
  const projectId = options.projectId ?? (options.projectIds ? { in: options.projectIds } : undefined);
  const dateRange = options.start || options.end
    ? { ...(options.start ? { gte: options.start } : {}), ...(options.end ? { lt: options.end } : {}) }
    : undefined;
  const project = options.activeOnly ? { isActive: true } : undefined;
  const [visits, legacy] = await Promise.all([
    database.projectVisit.findMany({
      where: { projectId, project, visitedByUserId: options.userId, visitedAt: dateRange },
      include: { project: { include: { customer: true } }, visitedBy: { select: { fullName: true } }, _count: { select: { files: true } } },
      orderBy: [{ visitedAt: "desc" }, { id: "desc" }],
      ...(options.latestPerProject ? { distinct: ["projectId" as const] } : {}),
    }),
    database.projectTimelineEvent.findMany({
      where: { projectId, project, userId: options.userId, createdAt: dateRange, eventType: "SITE_VISITED", projectVisitId: null },
      include: { project: { include: { customer: true } }, user: { select: { fullName: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(options.latestPerProject ? { distinct: ["projectId" as const] } : {}),
    }),
  ]);
  const records: VisitRecord[] = [
    ...visits.map((visit) => ({
      id: visit.id, source: "VISIT" as const, projectId: visit.projectId,
      projectName: visit.project.name, customerName: visit.project.customer.name,
      userId: visit.visitedByUserId, userName: visit.visitedBy.fullName,
      visitedAt: visit.visitedAt, note: visit.note, fileCount: visit._count.files,
    })),
    ...legacy.map((visit) => ({
      id: visit.id, source: "LEGACY" as const, projectId: visit.projectId,
      projectName: visit.project.name, customerName: visit.project.customer.name,
      userId: visit.userId, userName: visit.user?.fullName ?? "Eski kayıt",
      visitedAt: visit.createdAt, note: visit.description,
      fileCount: null,
    })),
  ].sort((a, b) => b.visitedAt.getTime() - a.visitedAt.getTime() || b.id.localeCompare(a.id));
  if (!options.latestPerProject) return records;
  return Array.from(new Map(records.slice().reverse().map((visit) => [visit.projectId, visit])).values())
    .sort((a, b) => b.visitedAt.getTime() - a.visitedAt.getTime());
}

export async function readLatestProjectVisits(projectIds: string[]) {
  const visits = await readProjectVisits({ projectIds, latestPerProject: true });
  return new Map(visits.map((visit) => [visit.projectId, visit]));
}
