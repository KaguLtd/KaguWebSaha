"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { getTodayDateOnly } from "@/lib/dates/today";
import { saveProjectUpload } from "@/lib/files/storage";
import { parseLatitude, parseLongitude } from "@/lib/location/google-maps";
import { prisma } from "@/lib/db/prisma";

function readRequiredText(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function requireAssignedTodayTask(taskId: string, userId: string) {
  const task = await prisma.dailyTask.findFirst({
    where: {
      id: taskId,
      taskDate: getTodayDateOnly(),
      assignees: {
        some: {
          userId,
        },
      },
    },
    include: {
      project: true,
    },
  });

  if (!task) {
    throw new Error("Gorev bulunamadi veya bugun sana atanmamis.");
  }

  return task;
}

function readLocation(formData: FormData) {
  const latitude = parseLatitude(String(formData.get("latitude") ?? ""));
  const longitude = parseLongitude(String(formData.get("longitude") ?? ""));

  if (latitude === null || longitude === null) {
    return {
      latitude: null,
      longitude: null,
    };
  }

  return {
    latitude,
    longitude,
  };
}

export async function arriveSiteAction(formData: FormData) {
  const user = await requireRole("PERSONNEL");
  const taskId = readRequiredText(formData, "taskId");
  const task = await requireAssignedTodayTask(taskId, user.id);
  const { latitude, longitude } = readLocation(formData);
  const now = new Date();

  await prisma.$transaction([
    prisma.dailyTask.update({
      where: {
        id: task.id,
      },
      data: {
        status: "ON_SITE",
        arrivedAt: task.arrivedAt ?? now,
      },
    }),
    prisma.taskEvent.create({
      data: {
        dailyTaskId: task.id,
        projectId: task.projectId,
        userId: user.id,
        type: "ARRIVED_SITE",
        latitude,
        longitude,
      },
    }),
    prisma.projectTimelineEvent.create({
      data: {
        projectId: task.projectId,
        dailyTaskId: task.id,
        userId: user.id,
        eventType: "ARRIVED_SITE",
        title: "Sahaya ulasildi",
        description:
          latitude !== null && longitude !== null
            ? `Konum: ${latitude}, ${longitude}`
            : null,
      },
    }),
    prisma.user.update({
      where: {
        id: user.id,
      },
      data:
        latitude !== null && longitude !== null
          ? {
              lastLatitude: latitude,
              lastLongitude: longitude,
              lastLocationAt: now,
            }
          : {},
    }),
  ]);

  revalidatePath("/personnel");
  revalidatePath(`/personnel/tasks/${task.id}`);
}

export async function leaveSiteAction(formData: FormData) {
  const user = await requireRole("PERSONNEL");
  const taskId = readRequiredText(formData, "taskId");
  const note = readRequiredText(formData, "note");
  const task = await requireAssignedTodayTask(taskId, user.id);
  const { latitude, longitude } = readLocation(formData);
  const now = new Date();
  const durationMinutes = task.arrivedAt
    ? Math.max(0, Math.round((now.getTime() - task.arrivedAt.getTime()) / 60000))
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.dailyTask.update({
      where: {
        id: task.id,
      },
      data: {
        status: "COMPLETED",
        leftAt: now,
        durationMinutes,
      },
    });

    await tx.taskEvent.create({
      data: {
        dailyTaskId: task.id,
        projectId: task.projectId,
        userId: user.id,
        type: "LEFT_SITE",
        note,
        latitude,
        longitude,
      },
    });

    await tx.projectNote.create({
      data: {
        projectId: task.projectId,
        userId: user.id,
        note,
      },
    });

    await tx.projectTimelineEvent.createMany({
      data: [
        {
          projectId: task.projectId,
          dailyTaskId: task.id,
          userId: user.id,
          eventType: "LEFT_SITE",
          title: "Sahadan ayrildi",
          description:
            durationMinutes !== null
              ? `Sahada gecen sure: ${durationMinutes} dakika`
              : null,
        },
        {
          projectId: task.projectId,
          dailyTaskId: task.id,
          userId: user.id,
          eventType: "NOTE_ADDED",
          title: "Personel not ekledi",
          description: note,
        },
      ],
    });

    if (latitude !== null && longitude !== null) {
      await tx.user.update({
        where: {
          id: user.id,
        },
        data: {
          lastLatitude: latitude,
          lastLongitude: longitude,
          lastLocationAt: now,
        },
      });
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
        note,
      },
    });

    await prisma.projectTimelineEvent.create({
      data: {
        projectId: task.projectId,
        dailyTaskId: task.id,
        userId: user.id,
        eventType: "FILE_ADDED",
        title: "Personel dosya ekledi",
        description: savedFile.originalName,
        fileId: projectFile.id,
      },
    });
  }

  revalidatePath("/personnel");
  revalidatePath(`/personnel/tasks/${task.id}`);
}

