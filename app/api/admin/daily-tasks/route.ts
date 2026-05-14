import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { parseDateOnly } from "@/lib/dates/calendar";
import { prisma } from "@/lib/db/prisma";
import { saveProjectUpload } from "@/lib/files/storage";

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function readRequiredText(formData: FormData, name: string) {
  const value = readText(formData, name);

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function toDateInputValueForTimeline(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${day}/${month}/${year}`;
}

async function attachFiles(
  formData: FormData,
  projectId: string,
  dailyTaskId: string,
  userId: string,
) {
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
        dailyTaskId,
        uploadedByUserId: userId,
        originalName: savedFile.originalName,
        mimeType: savedFile.mimeType,
        sizeBytes: savedFile.sizeBytes,
        storagePath: savedFile.storagePath,
      },
    });

    await prisma.projectTimelineEvent.create({
      data: {
        projectId,
        dailyTaskId,
        userId,
        eventType: "FILE_ADDED",
        title: "Gunluk goreve dosya eklendi",
        description: savedFile.originalName,
        fileId: projectFile.id,
      },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireRole("ADMIN");

  try {
    const formData = await request.formData();
    const operation = readRequiredText(formData, "operation");
    const redirectTo = readText(formData, "redirectTo");

    if (operation === "create") {
      const taskDate = parseDateOnly(readRequiredText(formData, "taskDate"));
      const projectId = readRequiredText(formData, "projectId");
      const managerNote = readText(formData, "managerNote");
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

      await attachFiles(formData, projectId, dailyTask.id, user.id);

      revalidatePath("/admin");
      revalidatePath("/admin/schedule");
      revalidatePath(`/admin/projects/${projectId}`);

      return NextResponse.json({ ok: true, taskId: dailyTask.id });
    }

    if (operation === "update") {
      const taskId = readRequiredText(formData, "taskId");
      const managerNote = readText(formData, "managerNote");
      const noteToTimeline = readText(formData, "timelineNote");
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

      await attachFiles(formData, task.projectId, task.id, user.id);

      revalidatePath("/admin");
      revalidatePath("/admin/schedule");
      revalidatePath(`/admin/schedule/tasks/${task.id}`);
      revalidatePath(`/admin/projects/${task.projectId}`);

      if (redirectTo) {
        return NextResponse.redirect(new URL(redirectTo, request.url), 303);
      }

      return NextResponse.json({ ok: true, taskId: task.id });
    }

    return NextResponse.json({ error: "Gecersiz islem." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Islem kaydedilemedi." },
      { status: 400 },
    );
  }
}
