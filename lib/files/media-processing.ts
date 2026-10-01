import type { Prisma, ProjectFile } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFile, rename, stat } from "node:fs/promises";
import sharp from "sharp";
import { prisma } from "../db/prisma";
import { finishMediaPublication, getMediaJobFailureState, MEDIA_JOB_LEASE_MS, MEDIA_JOB_MAX_ATTEMPTS } from "./job-policy";
import { buildProjectThumbnailStoragePath, convertHeicToJpeg, isThumbnailSourceImage, removeStorageFile, resolveStoragePath, writeStorageBuffer } from "./storage";

type Client = typeof prisma | Prisma.TransactionClient;
type ThumbnailFile = Pick<ProjectFile, "id" | "projectId" | "dailyTaskId" | "originalName" | "mimeType" | "storagePath" | "thumbnailStoragePath">;
export type MediaCompletion = { projectId: string; dailyTaskId: string | null };
type CompletionCallback = (completed: MediaCompletion) => Promise<unknown> | unknown;

export async function createThumbnailJob(file: ThumbnailFile, client: Client = prisma) {
  if (file.thumbnailStoragePath || !isThumbnailSourceImage(file.mimeType, file.originalName)) return;
  const existing = await client.imageThumbnailJob.findFirst({ where: { projectFileId: file.id } });
  if (!existing) await client.imageThumbnailJob.create({ data: {
    projectFileId: file.id,
    sourceStoragePath: file.storagePath,
    thumbnailStoragePath: buildProjectThumbnailStoragePath(file.projectId, file.originalName),
  } });
}

function availableJobs(now: Date) {
  return {
    attempts: { lt: MEDIA_JOB_MAX_ATTEMPTS },
    OR: [
      { status: "PENDING" as const, nextAttemptAt: { lte: now } },
      { status: "PROCESSING" as const, OR: [{ lockedUntil: { lt: now } }, { lockedUntil: null }] },
    ],
  };
}

function claimData(token: string, now: Date) {
  return { status: "PROCESSING" as const, attempts: { increment: 1 }, lockedBy: token,
    lockedUntil: new Date(now.getTime() + MEDIA_JOB_LEASE_MS), lastAttemptAt: now, lastError: null };
}

function warnPostCommit(stage: "cleanup" | "notify") {
  console.warn(`[media-worker] Publication ${stage} will need another attempt.`);
}

async function heartbeat(kind: "heic" | "thumbnail", id: string, token: string) {
  const args = { where: { id, status: "PROCESSING" as const, lockedBy: token }, data: { lockedUntil: new Date(Date.now() + MEDIA_JOB_LEASE_MS) } };
  return kind === "heic" ? prisma.heicConversionJob.updateMany(args) : prisma.imageThumbnailJob.updateMany(args);
}

async function withHeartbeat<T>(kind: "heic" | "thumbnail", id: string, token: string, run: () => Promise<T>) {
  const timer = setInterval(() => {
    void heartbeat(kind, id, token).catch(() => console.warn("[media-worker] Lease renewal failed."));
  }, MEDIA_JOB_LEASE_MS / 3);
  timer.unref();
  try { return await run(); } finally { clearInterval(timer); }
}

export async function processHeicJobs(limit = 3, notify?: CompletionCallback) {
  const now = new Date();
  await prisma.heicConversionJob.updateMany({
    where: { status: "PROCESSING", attempts: { gte: MEDIA_JOB_MAX_ATTEMPTS }, OR: [{ lockedUntil: { lt: now } }, { lockedUntil: null }] },
    data: { status: "FAILED", lockedBy: null, lockedUntil: null, lastError: "Islem yeniden deneme sinirina ulasti." },
  });
  const candidates = await prisma.heicConversionJob.findMany({ where: availableJobs(now), orderBy: { createdAt: "asc" }, take: limit });
  let processed = 0;
  for (const candidate of candidates) {
    const token = randomUUID();
    const claimed = await prisma.heicConversionJob.updateMany({ where: { id: candidate.id, ...availableJobs(new Date()) }, data: claimData(token, new Date()) });
    if (claimed.count !== 1) continue;
    processed += 1;
    await withHeartbeat("heic", candidate.id, token, () => processHeicJob(candidate.id, token, notify));
  }
  return processed;
}

