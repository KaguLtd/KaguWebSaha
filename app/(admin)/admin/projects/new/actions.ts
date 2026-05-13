"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { saveProjectUpload } from "@/lib/files/storage";
import {
  parseCoordinate,
  parseGoogleMapsCoordinates,
} from "@/lib/location/google-maps";
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
  const location = readText(formData, "location");
  const googleMapsUrl = readText(formData, "googleMapsUrl");
  const manualLatitude = parseCoordinate(readText(formData, "latitude"));
  const manualLongitude = parseCoordinate(readText(formData, "longitude"));
  const parsedMapsCoordinates = parseGoogleMapsCoordinates(googleMapsUrl);
  const latitude = parsedMapsCoordinates?.latitude ?? manualLatitude;
  const longitude = parsedMapsCoordinates?.longitude ?? manualLongitude;

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
  redirect(`/admin/projects/${project.id}`);
}

