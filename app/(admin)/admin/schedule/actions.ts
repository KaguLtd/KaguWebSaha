"use server";

import { revalidatePath } from "next/cache";

import { saveProjectUpload } from "@/lib/files/storage";
import { parseDateOnly } from "@/lib/dates/calendar";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

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
  const assigneeIds = formData
    .getAll("assigneeIds")
    .map(String)
    .filter(Boolean);

  if (!taskDate) {
    throw new Error("Gecersiz tarih.");
  }

  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
  });

  if (!project) {
    throw new Error("Proje bulunamadi.");
  }

  const conflictingAssignee = await prisma.dailyTaskAssignee.findFirst({
    where: {
      userId: {
        in: assigneeIds,
      },
      dailyTask: {
        taskDate,
        status: {
          in: ["PLANNED", "ON_SITE"],
        },
      },
    },
    include: {
      user: true,
    },
  });

  if (conflictingAssignee) {
    throw new Error(
      `${conflictingAssignee.user.fullName} bu gun icin baska aktif goreve atanmis.`,
    );
  }

  const dailyTask = await prisma.dailyTask.create({
    data: {
      taskDate,
      projectId,
      title: project.name,
      managerNote: managerNote || null,
      createdByUserId: user.id,
      assignees: {
        create: assigneeIds.map((userId) => ({
          userId,
        })),
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
    const savedFile = await saveProjectUpload(file, projectId);

    if (!savedFile) {
      continue;
    }

    const projectFile = await prisma.projectFile.create({
      data: {
        projectId,
        dailyTaskId: dailyTask.id,
        uploadedByUserId: user.id,
        originalName: savedFile.originalName,
        mimeType: savedFile.mimeType,
        sizeBytes: savedFile.sizeBytes,
        storagePath: savedFile.storagePath,
      },
    });

    await prisma.projectTimelineEvent.create({
      data: {
        projectId,
        dailyTaskId: dailyTask.id,
        userId: user.id,
        eventType: "FILE_ADDED",
        title: "Gunluk goreve dosya eklendi",
        description: savedFile.originalName,
        fileId: projectFile.id,
      },
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
  const assigneeIds = formData
    .getAll("assigneeIds")
    .map(String)
    .filter(Boolean);

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

  if (task.status === "PLANNED") {
    const conflictingAssignee = await prisma.dailyTaskAssignee.findFirst({
      where: {
        userId: {
          in: assigneeIds,
        },
        dailyTaskId: {
          not: task.id,
        },
        dailyTask: {
          taskDate: task.taskDate,
          status: {
            in: ["PLANNED", "ON_SITE"],
          },
        },
      },
      include: {
        user: true,
      },
    });

    if (conflictingAssignee) {
      throw new Error(
        `${conflictingAssignee.user.fullName} bu gun icin baska aktif goreve atanmis.`,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.dailyTask.update({
      where: {
        id: task.id,
      },
      data: {
        managerNote: managerNote || null,
        ...(task.status === "PLANNED"
          ? {
              assignees: {
                deleteMany: {},
                create: assigneeIds.map((userId) => ({
                  userId,
                })),
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
    const savedFile = await saveProjectUpload(file, task.projectId);

    if (!savedFile) {
      continue;
    }

    const projectFile = await prisma.projectFile.create({
      data: {
        projectId: task.projectId,
        dailyTaskId: task.id,
        uploadedByUserId: user.id,
        originalName: savedFile.originalName,
        mimeType: savedFile.mimeType,
        sizeBytes: savedFile.sizeBytes,
        storagePath: savedFile.storagePath,
      },
    });

    await prisma.projectTimelineEvent.create({
      data: {
        projectId: task.projectId,
        dailyTaskId: task.id,
        userId: user.id,
        eventType: "FILE_ADDED",
        title: "Gunluk goreve dosya eklendi",
        description: savedFile.originalName,
        fileId: projectFile.id,
      },
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/schedule/tasks/${task.id}`);
  revalidatePath(`/admin/projects/${task.projectId}`);
}

function toDateInputValueForTimeline(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${day}/${month}/${year}`;
}
