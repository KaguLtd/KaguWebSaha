import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { getTodayDateOnly } from "@/lib/dates/today";
import { saveProjectUpload } from "@/lib/files/storage";
import { parseLatitude, parseLongitude } from "@/lib/location/google-maps";
import { prisma } from "@/lib/db/prisma";

type SavedProjectUpload = NonNullable<Awaited<ReturnType<typeof saveProjectUpload>>>;

function readRequiredText(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
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
    throw new Error("Gorev bulunamadi veya bugun bu personele atanmamis.");
  }

  return task;
}

export async function POST(request: Request) {
  const user = await requireRole("PERSONNEL");
  const formData = await request.formData();
  const clientItemId = readRequiredText(formData, "clientItemId");
  const type = readRequiredText(formData, "type");
  const taskId = readRequiredText(formData, "taskId");

  const existing = await prisma.offlinePendingItem.findUnique({
    where: {
      clientItemId,
    },
  });

  if (existing?.status === "SYNCED") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (type === "ARRIVED_SITE") {
    await syncArriveSite(user.id, clientItemId, taskId, formData);
    return NextResponse.json({ ok: true });
  }

  if (type === "LEFT_SITE") {
    await syncLeaveSite(user.id, clientItemId, taskId, formData);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Gecersiz offline kayit tipi." }, { status: 400 });
}

async function syncArriveSite(
  userId: string,
  clientItemId: string,
  taskId: string,
  formData: FormData,
) {
  const task = await requireAssignedTodayTask(taskId, userId);
  const { latitude, longitude } = readLocation(formData);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.offlinePendingItem.upsert({
      where: {
        clientItemId,
      },
      create: {
        userId,
        clientItemId,
        type: "ARRIVED_SITE",
        status: "PENDING",
        payload: {
          taskId,
          latitude,
          longitude,
        },
      },
      update: {},
    });

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
        userId,
        type: "ARRIVED_SITE",
        latitude,
        longitude,
      },
    });

    await tx.projectTimelineEvent.create({
      data: {
        projectId: task.projectId,
        dailyTaskId: task.id,
        userId,
        eventType: "ARRIVED_SITE",
        title: "Sahaya ulasildi",
        description:
          latitude !== null && longitude !== null
            ? `Konum: ${latitude}, ${longitude}`
            : null,
      },
    });

    if (latitude !== null && longitude !== null) {
      await tx.user.update({
        where: {
          id: userId,
        },
        data: {
          lastLatitude: latitude,
          lastLongitude: longitude,
          lastLocationAt: now,
        },
      });
    }

    await tx.offlinePendingItem.update({
      where: {
        clientItemId,
      },
      data: {
        status: "SYNCED",
        syncedAt: now,
        lastError: null,
      },
    });
  });
}

async function syncLeaveSite(
  userId: string,
  clientItemId: string,
  taskId: string,
  formData: FormData,
) {
  const note = readRequiredText(formData, "note");
  const task = await requireAssignedTodayTask(taskId, userId);
  const { latitude, longitude } = readLocation(formData);
  const now = new Date();
  const durationMinutes = task.arrivedAt
    ? Math.max(0, Math.round((now.getTime() - task.arrivedAt.getTime()) / 60000))
    : null;
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);
  const savedFiles: SavedProjectUpload[] = [];

  for (const file of files) {
    const savedFile = await saveProjectUpload(file, task.projectId);

    if (savedFile) {
      savedFiles.push(savedFile);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.offlinePendingItem.upsert({
      where: {
        clientItemId,
      },
      create: {
        userId,
        clientItemId,
        type: "LEFT_SITE",
        status: "PENDING",
        payload: {
          taskId,
          note,
          latitude,
          longitude,
        },
      },
      update: {},
    });

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
        userId,
        type: "LEFT_SITE",
        note,
        latitude,
        longitude,
      },
    });

    await tx.projectNote.create({
      data: {
        projectId: task.projectId,
        userId,
        note,
      },
    });

    await tx.projectTimelineEvent.createMany({
      data: [
        {
          projectId: task.projectId,
          dailyTaskId: task.id,
          userId,
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
          userId,
          eventType: "NOTE_ADDED",
          title: "Personel not ekledi",
          description: note,
        },
      ],
    });

    if (latitude !== null && longitude !== null) {
      await tx.user.update({
        where: {
          id: userId,
        },
        data: {
          lastLatitude: latitude,
          lastLongitude: longitude,
          lastLocationAt: now,
        },
      });
    }

    for (const savedFile of savedFiles) {
      const projectFile = await tx.projectFile.create({
        data: {
          projectId: task.projectId,
          dailyTaskId: task.id,
          uploadedByUserId: userId,
          originalName: savedFile.originalName,
          mimeType: savedFile.mimeType,
          sizeBytes: savedFile.sizeBytes,
          storagePath: savedFile.storagePath,
          note,
        },
      });

      await tx.projectTimelineEvent.create({
        data: {
          projectId: task.projectId,
          dailyTaskId: task.id,
          userId,
          eventType: "FILE_ADDED",
          title: "Personel dosya ekledi",
          description: savedFile.originalName,
          fileId: projectFile.id,
        },
      });
    }

    await tx.offlinePendingItem.update({
      where: {
        clientItemId,
      },
      data: {
        status: "SYNCED",
        syncedAt: now,
        lastError: null,
      },
    });
  });
}