async function processHeicJob(id: string, token: string, notify?: CompletionCallback) {
  const job = await prisma.heicConversionJob.findUnique({ where: { id } });
  if (!job || job.lockedBy !== token || job.status !== "PROCESSING") return;
  const stagingPath = `${job.targetStoragePath}.${token}.tmp`;
  try {
    const output = await convertHeicToJpeg(await readFile(resolveStoragePath(job.tempStoragePath)));
    await writeStorageBuffer(stagingPath, output);
    await finishMediaPublication({
      commit: () => prisma.$transaction(async (tx) => {
        // Locks this row until commit and fences out a stale claim owner.
        const owned = await tx.heicConversionJob.updateMany({ where: { id, status: "PROCESSING", lockedBy: token }, data: { lockedUntil: new Date(Date.now() + MEDIA_JOB_LEASE_MS) } });
        if (owned.count !== 1) throw new Error("Is kilidi baska bir isleyiciye aktarildi.");
        await rename(resolveStoragePath(stagingPath), resolveStoragePath(job.targetStoragePath));
        const file = await tx.projectFile.create({ data: {
          projectId: job.projectId, dailyTaskId: job.dailyTaskId, projectVisitId: job.projectVisitId,
          uploadedByUserId: job.uploadedByUserId, uploadSessionId: job.uploadSessionId,
          originalName: job.targetName, mimeType: "image/jpeg", sizeBytes: BigInt(output.byteLength),
          storagePath: job.targetStoragePath, note: job.note,
        } });
        await tx.projectTimelineEvent.create({ data: {
          projectId: job.projectId, dailyTaskId: job.dailyTaskId, projectVisitId: job.projectVisitId,
          userId: job.uploadedByUserId, eventType: "FILE_ADDED", title: job.timelineTitle,
          description: job.targetName, fileId: file.id,
        } });
        await createThumbnailJob(file, tx);
        if (job.uploadSessionId) await tx.uploadSession.updateMany({ where: { id: job.uploadSessionId }, data: { projectFileId: file.id } });
        await tx.heicConversionJob.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date(), lastError: null, lockedBy: null, lockedUntil: null } });
      }),
      cleanup: async () => {
        await removeStorageFile(job.tempStoragePath);
        await prisma.heicConversionJob.update({ where: { id }, data: { stagingCleanedAt: new Date() } });
        if (job.uploadSessionId) await prisma.uploadSession.updateMany({ where: { id: job.uploadSessionId }, data: { stagingCleanedAt: new Date() } });
      },
      notify: () => notify?.({ projectId: job.projectId, dailyTaskId: job.dailyTaskId }),
      onPostCommitError: warnPostCommit,
    });
  } catch {
    // A published target survives every post-commit failure; only private staging is disposable.
    await removeStorageFile(stagingPath).catch(() => undefined);
    await prisma.heicConversionJob.updateMany({ where: { id, status: "PROCESSING", lockedBy: token }, data: {
      ...getMediaJobFailureState(job.attempts), lastError: "HEIC donusturme basarisiz; kaynak dosya korundu.",
    } });
  }
}

export async function processThumbnailJobs(limit = 5, notify?: CompletionCallback) {
  const now = new Date();
  await prisma.imageThumbnailJob.updateMany({
    where: { status: "PROCESSING", attempts: { gte: MEDIA_JOB_MAX_ATTEMPTS }, OR: [{ lockedUntil: { lt: now } }, { lockedUntil: null }] },
    data: { status: "FAILED", lockedBy: null, lockedUntil: null, lastError: "Islem yeniden deneme sinirina ulasti." },
  });
  const candidates = await prisma.imageThumbnailJob.findMany({ where: availableJobs(now), orderBy: { createdAt: "asc" }, take: limit });
  let processed = 0;
  for (const candidate of candidates) {
    const token = randomUUID();
    const claimed = await prisma.imageThumbnailJob.updateMany({ where: { id: candidate.id, ...availableJobs(new Date()) }, data: claimData(token, new Date()) });
    if (claimed.count !== 1) continue;
    processed += 1;
    await withHeartbeat("thumbnail", candidate.id, token, () => processThumbnailJob(candidate.id, token, notify));
  }
  return processed;
}

async function processThumbnailJob(id: string, token: string, notify?: CompletionCallback) {
  const job = await prisma.imageThumbnailJob.findUnique({ where: { id }, include: { projectFile: true } });
  if (!job || job.lockedBy !== token || job.status !== "PROCESSING") return;
  if (job.projectFile.thumbnailStoragePath) {
    await prisma.imageThumbnailJob.updateMany({ where: { id, lockedBy: token }, data: { status: "COMPLETED", completedAt: new Date(), lockedBy: null, lockedUntil: null } });
    return;
  }
  const stagingPath = `${job.thumbnailStoragePath}.${token}.tmp`;
  try {
    const output = await sharp(await readFile(resolveStoragePath(job.sourceStoragePath)), { animated: false, failOn: "none" })
      .rotate().resize({ fit: "inside", height: 400, width: 400, withoutEnlargement: true }).webp({ quality: 78 }).timeout({ seconds: 90 }).toBuffer();
    await writeStorageBuffer(stagingPath, output);
    await finishMediaPublication({
      commit: () => prisma.$transaction(async (tx) => {
        const owned = await tx.imageThumbnailJob.updateMany({ where: { id, status: "PROCESSING", lockedBy: token }, data: { lockedUntil: new Date(Date.now() + MEDIA_JOB_LEASE_MS) } });
        if (owned.count !== 1) throw new Error("Is kilidi baska bir isleyiciye aktarildi.");
        await rename(resolveStoragePath(stagingPath), resolveStoragePath(job.thumbnailStoragePath));
        await tx.projectFile.update({ where: { id: job.projectFileId }, data: {
          thumbnailStoragePath: job.thumbnailStoragePath, thumbnailMimeType: "image/webp",
          thumbnailSizeBytes: BigInt(output.byteLength), thumbnailCreatedAt: new Date(),
        } });
        await tx.imageThumbnailJob.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date(), lastError: null, lockedBy: null, lockedUntil: null } });
      }),
      notify: () => notify?.({ projectId: job.projectFile.projectId, dailyTaskId: job.projectFile.dailyTaskId }),
      onPostCommitError: warnPostCommit,
    });
  } catch {
    await removeStorageFile(stagingPath).catch(() => undefined);
    await prisma.imageThumbnailJob.updateMany({ where: { id, status: "PROCESSING", lockedBy: token }, data: {
      ...getMediaJobFailureState(job.attempts), lastError: "Onizleme olusturulamadi; asil dosya korundu.",
    } });
  }
}

