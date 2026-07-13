import type { Prisma, ProjectFile } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { readFile } from "fs/promises";
import sharp from "sharp";

import { prisma } from "@/lib/db/prisma";
import {
  buildProjectThumbnailStoragePath,
  isThumbnailSourceImage,
  removeStorageFile,
  resolveStoragePath,
  writeStorageBuffer,
} from "@/lib/files/storage";

type PrismaClientLike = typeof prisma | Prisma.TransactionClient;

type ThumbnailProjectFile = Pick<
  ProjectFile,
  | "dailyTaskId"
  | "id"
  | "mimeType"
  | "originalName"
  | "projectId"
  | "storagePath"
  | "thumbnailStoragePath"
>;

let processorRunning = false;
let recoveredInterruptedJobs = false;

export async function queueProjectFileThumbnail(
  file: ThumbnailProjectFile,
  client: PrismaClientLike = prisma,
) {
  if (
    file.thumbnailStoragePath ||
    !isThumbnailSourceImage(file.mimeType, file.originalName)
  ) {
    return;
  }

  const existingJob = await client.imageThumbnailJob.findFirst({
    where: {
      projectFileId: file.id,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (existingJob) {
    if (existingJob.status === "PENDING" || existingJob.status === "PROCESSING") {
      scheduleImageThumbnailProcessing();
    }

    return;
  }

  await client.imageThumbnailJob.create({
    data: {
      projectFileId: file.id,
      sourceStoragePath: file.storagePath,
      thumbnailStoragePath: buildProjectThumbnailStoragePath(
        file.projectId,
        file.originalName,
      ),
    },
  });

  scheduleImageThumbnailProcessing();
}

export async function queueMissingProjectFileThumbnails(limit = 100) {
  const files = await prisma.projectFile.findMany({
    where: {
      mimeType: {
        startsWith: "image/",
      },
      thumbnailStoragePath: null,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: limit,
  });

  for (const file of files) {
    await queueProjectFileThumbnail(file);
  }
}

export function scheduleImageThumbnailProcessing() {
  const run = () => {
    void processPendingImageThumbnails();
  };

  try {
    after(run);
  } catch {
    setImmediate(run);
  }
}

async function processPendingImageThumbnails() {
  if (processorRunning) {
    return;
  }

  processorRunning = true;

  try {
    if (!recoveredInterruptedJobs) {
      await prisma.imageThumbnailJob.updateMany({
        where: {
          status: "PROCESSING",
        },
        data: {
          status: "PENDING",
          lastError: "Önceki işlem yarıda kaldı; otomatik olarak yeniden başlatıldı.",
        },
      });
      recoveredInterruptedJobs = true;
    }

    while (true) {
      const jobs = await prisma.imageThumbnailJob.findMany({
        where: {
          status: "PENDING",
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 5,
      });

      if (jobs.length === 0) {
        return;
      }

      for (const job of jobs) {
        const claimed = await prisma.imageThumbnailJob.updateMany({
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

        await processImageThumbnailJob(job.id);
      }
    }
  } finally {
    processorRunning = false;
  }
}

async function processImageThumbnailJob(jobId: string) {
  const job = await prisma.imageThumbnailJob.findUnique({
    where: {
      id: jobId,
    },
    include: {
      projectFile: {
        select: {
          dailyTaskId: true,
          id: true,
          mimeType: true,
          originalName: true,
          projectId: true,
          thumbnailStoragePath: true,
        },
      },
    },
  });

  if (!job || job.status !== "PROCESSING") {
    return;
  }

  if (
    job.projectFile.thumbnailStoragePath ||
    !isThumbnailSourceImage(job.projectFile.mimeType, job.projectFile.originalName)
  ) {
    await prisma.imageThumbnailJob.update({
      where: {
        id: job.id,
      },
      data: {
        completedAt: new Date(),
        lastError: null,
        status: "COMPLETED",
      },
    });
    return;
  }

  let wroteThumbnail = false;

  try {
    const sourceBuffer = await readFile(resolveStoragePath(job.sourceStoragePath));
    const thumbnailBuffer = await sharp(sourceBuffer, {
      animated: false,
      failOn: "none",
    })
      .rotate()
      .resize({
        fit: "inside",
        height: 400,
        width: 400,
        withoutEnlargement: true,
      })
      .webp({
        quality: 78,
      })
      .toBuffer();

    await writeStorageBuffer(job.thumbnailStoragePath, thumbnailBuffer);
    wroteThumbnail = true;

    await prisma.$transaction(async (tx) => {
      await tx.projectFile.update({
        where: {
          id: job.projectFileId,
        },
        data: {
          thumbnailCreatedAt: new Date(),
          thumbnailMimeType: "image/webp",
          thumbnailSizeBytes: BigInt(thumbnailBuffer.byteLength),
          thumbnailStoragePath: job.thumbnailStoragePath,
        },
      });

      await tx.imageThumbnailJob.update({
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

    revalidateThumbnailPaths(job.projectFile.projectId, job.projectFile.dailyTaskId);
  } catch (error) {
    if (wroteThumbnail) {
      await removeStorageFile(job.thumbnailStoragePath).catch(() => undefined);
    }

    await prisma.imageThumbnailJob.update({
      where: {
        id: job.id,
      },
      data: {
        lastError:
          error instanceof Error ? error.message : "Thumbnail olusturulamadi.",
        status: "FAILED",
      },
    });
  }
}

function revalidateThumbnailPaths(projectId: string, dailyTaskId: string | null) {
  revalidatePath("/admin");
  revalidatePath("/admin/schedule");
  revalidatePath("/admin/visits");
  revalidatePath(`/admin/visits/${projectId}`);
  revalidatePath("/personnel");
  revalidatePath(`/admin/projects/${projectId}`);

  if (dailyTaskId) {
    revalidatePath(`/admin/schedule/tasks/${dailyTaskId}`);
    revalidatePath(`/personnel/tasks/${dailyTaskId}`);
  }
}
