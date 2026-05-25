import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { readFile } from "fs/promises";

import { prisma } from "@/lib/db/prisma";
import { queueProjectFileThumbnail } from "@/lib/files/image-thumbnail-jobs";
import {
  convertHeicToJpeg,
  removeStorageFile,
  resolveStoragePath,
  type ProjectUploadResult,
  writeStorageBuffer,
} from "@/lib/files/storage";

type PrismaClientLike = typeof prisma | Prisma.TransactionClient;

type ProjectUploadContext = {
  dailyTaskId?: string | null;
  note?: string | null;
  projectId: string;
  timelineTitle: string;
  uploadedByUserId: string;
};

let processorRunning = false;

export async function recordProjectUpload(
  upload: ProjectUploadResult,
  context: ProjectUploadContext,
  client: PrismaClientLike = prisma,
) {
  if (upload.status === "ready") {
    const projectFile = await client.projectFile.create({
      data: {
        projectId: context.projectId,
        dailyTaskId: context.dailyTaskId,
        uploadedByUserId: context.uploadedByUserId,
        originalName: upload.originalName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        storagePath: upload.storagePath,
        note: context.note,
      },
    });

    await client.projectTimelineEvent.create({
      data: {
        projectId: context.projectId,
        dailyTaskId: context.dailyTaskId,
        userId: context.uploadedByUserId,
        eventType: "FILE_ADDED",
        title: context.timelineTitle,
        description: upload.originalName,
        fileId: projectFile.id,
      },
    });

    await queueProjectFileThumbnail(projectFile, client);

    return;
  }

  await client.heicConversionJob.create({
    data: {
      projectId: context.projectId,
      dailyTaskId: context.dailyTaskId,
      uploadedByUserId: context.uploadedByUserId,
      originalName: upload.originalName,
      targetName: upload.targetName,
      tempStoragePath: upload.tempStoragePath,
      targetStoragePath: upload.targetStoragePath,
      note: context.note,
      timelineTitle: context.timelineTitle,
    },
  });

  scheduleHeicConversionProcessing();
}

export function scheduleHeicConversionProcessing() {
  const run = () => {
    void processPendingHeicConversions();
  };

  try {
    after(run);
  } catch {
    setImmediate(run);
  }
}

async function processPendingHeicConversions() {
  if (processorRunning) {
    return;
  }

  processorRunning = true;

  try {
    while (true) {
      const jobs = await prisma.heicConversionJob.findMany({
        where: {
          status: "PENDING",
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 3,
      });

      if (jobs.length === 0) {
        return;
      }

      for (const job of jobs) {
        const claimed = await prisma.heicConversionJob.updateMany({
          where: {
            id: job.id,
            status: "PENDING",
          },
          data: {
            attempts: {
              increment: 1,
            },
            lastError: null,
            status: "PROCESSING",
          },
        });

        if (claimed.count === 0) {
          continue;
        }

        await processHeicConversionJob(job.id);
      }
    }
  } finally {
    processorRunning = false;
  }
}

async function processHeicConversionJob(jobId: string) {
  const job = await prisma.heicConversionJob.findUnique({
    where: {
      id: jobId,
    },
  });

  if (!job || job.status !== "PROCESSING") {
    return;
  }

  let wroteJpeg = false;

  try {
    const heicBuffer = await readFile(resolveStoragePath(job.tempStoragePath));
    const jpegBuffer = await convertHeicToJpeg(heicBuffer);

    await writeStorageBuffer(job.targetStoragePath, jpegBuffer);
    wroteJpeg = true;

    await prisma.$transaction(async (tx) => {
      const projectFile = await tx.projectFile.create({
        data: {
          projectId: job.projectId,
          dailyTaskId: job.dailyTaskId,
          uploadedByUserId: job.uploadedByUserId,
          originalName: job.targetName,
          mimeType: "image/jpeg",
          sizeBytes: BigInt(jpegBuffer.byteLength),
          storagePath: job.targetStoragePath,
          note: job.note,
        },
      });

      await tx.projectTimelineEvent.create({
        data: {
          projectId: job.projectId,
          dailyTaskId: job.dailyTaskId,
          userId: job.uploadedByUserId,
          eventType: "FILE_ADDED",
          title: job.timelineTitle,
          description: job.targetName,
          fileId: projectFile.id,
        },
      });

      await queueProjectFileThumbnail(projectFile, tx);

      await tx.heicConversionJob.update({
        where: {
          id: job.id,
        },
        data: {
          completedAt: new Date(),
          lastError: null,
          status: "COMPLETED",
        },
      });
    });

    await removeStorageFile(job.tempStoragePath);
    revalidateConvertedPaths(job.projectId, job.dailyTaskId);
  } catch (error) {
    if (wroteJpeg) {
      await removeStorageFile(job.targetStoragePath).catch(() => undefined);
    }

    await prisma.heicConversionJob.update({
      where: {
        id: job.id,
      },
      data: {
        lastError: error instanceof Error ? error.message : "HEIC dosyasi JPEG'e donusturulemedi.",
        status: "FAILED",
      },
    });
  }
}

function revalidateConvertedPaths(projectId: string, dailyTaskId: string | null) {
  revalidatePath("/admin");
  revalidatePath("/admin/schedule");
  revalidatePath("/personnel");
  revalidatePath(`/admin/projects/${projectId}`);

  if (dailyTaskId) {
    revalidatePath(`/admin/schedule/tasks/${dailyTaskId}`);
    revalidatePath(`/personnel/tasks/${dailyTaskId}`);
  }
}
