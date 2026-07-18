import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { getDateOnlyRangeInAppTimeZone, getTodayDateOnly } from "@/lib/dates/today";
import { recordProjectUpload, scheduleHeicConversionProcessing } from "@/lib/files/heic-conversion-jobs";
import { saveProjectUpload } from "@/lib/files/storage";
import { formatSiteDurationMinutes } from "@/lib/format/duration";
import { parseLatitude, parseLongitude } from "@/lib/location/google-maps";
import { prisma } from "@/lib/db/prisma";

type ProjectUpload = NonNullable<Awaited<ReturnType<typeof saveProjectUpload>>>;
type PersonnelSyncType = "ARRIVED_SITE" | "LEFT_SITE" | "NOTE";
type SyncPayload = FormData | Record<string, unknown>;

function readPayloadValue(payload: SyncPayload, name: string) {
  return payload instanceof FormData ? payload.get(name) : payload[name];
}

function readRequiredText(payload: SyncPayload, name: string) {
  const value = String(readPayloadValue(payload, name) ?? "").trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function readLocation(payload: SyncPayload) {
  const latitude = parseLatitude(String(readPayloadValue(payload, "latitude") ?? ""));
  const longitude = parseLongitude(String(readPayloadValue(payload, "longitude") ?? ""));

  if (latitude === null || longitude === null) {
    return {
      latitude: null,
      longitude: null,
    };
  }

  if (latitude === 0 && longitude === 0) {
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

function readFiles(payload: SyncPayload) {
  if (!(payload instanceof FormData)) {
    return [];
  }

  return payload
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);
}

async function readSyncPayload(request: Request): Promise<SyncPayload> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    const payload: unknown = await request.json();

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Gecersiz istek verisi.");
    }

    return payload as Record<string, unknown>;
  }

  return request.formData();
}

function parseSyncType(value: string): PersonnelSyncType | null {
  return value === "ARRIVED_SITE" || value === "LEFT_SITE" || value === "NOTE"
    ? value
    : null;
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

async function requireAssignedPastOrTodayTask(taskId: string, userId: string) {
  const task = await prisma.dailyTask.findFirst({
    where: {
      id: taskId,
      taskDate: {
        lte: getTodayDateOnly(),
      },
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
    throw new Error("Gorev bulunamadi veya bu personele atanmamis.");
  }

  return task;
}

export async function POST(request: Request) {
  const user = await requireRole("PERSONNEL");

  try {
    const payload = await readSyncPayload(request);
    const requestedType = readRequiredText(payload, "type");
    const taskId = readRequiredText(payload, "taskId");
    const type = parseSyncType(requestedType);

    if (!type) {
      return NextResponse.json(
        { error: "Gecersiz personel kayit tipi." },
        { status: 400 },
      );
    }

    if (type === "ARRIVED_SITE") {
      await syncArriveSite(user.id, taskId, payload);
      return NextResponse.json({ ok: true });
    }

    if (type === "LEFT_SITE") {
      await syncLeaveSite(user.id, taskId, payload);
      return NextResponse.json({ ok: true });
    }

    await syncNote(user.id, taskId, payload);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const responseError = getPersonnelSyncError(error);
    return NextResponse.json(
      { error: responseError.message },
      { status: responseError.status },
    );
  }
}

function getPersonnelSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : "Islem kaydedilemedi.";
  const normalized = message.toLowerCase();

  if (normalized.includes("formdata") || normalized.includes("multipart")) {
    return {
      message: "Istek verisi okunamadi. Baglantiyi kontrol edip tekrar deneyin.",
      status: 503,
    };
  }

  return {
    message,
    status: isPersonnelRequestError(message) ? 400 : 500,
  };
}

function isPersonnelRequestError(message: string) {
  return [
    " is required",
    "Gecersiz istek verisi.",
    "Gecersiz personel kayit tipi.",
    "Gorev bulunamadi",
    "Önce aktif sahadaki görevi kapatmalısın.",
    "Bugün yaptıklarının notunu yaz!",
    "Dosya boyutu 100 MB limitini asamaz.",
  ].some((expected) => message.includes(expected));
}

async function syncArriveSite(
  userId: string,
  taskId: string,
  payload: SyncPayload,
) {
  const task = await requireAssignedTodayTask(taskId, userId);
  const { latitude, longitude } = readLocation(payload);
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
            userId,
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
  });
}

async function syncLeaveSite(
  userId: string,
  taskId: string,
  payload: SyncPayload,
) {
  const task = await requireAssignedTodayTask(taskId, userId);
  const { latitude, longitude } = readLocation(payload);
  const now = new Date();
  const durationMinutes = task.arrivedAt
    ? Math.max(0, Math.round((now.getTime() - task.arrivedAt.getTime()) / 60000))
    : null;
  await prisma.$transaction(async (tx) => {
    const taskDateRange = getDateOnlyRangeInAppTimeZone(task.taskDate);
    const todayNote = await tx.projectTimelineEvent.findFirst({
      where: {
        projectId: task.projectId,
        dailyTaskId: task.id,
        userId,
        eventType: "NOTE_ADDED",
        createdAt: {
          gte: taskDateRange.start,
          lt: taskDateRange.end,
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
        userId,
        type: "LEFT_SITE",
        latitude,
        longitude,
      },
    });

    await tx.projectTimelineEvent.create({
      data: {
        projectId: task.projectId,
        dailyTaskId: task.id,
        userId,
        eventType: "LEFT_SITE",
        title: "Sahadan ayrildi",
        description:
          durationMinutes !== null
            ? `Sahada gecen sure: ${formatSiteDurationMinutes(durationMinutes)}`
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
  });
}

async function syncNote(
  userId: string,
  taskId: string,
  payload: SyncPayload,
) {
  const note = readRequiredText(payload, "note");
  const task = await requireAssignedPastOrTodayTask(taskId, userId);
  const files = readFiles(payload);
  const uploads: ProjectUpload[] = [];

  for (const file of files) {
    const upload = await saveProjectUpload(file, task.projectId);

    if (upload) {
      uploads.push(upload);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.taskEvent.create({
      data: {
        dailyTaskId: task.id,
        projectId: task.projectId,
        userId,
        type: "NOTE_ADDED",
        note,
      },
    });

    await tx.projectNote.create({
      data: {
        projectId: task.projectId,
        userId,
        note,
      },
    });

    await tx.projectTimelineEvent.create({
      data: {
        projectId: task.projectId,
        dailyTaskId: task.id,
        userId,
        eventType: "NOTE_ADDED",
        title: "Personel not ekledi",
        description: note,
      },
    });

    for (const upload of uploads) {
      await recordProjectUpload(upload, {
        projectId: task.projectId,
        dailyTaskId: task.id,
        uploadedByUserId: userId,
        note,
        timelineTitle: "Personel dosya ekledi",
      }, tx);
    }
  });

  scheduleHeicConversionProcessing();
}
