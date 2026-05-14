"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { getTodayDateOnly } from "@/lib/dates/today";
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

  await prisma.$transaction(async (tx) => {
    const activeTask = await tx.dailyTask.findFirst({
      where: {
        taskDate: getTodayDateOnly(),
        status: "ON_SITE",
        id: {
          not: task.id,
        },
        assignees: {
          some: {
            userId: user.id,
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (activeTask) {
      throw new Error("Önce aktif sahadaki görevi kapatmalısın.");
    }

    await tx.dailyTask.update({
      where: {
        id: task.id,
      },
      data: {
        status: "ON_SITE",
        arrivedAt: task.arrivedAt ?? now,
      },
    });
    await tx.taskEvent.create({
      data: {
        dailyTaskId: task.id,
        projectId: task.projectId,
        userId: user.id,
        type: "ARRIVED_SITE",
        latitude,
        longitude,
      },
    });
    await tx.projectTimelineEvent.create({
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
    });
    await tx.user.update({
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
    });
  });

  revalidatePath("/personnel");
  revalidatePath(`/personnel/tasks/${task.id}`);
}

export async function leaveSiteAction(formData: FormData) {
  const user = await requireRole("PERSONNEL");
  const taskId = readRequiredText(formData, "taskId");
  const task = await requireAssignedTodayTask(taskId, user.id);
  const { latitude, longitude } = readLocation(formData);
  const now = new Date();
  const durationMinutes = task.arrivedAt
    ? Math.max(0, Math.round((now.getTime() - task.arrivedAt.getTime()) / 60000))
    : null;

  await prisma.$transaction(async (tx) => {
    const tomorrow = new Date(task.taskDate);
    tomorrow.setUTCDate(task.taskDate.getUTCDate() + 1);
    const todayNote = await tx.projectTimelineEvent.findFirst({
      where: {
        projectId: task.projectId,
        dailyTaskId: task.id,
        userId: user.id,
        eventType: "NOTE_ADDED",
        createdAt: {
          gte: task.taskDate,
          lt: tomorrow,
        },
      },
      select: {
        id: true,
      },
    });

    if (!todayNote) {
      throw new Error("Bugün yaptıklarının notunu yaz!");
    }

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
        latitude,
        longitude,
      },
    });

    await tx.projectTimelineEvent.create({
      data: {
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

  revalidatePath("/personnel");
  revalidatePath(`/personnel/tasks/${task.id}`);
}
