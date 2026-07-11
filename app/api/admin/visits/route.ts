import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireAnyRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { recordProjectUpload } from "@/lib/files/heic-conversion-jobs";
import { saveProjectUpload } from "@/lib/files/storage";
import { parseLatitude, parseLongitude } from "@/lib/location/google-maps";

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

function readLocation(formData: FormData) {
  const latitude = parseLatitude(String(formData.get("latitude") ?? ""));
  const longitude = parseLongitude(String(formData.get("longitude") ?? ""));

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

async function requireVisitProject(projectId: string, userRole: "ADMIN" | "OBSERVER") {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
    select: {
      id: true,
      isActive: true,
      name: true,
    },
  });

  if (!project) {
    throw new Error("Proje bulunamadi.");
  }

  if (userRole === "OBSERVER" && !project.isActive) {
    throw new Error("Saha kontrol arsiv projeye ziyaret kaydi ekleyemez.");
  }

  return project;
}

async function readValidProjectVisit(projectVisitId: string, projectId: string) {
  const visit = await prisma.projectVisit.findFirst({
    where: {
      id: projectVisitId,
      projectId,
    },
    select: {
      id: true,
      note: true,
    },
  });

  if (!visit) {
    throw new Error("Ziyaret kaydi bulunamadi.");
  }

  return visit;
}

function revalidateVisitPaths(projectId: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/visits");
  revalidatePath(`/admin/visits/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin/reports");
}

export async function POST(request: Request) {
  const user = await requireAnyRole(["ADMIN", "OBSERVER"]);
  const userRole = user.role === "ADMIN" ? "ADMIN" : "OBSERVER";

  try {
    const formData = await request.formData();
    const operation = readRequiredText(formData, "operation");
    const projectId = readRequiredText(formData, "projectId");
    const project = await requireVisitProject(projectId, userRole);

    if (operation === "visit") {
      const note = readText(formData, "note");
      const { latitude, longitude } = readLocation(formData);
      const now = new Date();

      const visit = await prisma.$transaction(async (tx) => {
        const projectVisit = await tx.projectVisit.create({
          data: {
            projectId: project.id,
            visitedByUserId: user.id,
            note: note || null,
            latitude,
            longitude,
            visitedAt: now,
          },
        });

        await tx.projectTimelineEvent.create({
          data: {
            projectId: project.id,
            projectVisitId: projectVisit.id,
            userId: user.id,
            eventType: "SITE_VISITED",
            title: "Proje ziyaret edildi",
            description:
              latitude !== null && longitude !== null
                ? `Konum: ${latitude}, ${longitude}`
                : note || null,
          },
        });

        if (note) {
          await tx.projectNote.create({
            data: {
              projectId: project.id,
              userId: user.id,
              note,
            },
          });

          await tx.projectTimelineEvent.create({
            data: {
              projectId: project.id,
              projectVisitId: projectVisit.id,
              userId: user.id,
              eventType: "NOTE_ADDED",
              title: "Ziyaret notu eklendi",
              description: note,
            },
          });
        }

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

        return projectVisit;
      });

      revalidateVisitPaths(project.id);

      return NextResponse.json({ ok: true, visitId: visit.id });
    }

    if (operation === "note") {
      const note = readRequiredText(formData, "note");
      const projectVisitId = readText(formData, "projectVisitId") || null;
      const visit = projectVisitId
        ? await readValidProjectVisit(projectVisitId, project.id)
        : null;

      await prisma.$transaction(async (tx) => {
        await tx.projectNote.create({
          data: {
            projectId: project.id,
            userId: user.id,
            note,
          },
        });

        if (visit && !visit.note) {
          await tx.projectVisit.update({
            where: {
              id: visit.id,
            },
            data: {
              note,
            },
          });
        }

        await tx.projectTimelineEvent.create({
          data: {
            projectId: project.id,
            projectVisitId: visit?.id ?? null,
            userId: user.id,
            eventType: "NOTE_ADDED",
            title: visit ? "Ziyaret notu eklendi" : "Proje notu eklendi",
            description: note,
          },
        });
      });

      revalidateVisitPaths(project.id);

      return NextResponse.json({ ok: true, visitId: visit?.id ?? null });
    }

    if (operation === "file") {
      const note = readText(formData, "note");
      const projectVisitId = readText(formData, "projectVisitId") || null;
      const visit = projectVisitId
        ? await readValidProjectVisit(projectVisitId, project.id)
        : null;
      const files = formData
        .getAll("files")
        .filter((value): value is File => value instanceof File && value.size > 0);

      if (files.length === 0) {
        throw new Error("Yuklenecek dosya secilmedi.");
      }

      for (const file of files) {
        const upload = await saveProjectUpload(file, project.id);

        if (!upload) {
          continue;
        }

        await recordProjectUpload(upload, {
          projectId: project.id,
          projectVisitId: visit?.id ?? null,
          uploadedByUserId: user.id,
          note: note || null,
          timelineTitle: visit ? "Ziyaret dosyasi eklendi" : "Proje dosyasi eklendi",
        });
      }

      revalidateVisitPaths(project.id);

      return NextResponse.json({ ok: true, visitId: visit?.id ?? null });
    }

    if (operation === "quick-note") {
      const note = readText(formData, "note");
      const files = formData
        .getAll("files")
        .filter((value): value is File => value instanceof File && value.size > 0);

      if (!note && files.length === 0) {
        throw new Error("Not yazin veya en az bir dosya secin.");
      }

      if (note) {
        await prisma.$transaction([
          prisma.projectNote.create({ data: { projectId: project.id, userId: user.id, note } }),
          prisma.projectTimelineEvent.create({
            data: {
              projectId: project.id,
              userId: user.id,
              eventType: "NOTE_ADDED",
              title: "Hizli proje notu eklendi",
              description: note,
            },
          }),
        ]);
      }

      for (const file of files) {
        const upload = await saveProjectUpload(file, project.id);
        if (upload) {
          await recordProjectUpload(upload, {
            projectId: project.id,
            uploadedByUserId: user.id,
            note: note || null,
            timelineTitle: "Hizli nota dosya eklendi",
          });
        }
      }

      revalidateVisitPaths(project.id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Gecersiz islem." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Islem kaydedilemedi." },
      { status: 400 },
    );
  }
}