export async function processMediaJobs() {
  const processed = await processHeicJobs() + await processThumbnailJobs();
  await cleanupCompletedHeicSources();
  await cleanupUploadStaging();
  return processed;
}

/** A failed conversion's only recoverable source is deliberately excluded. */
export async function cleanupCompletedHeicSources(limit = 25) {
  const now = new Date();
  const jobs = await prisma.heicConversionJob.findMany({
    where: { status: "COMPLETED", stagingCleanedAt: null, nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    orderBy: { updatedAt: "asc" }, take: limit,
  });
  for (const job of jobs) {
    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.heicConversionJob.updateMany({
          where: { id: job.id, status: "COMPLETED", stagingCleanedAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
          data: { lockedBy: randomUUID(), lockedUntil: new Date(Date.now() + MEDIA_JOB_LEASE_MS) },
        });
        if (claimed.count !== 1) return;
        const published = await tx.projectFile.findFirst({ where: { storagePath: job.targetStoragePath }, select: { id: true } });
        if (!published || !(await stat(resolveStoragePath(job.targetStoragePath))).isFile()) throw new Error("Published file needs inspection");
        await removeStorageFile(job.tempStoragePath);
        await tx.heicConversionJob.update({ where: { id: job.id }, data: { stagingCleanedAt: new Date(), lockedBy: null, lockedUntil: null, lastError: null } });
        if (job.uploadSessionId) await tx.uploadSession.updateMany({ where: { id: job.uploadSessionId }, data: { stagingCleanedAt: new Date() } });
      }, { timeout: 30_000 });
    } catch {
      // Keep COMPLETED; cleanup faults must never turn a published file into FAILED.
      await prisma.heicConversionJob.updateMany({ where: { id: job.id, status: "COMPLETED", stagingCleanedAt: null }, data: {
        nextAttemptAt: new Date(Date.now() + 60_000), lastError: "Gecici dosya temizligi yeniden denenecek.",
      } }).catch(() => undefined);
    }
  }
}

export async function cleanupUploadStaging(limit = 25) {
  const now = new Date();
  const retryCutoff = new Date(now.getTime() - 60_000);
  const candidates = await prisma.uploadSession.findMany({ where: {
    stagingCleanedAt: null, updatedAt: { lte: retryCutoff },
    OR: [{ status: "CANCELLED" }, { status: "COMPLETED", projectFileId: { not: null } }, { status: "OPEN", expiresAt: { lt: now } }],
    AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }],
  }, orderBy: { updatedAt: "asc" }, take: limit });
  for (const candidate of candidates) {
    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.uploadSession.updateMany({ where: {
          id: candidate.id, stagingCleanedAt: null,
          OR: [{ status: "CANCELLED" }, { status: "COMPLETED", projectFileId: { not: null } }, { status: "OPEN", expiresAt: { lt: new Date() } }],
          AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }],
        }, data: { lockedBy: randomUUID(), lockedUntil: new Date(Date.now() + MEDIA_JOB_LEASE_MS) } });
        if (claimed.count !== 1) return;
        const session = await tx.uploadSession.findUniqueOrThrow({ where: { id: candidate.id } });
        if (session.status === "COMPLETED") {
          const file = session.projectFileId ? await tx.projectFile.findUnique({ where: { id: session.projectFileId }, select: { storagePath: true } }) : null;
          if (!file || !(await stat(resolveStoragePath(file.storagePath))).isFile()) throw new Error("Published file needs inspection");
        }
        await removeStorageFile(session.tempStoragePath);
        await tx.uploadSession.update({ where: { id: session.id }, data: {
          stagingCleanedAt: new Date(), lockedBy: null, lockedUntil: null,
          ...(session.status === "OPEN" ? { status: "CANCELLED" as const } : {}),
        } });
      }, { timeout: 30_000 });
    } catch {
      // @updatedAt gives each failed cleanup a one-minute retry interval without touching expiry.
      await prisma.uploadSession.updateMany({ where: { id: candidate.id, stagingCleanedAt: null }, data: { updatedAt: new Date() } }).catch(() => undefined);
    }
  }
}
