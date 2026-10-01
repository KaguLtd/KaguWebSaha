import type { Prisma, UserRole } from "@prisma/client";
import { getTodayDateOnly } from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";

export type FileAccessUser = { id: string; role: UserRole };
type FileAccessRecord = {
  projectId: string;
  uploadedByUserId: string;
  dailyTaskId: string | null;
  project: { isActive: boolean; dailyTasks: { id: string }[] };
  dailyTask: { id: string; projectId: string; taskDate: Date; assignees: { userId: string }[] } | null;
};

export function canReadProjectFile(user: FileAccessUser, file: FileAccessRecord, today = getTodayDateOnly()) {
  if (user.role === "ADMIN") return true;
  if (user.role === "OBSERVER") return file.project.isActive;
  if (user.role !== "PERSONNEL") return false;
  // Preserve existing project-wide reads while assigned to that project today.
  if (file.project.dailyTasks.length > 0) return true;
  const task = file.dailyTask;
  // Historical access grants only this person's exact task file, never the project.
  return file.project.isActive && file.uploadedByUserId === user.id &&
    Boolean(file.dailyTaskId && task && task.id === file.dailyTaskId &&
      task.projectId === file.projectId && task.taskDate < today &&
      task.assignees.some((assignment) => assignment.userId === user.id));
}

export function projectFileAccessInclude(userId: string, today = getTodayDateOnly()) {
  return {
      project: {
        select: {
          isActive: true,
          dailyTasks: { where: { taskDate: today, assignees: { some: { userId } } }, select: { id: true }, take: 1 },
        },
      },
      dailyTask: { select: { id: true, projectId: true, taskDate: true, assignees: { where: { userId }, select: { userId: true } } } },
  } satisfies Prisma.ProjectFileInclude;
}

export async function readProjectFileForAccess(fileId: string, user: FileAccessUser, client = prisma, today = getTodayDateOnly()) {
  return client.projectFile.findUnique({ where: { id: fileId }, include: projectFileAccessInclude(user.id, today) });
}
