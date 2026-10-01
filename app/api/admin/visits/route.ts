import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  recordProjectUpload,
  scheduleHeicConversionProcessing,
} from "@/lib/files/heic-conversion-jobs";
import { scheduleImageThumbnailProcessing } from "@/lib/files/image-thumbnail-jobs";
import { saveProjectUpload, type ProjectUploadResult } from "@/lib/files/storage";
import { parseLatitude, parseLongitude } from "@/lib/location/google-maps";
import { runOfflineOperation } from "@/lib/offline/server-operation";
import { InputError } from "@/lib/offline/input-error";
import { canAttachToVisit } from "@/lib/visits/status";

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

function readFiles(formData: FormData) {
  return formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
}

function exceedsFileLimits(files: File[]) {
  return files.length > 20 || files.some((file) => file.size > 100 * 1024 * 1024) ||
    files.reduce((sum, file) => sum + file.size, 0) > 500 * 1024 * 1024;
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

async function readValidProjectVisit(projectVisitId: string, projectId: string, userId: string, userRole: "ADMIN" | "OBSERVER") {
  const visit = await prisma.projectVisit.findFirst({
    where: {
      id: projectVisitId,
      projectId,
    },
    select: {
      id: true,
      note: true,
      visitedByUserId: true,
    },
  });

  if (!visit) {
    throw new Error("Ziyaret kaydi bulunamadi.");
  }
  if (!canAttachToVisit(userRole, userId, visit.visitedByUserId)) {
    throw new Error("Yalnızca kendi ziyaretinize not veya dosya ekleyebilirsiniz.");
  }

  return visit;
}

function revalidateVisitPaths(projectId: string) {
  try {
    for (const route of ["/admin", "/admin/visits", `/admin/visits/${projectId}`, `/admin/projects/${projectId}`, "/admin/reports"]) revalidatePath(route);
  } catch {
    // The business transaction already committed; refresh failure is not a failed save.
    console.warn("[visits] Saved record is available; page refresh could not complete.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: false, error: "Oturum süresi doldu. Notunuz korundu; tekrar giriş yapın." }, { status: 401 });
    if (user.role !== "ADMIN" && user.role !== "OBSERVER") return NextResponse.json({ ok: false, error: "Bu işlem için yetkiniz yok." }, { status: 403 });
    const userRole = user.role;
    const formData = await request.formData();
    const ownerUserId = readText(formData, "ownerUserId");
    if (ownerUserId && ownerUserId !== user.id) return NextResponse.json({ ok: false, error: "Hesap değişti. Önceki hesabın notu korunuyor; doğru hesapla giriş yapın." }, { status: 401 });
    const operation = readRequiredText(formData, "operation");
    const projectId = readRequiredText(formData, "projectId");
    const clientItemId = readText(formData, "clientItemId");
    if (readText(formData, "note").length > 20_000) return NextResponse.json({ ok: false, error: "Not en fazla 20000 karakter olabilir." }, { status: 400 });
    const project = await requireVisitProject(projectId, userRole);

    if (operation === "file" && clientItemId) {
      const existing = await prisma.offlinePendingItem.findUnique({
        where: {
          clientItemId,
        },
        select: {
          status: true,
          userId: true,
          type: true,
          payload: true,
        },
      });

      if (existing && (existing.userId !== user.id || existing.type !== "FILE" ||
          !(existing.payload && typeof existing.payload === "object" && !Array.isArray(existing.payload) &&
            existing.payload.projectId === project.id &&
            (existing.payload.projectVisitId ?? null) === (readText(formData, "projectVisitId") || null)))) {
        throw new Error("İşlem kimliği farklı bir kayıt için kullanılmış.");
      }
      if (existing?.status === "SYNCED") {
        const projectVisitId = readText(formData, "projectVisitId") || null;
        if (projectVisitId) await readValidProjectVisit(projectVisitId, project.id, user.id, userRole);
        // V1 receipts did not retain note/file metadata. Preserve their original
        // acknowledgement without rewriting them; all new receipts are scoped below.
        return NextResponse.json({ ok: true, duplicate: true, legacyReceipt: true,
          visitId: projectVisitId });
      }
    }

    if (operation === "visit") {
      const note = readText(formData, "note");
      const { latitude, longitude } = readLocation(formData);
      const now = new Date();

      const result = await runOfflineOperation({
        userId: user.id,
        clientItemId: clientItemId || undefined,
        type: "NOTE",
        payload: { operation: "visit", projectId: project.id, note },
      }, async (tx) => {
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

        return { visitId: projectVisit.id };
      });

      revalidateVisitPaths(project.id);

      return NextResponse.json({ ok: true, visitId: result.visitId });
    }

    if (operation === "note") {
      const note = readRequiredText(formData, "note");
      const projectVisitId = readText(formData, "projectVisitId") || null;
      const visit = projectVisitId
        ? await readValidProjectVisit(projectVisitId, project.id, user.id, userRole)
        : null;

      await runOfflineOperation({
        userId: user.id,
        clientItemId: clientItemId || undefined,
        type: "NOTE",
        payload: { operation: "visit-note", projectId: project.id, projectVisitId, note },
      }, async (tx) => {
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
        return { visitId: visit?.id ?? null };
      });

      revalidateVisitPaths(project.id);

      return NextResponse.json({ ok: true, visitId: visit?.id ?? null });
    }

    if (operation === "file") {
      const note = readText(formData, "note");
      const projectVisitId = readText(formData, "projectVisitId") || null;
      const visit = projectVisitId
        ? await readValidProjectVisit(projectVisitId, project.id, user.id, userRole)
        : null;
      const files = readFiles(formData);

      if (files.length === 0) {
        throw new Error("Yuklenecek dosya secilmedi.");
      }
      if (exceedsFileLimits(files)) {
        return NextResponse.json({ ok: false, error: "Dosya sayısı veya boyutu izin verilen sınırı aşıyor." }, { status: 413 });
      }

      const result = await runOfflineOperation({
        userId: user.id, clientItemId: clientItemId || undefined, type: "FILE",
        payload: { operation: "visit-file", projectId: project.id, projectVisitId: visit?.id ?? null, note,
          files: files.map((file) => ({ name: file.name, size: file.size, type: file.type })) },
      }, async (tx) => {
        // Claim precedes disk preparation; competing retries cannot both publish.
        const uploads: ProjectUploadResult[] = [];
        for (const file of files) {
          const upload = await saveProjectUpload(file, project.id);
          if (upload) uploads.push(upload);
        }
        for (const upload of uploads) {
          await recordProjectUpload(
            upload,
            {
              projectId: project.id,
              projectVisitId: visit?.id ?? null,
              uploadedByUserId: user.id,
              note: note || null,
              timelineTitle: visit
                ? "Ziyaret dosyasi eklendi"
                : "Proje dosyasi eklendi",
            },
            tx,
          );
        }

        return { visitId: visit?.id ?? null };
      });

      scheduleHeicConversionProcessing();
      scheduleImageThumbnailProcessing();

      revalidateVisitPaths(project.id);

      return NextResponse.json({ ok: true, visitId: result.visitId });
    }

    if (operation === "quick-note") {
      const note = readText(formData, "note");
      const files = readFiles(formData);

      if (!note && files.length === 0) {
        throw new Error("Not yazin veya en az bir dosya secin.");
      }

      if (exceedsFileLimits(files)) {
        return NextResponse.json({ ok: false, error: "Dosya sayısı veya boyutu izin verilen sınırı aşıyor." }, { status: 413 });
      }
      await runOfflineOperation({
        userId: user.id, clientItemId: clientItemId || undefined, type: "NOTE",
        payload: { operation: "quick-note", projectId: project.id, note, files: files.map((file) => ({ name: file.name, size: file.size, type: file.type })) },
      }, async (tx) => {
        if (note) {
          await tx.projectNote.create({ data: { projectId: project.id, userId: user.id, note } });
          await tx.projectTimelineEvent.create({
            data: {
              projectId: project.id,
              userId: user.id,
              eventType: "NOTE_ADDED",
              title: "Hizli proje notu eklendi",
              description: note,
            },
          });
        }
        // Compatibility for already-open V1 forms. New forms use the durable media queue.
        for (const file of files) {
          const upload = await saveProjectUpload(file, project.id);
          if (upload) await recordProjectUpload(upload, { projectId: project.id, uploadedByUserId: user.id, note: note || null, timelineTitle: "Hizli nota dosya eklendi" }, tx);
        }
        return { ok: true };
      });

      revalidateVisitPaths(project.id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Gecersiz islem." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Islem kaydedilemedi.";
    const invalid = error instanceof InputError || error instanceof SyntaxError || isVisitRequestError(message);
    return NextResponse.json(
      { ok: false, error: invalid ? message : "Sunucu kaydı şu anda tamamlayamadı. Notunuzu koruyarak tekrar deneyin." },
      { status: invalid ? 400 : 503 },
    );
  }
}

function isVisitRequestError(message: string) {
  return [
    " is required",
    "Proje bulunamadi.",
    "arsiv projeye ziyaret kaydi ekleyemez.",
    "Ziyaret kaydi bulunamadi.",
    "Yalnızca kendi ziyaretinize",
    "İşlem kimliği",
    "Yuklenecek dosya secilmedi.",
    "Not yazin veya en az bir dosya secin.",
    "Dosya boyutu 100 MB limitini asamaz.",
    "Gecersiz islem.",
  ].some((expected) => message.includes(expected));
}
