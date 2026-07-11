import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { parseDateOnly } from "@/lib/dates/calendar";
import { getDateOnlyRangeInAppTimeZone } from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";

const reportNames = {
  PROJECT: "Proje Saha Raporu",
  PERSONNEL: "Personel Gorev Raporu",
  CUSTOMER: "Cari Yogunluk Raporu",
  VISIT: "Ziyaret Raporu",
} as const;

export async function POST(request: Request) {
  const user = await requireRole("ADMIN");
  try {
    const formData = await request.formData();
    const reportType = String(formData.get("reportType") ?? "") as keyof typeof reportNames;
    const startDate = parseDateOnly(String(formData.get("startDate") ?? ""));
    const endDate = parseDateOnly(String(formData.get("endDate") ?? ""));
    const projectId = String(formData.get("projectId") ?? "").trim() || null;
    if (!reportNames[reportType] || !startDate || !endDate) throw new Error("Rapor tipi ve tarih araligi zorunludur.");

    const firstDate = startDate <= endDate ? startDate : endDate;
    const lastDate = startDate <= endDate ? endDate : startDate;
    const project = projectId ? await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } }) : null;
    if (projectId && !project) throw new Error("Proje bulunamadi.");

    const snapshot = reportType === "VISIT"
      ? await buildVisitSnapshot(firstDate, lastDate, projectId)
      : await buildTaskSnapshot(reportType, firstDate, lastDate, projectId);

    const saved = await prisma.savedReport.create({
      data: {
        reportType,
        title: `${reportNames[reportType]}${project ? ` - ${project.name}` : ""}`,
        startDate: firstDate,
        endDate: lastDate,
        projectId,
        createdByUserId: user.id,
        snapshot,
      },
    });
    revalidatePath("/admin/reports");
    return NextResponse.json({ id: saved.id, ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rapor kaydedilemedi." }, { status: 400 });
  }
}

async function buildTaskSnapshot(type: "PROJECT" | "PERSONNEL" | "CUSTOMER", startDate: Date, endDate: Date, projectId: string | null) {
  const tasks = await prisma.dailyTask.findMany({
    where: { taskDate: { gte: startDate, lte: endDate }, ...(projectId ? { projectId } : {}) },
    include: { assignees: { include: { user: true } }, project: { include: { customer: true } } },
    orderBy: [{ taskDate: "asc" }, { createdAt: "asc" }],
  });
  if (type === "PERSONNEL") {
    const grouped = new Map<string, { name: string; tasks: number; completed: number; projects: Set<string> }>();
    for (const task of tasks) for (const assignee of task.assignees) {
      const row = grouped.get(assignee.userId) ?? { name: assignee.user.fullName, tasks: 0, completed: 0, projects: new Set<string>() };
      row.tasks += 1; row.completed += task.status === "COMPLETED" ? 1 : 0; row.projects.add(task.projectId); grouped.set(assignee.userId, row);
    }
    return { headers: ["Personel", "Gorev", "Proje", "Tamamlanan"], rows: Array.from(grouped.values()).map((row) => [row.name, row.tasks, row.projects.size, row.completed]), totals: { gorev: tasks.length } };
  }
  if (type === "CUSTOMER") {
    const grouped = new Map<string, { name: string; tasks: number; people: number; projects: Set<string> }>();
    for (const task of tasks) { const customer = task.project.customer; const row = grouped.get(customer.id) ?? { name: customer.name, tasks: 0, people: 0, projects: new Set<string>() }; row.tasks += 1; row.people += task.assignees.length; row.projects.add(task.projectId); grouped.set(customer.id, row); }
    return { headers: ["Cari", "Proje", "Saha gunu", "Adam-gun"], rows: Array.from(grouped.values()).map((row) => [row.name, row.projects.size, row.tasks, row.people]), totals: { gorev: tasks.length } };
  }
  const grouped = new Map<string, { name: string; customer: string; tasks: number; completed: number; people: number }>();
  for (const task of tasks) { const row = grouped.get(task.projectId) ?? { name: task.project.name, customer: task.project.customer.name, tasks: 0, completed: 0, people: 0 }; row.tasks += 1; row.completed += task.status === "COMPLETED" ? 1 : 0; row.people += task.assignees.length; grouped.set(task.projectId, row); }
  return { headers: ["Proje", "Cari", "Saha gunu", "Tamamlanan", "Adam-gun"], rows: Array.from(grouped.values()).map((row) => [row.name, row.customer, row.tasks, row.completed, row.people]), totals: { gorev: tasks.length } };
}

async function buildVisitSnapshot(startDate: Date, endDate: Date, projectId: string | null) {
  const start = getDateOnlyRangeInAppTimeZone(startDate).start;
  const end = getDateOnlyRangeInAppTimeZone(endDate).end;
  const visits = await prisma.projectVisit.findMany({ where: { visitedAt: { gte: start, lt: end }, ...(projectId ? { projectId } : {}) }, include: { files: true, project: { include: { customer: true } }, visitedBy: true }, orderBy: { visitedAt: "desc" } });
  return { headers: ["Proje", "Cari", "Ziyaret eden", "Tarih", "Not", "Dosya"], rows: visits.map((visit) => [visit.project.name, visit.project.customer.name, visit.visitedBy.fullName, visit.visitedAt.toISOString(), visit.note ? "Var" : "Yok", visit.files.length]), totals: { ziyaret: visits.length } };
}
