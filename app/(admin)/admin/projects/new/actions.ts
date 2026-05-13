"use server";

import { revalidatePath } from "next/cache";

import { saveProjectUpload } from "@/lib/files/storage";
import { parseGoogleMapsCoordinates } from "@/lib/location/google-maps";
import { verifyPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

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

function readLocationInput(formData: FormData) {
  const location = readText(formData, "location");
  const legacyGoogleMapsUrl = readText(formData, "googleMapsUrl");
  const googleMapsUrl = isGoogleMapsUrl(location)
    ? location
    : isGoogleMapsUrl(legacyGoogleMapsUrl)
      ? legacyGoogleMapsUrl
      : "";
  const parsedMapsCoordinates = googleMapsUrl
    ? parseGoogleMapsCoordinates(googleMapsUrl)
    : null;

  return {
    googleMapsUrl,
    latitude: parsedMapsCoordinates?.latitude ?? null,
    location,
    longitude: parsedMapsCoordinates?.longitude ?? null,
  };
}

function isGoogleMapsUrl(value: string) {
  if (!value) {
    return false;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const host = url.hostname.toLowerCase();

  const isGoogleDomain = /(^|\.)google\./.test(host);
  const looksLikeMapsPath =
    url.pathname.startsWith("/maps") || host.startsWith("maps.google.");

  return host === "goo.gl" || host === "maps.app.goo.gl" || (isGoogleDomain && looksLikeMapsPath);
}

export async function createCustomerAction(formData: FormData) {
  await requireRole("ADMIN");

  const name = readRequiredText(formData, "name");
  const info = readText(formData, "info");

  await prisma.customer.create({
    data: {
      name,
      info: info || null,
    },
  });

  revalidatePath("/admin/projects/new");
}

export async function createProjectAction(formData: FormData) {
  const user = await requireRole("ADMIN");

  const customerId = readRequiredText(formData, "customerId");
  const name = readRequiredText(formData, "name");
  const description = readText(formData, "description");
  const { googleMapsUrl, latitude, location, longitude } = readLocationInput(formData);

  const project = await prisma.project.create({
    data: {
      customerId,
      name,
      description: description || null,
      location: location || null,
      googleMapsUrl: googleMapsUrl || null,
      latitude,
      longitude,
      timelineEvents: {
        create: {
          userId: user.id,
          eventType: "PROJECT_CREATED",
          title: "Proje olusturuldu",
          description: description || null,
        },
      },
      ...(description
        ? {
            notes: {
              create: {
                userId: user.id,
                note: description,
              },
            },
          }
        : {}),
    },
  });

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  for (const file of files) {
    const savedFile = await saveProjectUpload(file, project.id);

    if (!savedFile) {
      continue;
    }

    const projectFile = await prisma.projectFile.create({
      data: {
        projectId: project.id,
        uploadedByUserId: user.id,
        originalName: savedFile.originalName,
        mimeType: savedFile.mimeType,
        sizeBytes: savedFile.sizeBytes,
        storagePath: savedFile.storagePath,
      },
    });

    await prisma.projectTimelineEvent.create({
      data: {
        projectId: project.id,
        userId: user.id,
        eventType: "FILE_ADDED",
        title: "Dosya eklendi",
        description: savedFile.originalName,
        fileId: projectFile.id,
      },
    });
  }

  revalidatePath("/admin/projects");
  revalidatePath("/admin/projects/new");
  revalidatePath(`/admin/projects/${project.id}`);
}

export async function updateProjectAction(formData: FormData) {
  const user = await requireRole("ADMIN");

  const projectId = readRequiredText(formData, "projectId");
  const name = readRequiredText(formData, "name");
  const description = readText(formData, "description");
  const { googleMapsUrl, latitude, location, longitude } = readLocationInput(formData);

  const project = await prisma.project.update({
    where: {
      id: projectId,
    },
    data: {
      name,
      description: description || null,
      location: location || null,
      googleMapsUrl: googleMapsUrl || null,
      latitude,
      longitude,
      timelineEvents: {
        create: {
          userId: user.id,
          eventType: "TASK_UPDATED",
          title: "Proje bilgileri guncellendi",
          description: description || null,
        },
      },
      ...(description
        ? {
            notes: {
              create: {
                userId: user.id,
                note: description,
              },
            },
          }
        : {}),
    },
  });

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  for (const file of files) {
    const savedFile = await saveProjectUpload(file, project.id);

    if (!savedFile) {
      continue;
    }

    const projectFile = await prisma.projectFile.create({
      data: {
        projectId: project.id,
        uploadedByUserId: user.id,
        originalName: savedFile.originalName,
        mimeType: savedFile.mimeType,
        sizeBytes: savedFile.sizeBytes,
        storagePath: savedFile.storagePath,
      },
    });

    await prisma.projectTimelineEvent.create({
      data: {
        projectId: project.id,
        userId: user.id,
        eventType: "FILE_ADDED",
        title: "Dosya eklendi",
        description: savedFile.originalName,
        fileId: projectFile.id,
      },
    });
  }

  revalidatePath("/admin/projects");
  revalidatePath("/admin/projects/new");
  revalidatePath(`/admin/projects/${project.id}`);
}

export async function archiveProjectAction(formData: FormData) {
  await requireRole("ADMIN");

  const projectId = readRequiredText(formData, "projectId");

  await prisma.project.update({
    where: {
      id: projectId,
    },
    data: {
      isActive: false,
    },
  });

  revalidatePath("/admin/projects");
  revalidatePath("/admin/projects/new");
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin/schedule");
}

export async function restoreProjectAction(formData: FormData) {
  await requireRole("ADMIN");

  const projectId = readRequiredText(formData, "projectId");

  await prisma.project.update({
    where: {
      id: projectId,
    },
    data: {
      isActive: true,
    },
  });

  revalidatePath("/admin/projects");
  revalidatePath("/admin/projects/new");
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin/schedule");
}

export async function deleteProjectAction(formData: FormData) {
  const user = await requireRole("ADMIN");

  const projectId = readRequiredText(formData, "projectId");
  const password = readRequiredText(formData, "password");

  if (!verifyPassword(password, user.passwordHash)) {
    throw new Error("Parola dogrulanamadi.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.dailyTask.deleteMany({
      where: {
        projectId,
      },
    });

    await tx.project.delete({
      where: {
        id: projectId,
      },
    });
  });

  revalidatePath("/admin");
  revalidatePath("/admin/projects");
  revalidatePath("/admin/projects/new");
  revalidatePath("/admin/schedule");
}
