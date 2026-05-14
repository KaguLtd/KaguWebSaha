import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { saveProjectUpload } from "@/lib/files/storage";
import { parseGoogleMapsCoordinates } from "@/lib/location/google-maps";

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

async function attachFiles(formData: FormData, projectId: string, userId: string) {
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
        userId,
        eventType: "FILE_ADDED",
        title: "Dosya eklendi",
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

    if (operation === "create") {
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

      await attachFiles(formData, project.id, user.id);

      revalidatePath("/admin/projects");
      revalidatePath("/admin/projects/new");
      revalidatePath(`/admin/projects/${project.id}`);

      return NextResponse.json({ ok: true, projectId: project.id });
    }

    if (operation === "update") {
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

      await attachFiles(formData, project.id, user.id);

      revalidatePath("/admin/projects");
      revalidatePath("/admin/projects/new");
      revalidatePath(`/admin/projects/${project.id}`);

      return NextResponse.json({ ok: true, projectId: project.id });
    }

    return NextResponse.json({ error: "Gecersiz islem." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Islem kaydedilemedi." },
      { status: 400 },
    );
  }
}
