"use server";

import { revalidatePath } from "next/cache";

import { recordProjectUpload } from "@/lib/files/heic-conversion-jobs";
import { saveProjectUpload } from "@/lib/files/storage";
import { parseDateOnly } from "@/lib/dates/calendar";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { buildAssignmentSnapshots } from "@/lib/teams/assignments";
import { parseActualHeadcount } from "@/lib/teams/headcount";

function readRequiredText(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export async function createDailyTaskAction(formData: FormData) {
  const user = await requireRole("ADMIN");

  const taskDate = parseDateOnly(readRequiredText(formData, "taskDate"));
  const projectId = readRequiredText(formData, "projectId");
  const managerNote = String(formData.get("managerNote") ?? "").trim();

  if (!taskDate) {
    throw new Error("Gecersiz tarih.");
  }
  const assignmentSnapshots = await buildAssignmentSnapshots(formData, taskDate);
  const assigneeIds = assignmentSnapshots.map((item) => item.userId);

  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
  });

  if (!project) {
    throw new Error("Proje bulunamadi.");
  }

  const existingProjectTask = await prisma.dailyTask.findFirst({
    where: {
      projectId,
      taskDate,
    },
  });

  if (existingProjectTask) {
    throw new Error("Bu proje secilen gune zaten eklenmis.");
  }

  const dailyTask = await prisma.dailyTask.create({
    data: {
      taskDate,
      projectId,
      title: project.name,
      managerNote: managerNote || null,
      createdByUserId: user.id,
      assignees: {
        create: assignmentSnapshots,
      },
      events: {
        create: {
          projectId,
          userId: user.id,
          type: "TASK_CREATED",
          note: managerNote || null,
        },
      },
      timelineEvents: {
        create: [
          {
            projectId,
            userId: user.id,
            eventType: "TASK_CREATED",
            title: "Gunluk gorev olusturuldu",
            description: managerNote || null,
          },
          ...assigneeIds.map((assigneeId) => ({
            projectId,
            userId: assigneeId,
            eventType: "PERSON_ASSIGNED" as const,
            title: "Personel atandi",
            description: toDateInputValueForTimeline(taskDate),
          })),
        ],
      },
    },
  });

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  for (const file of files) {
    const upload = await saveProjectUpload(file, projectId);

    if (!upload) {
      continue;
    }

    await recordProjectUpload(upload, {
      projectId,
      dailyTaskId: dailyTask.id,
      uploadedByUserId: user.id,
      timelineTitle: "Gunluk goreve dosya eklendi",
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/projects/${projectId}`);
}

export async function updateDailyTaskAction(formData: FormData) {
  const user = await requireRole("ADMIN");

  const taskId = readRequiredText(formData, "taskId");
  const managerNote = String(formData.get("managerNote") ?? "").trim();
  const noteToTimeline = String(formData.get("timelineNote") ?? "").trim();

  const task = await prisma.dailyTask.findUnique({
    where: {
      id: taskId,
    },
    include: {
      project: true,
      assignees: true,
    },
  });

  if (!task) {
    throw new Error("Gorev bulunamadi.");
  }
  const assignmentSnapshots = task.status === "PLANNED" ? await buildAssignmentSnapshots(formData, task.taskDate, task.assignees) : task.assignees;
  const assigneeIds = assignmentSnapshots.map((item) => item.userId);

  await prisma.$transaction(async (tx) => {
    await tx.dailyTask.update({
      where: {
        id: task.id,
        status: task.status,
      },
      data: {
        managerNote: managerNote || null,
        ...(task.status === "PLANNED"
          ? {
              assignees: {
                deleteMany: {},
                create: assignmentSnapshots.map(({ userId, teamId, teamNameSnapshot, headcountSnapshot, actualHeadcount, workforceKindSnapshot }) => ({ userId, teamId, teamNameSnapshot, headcountSnapshot, actualHeadcount, workforceKindSnapshot })),
              },
            }
          : {}),
      },
    });

    await tx.taskEvent.create({
      data: {
        dailyTaskId: task.id,
        projectId: task.projectId,
        userId: user.id,
        type: "TASK_UPDATED",
        note: managerNote || noteToTimeline || null,
      },
    });

    await tx.projectTimelineEvent.create({
      data: {
        projectId: task.projectId,
        dailyTaskId: task.id,
        userId: user.id,
        eventType: noteToTimeline ? "NOTE_ADDED" : "TASK_UPDATED",
        title: noteToTimeline ? "Yonetici not ekledi" : "Gunluk gorev guncellendi",
        description: noteToTimeline || managerNote || null,
      },
    });

    if (task.status === "PLANNED") {
      const previousAssignees = new Set(
        task.assignees.map((assignee) => assignee.userId),
      );
      const newlyAssignedIds = assigneeIds.filter(
        (assigneeId) => !previousAssignees.has(assigneeId),
      );

      if (newlyAssignedIds.length > 0) {
        await tx.projectTimelineEvent.createMany({
          data: newlyAssignedIds.map((assigneeId) => ({
            projectId: task.projectId,
            dailyTaskId: task.id,
            userId: assigneeId,
            eventType: "PERSON_ASSIGNED",
            title: "Personel atandi",
            description: toDateInputValueForTimeline(task.taskDate),
          })),
        });
      }
    }
  });

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  for (const file of files) {
    const upload = await saveProjectUpload(file, task.projectId);

    if (!upload) {
      continue;
    }

    await recordProjectUpload(upload, {
      projectId: task.projectId,
      dailyTaskId: task.id,
      uploadedByUserId: user.id,
      timelineTitle: "Gunluk goreve dosya eklendi",
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/schedule/tasks/${task.id}`);
  revalidatePath(`/admin/projects/${task.projectId}`);
}

export async function removeDailyTaskAction(formData: FormData) {
  const user = await requireRole("ADMIN");
  const taskId = readRequiredText(formData, "taskId");

  const task = await prisma.dailyTask.findUnique({
    where: {
      id: taskId,
    },
    select: {
      id: true,
      projectId: true,
      status: true,
      taskDate: true,
      title: true,
    },
  });

  if (!task) {
    throw new Error("Gorev bulunamadi.");
  }

  if (task.status !== "PLANNED") {
    throw new Error("Sahadaki veya tamamlanmis gorevler gunden kaldirilamaz.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.dailyTask.delete({
      where: {
        id: task.id,
        status: "PLANNED",
      },
    });

    await tx.projectTimelineEvent.create({
      data: {
        projectId: task.projectId,
        userId: user.id,
        eventType: "TASK_UPDATED",
        title: "Gunluk gorev gunden kaldirildi",
        description: `${task.title} - ${toDateInputValueForTimeline(task.taskDate)}`,
      },
    });
  });

  revalidatePath("/admin");
  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/schedule/tasks/${task.id}`);
  revalidatePath(`/admin/projects/${task.projectId}`);
}

export async function correctTeamHeadcountAction(formData: FormData) {
  const user = await requireRole("ADMIN");
  const assignmentId = readRequiredText(formData, "assignmentId");
  const reason = readRequiredText(formData, "reason");
  if (reason.length < 3 || reason.length > 1000) throw new Error("Düzeltme açıklaması 3–1000 karakter olmalıdır.");
  const actualHeadcount = parseActualHeadcount(formData.get("actualHeadcount"));
  if (actualHeadcount === null) throw new Error("Sahaya gelen ekip mevcudunu girin.");
  const assignment = await prisma.dailyTaskAssignee.findUnique({ where: { id: assignmentId }, include: { dailyTask: true } });
  if (!assignment || assignment.workforceKindSnapshot !== "CONTRACTOR") throw new Error("Taşeron ekip ataması bulunamadı.");
  const task = assignment.dailyTask;
  if (!task.arrivedAt || task.status === "PLANNED") throw new Error("Fiili ekip mevcudu yalnız sahaya varıştan sonra doğrulanabilir.");
  const description = `${assignment.teamNameSnapshot ?? "Taşeron ekip"}: fiili mevcud ${assignment.actualHeadcount ?? "bilinmiyor"} → ${actualHeadcount}. Açıklama: ${reason}`;
  await prisma.$transaction(async (tx) => {
    await tx.dailyTaskAssignee.update({ where: { id: assignment.id, actualHeadcount: assignment.actualHeadcount }, data: { actualHeadcount } });
    await tx.taskEvent.create({ data: { dailyTaskId: task.id, projectId: task.projectId, userId: user.id, type: "NOTE_ADDED", note: description } });
    await tx.projectTimelineEvent.create({ data: { projectId: task.projectId, dailyTaskId: task.id, userId: user.id, eventType: "NOTE_ADDED", title: "Yönetici ekip mevcudunu doğruladı", description } });
  });
  revalidatePath("/admin");
  revalidatePath("/admin/reports");
  revalidatePath(`/admin/schedule/tasks/${task.id}`);
  revalidatePath(`/admin/projects/${task.projectId}`);
}

function toDateInputValueForTimeline(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${day}/${month}/${year}`;
}
