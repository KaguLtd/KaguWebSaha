import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

function getUploadRoot() {
  const uploadDir = process.env.UPLOAD_DIR || "uploads";

  return path.resolve(process.cwd(), uploadDir);
}

function sanitizeFileName(fileName) {
  return (
    fileName
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 120) || "upload"
  );
}

function buildStoragePath(rootFolder, projectId, fileName) {
  return path
    .join(rootFolder, projectId, `${randomUUID()}-${sanitizeFileName(fileName)}`)
    .replace(/\\/g, "/");
}

function isHeicProjectFile(file) {
  const mimeType = file.mimeType.toLowerCase();
  const extension = path.extname(file.originalName).toLowerCase();

  return HEIC_MIME_TYPES.has(mimeType) || extension === ".heic" || extension === ".heif";
}

function toJpegFileName(fileName) {
  const parsed = path.parse(fileName);
  const baseName = parsed.name || "upload";

  return `${baseName}.jpg`;
}

async function main() {
  const uploadRoot = getUploadRoot();
  const files = await prisma.projectFile.findMany({
    where: {
      OR: [
        {
          mimeType: {
            in: Array.from(HEIC_MIME_TYPES),
          },
        },
        {
          originalName: {
            endsWith: ".heic",
            mode: "insensitive",
          },
        },
        {
          originalName: {
            endsWith: ".heif",
            mode: "insensitive",
          },
        },
      ],
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  let queuedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    if (!isHeicProjectFile(file)) {
      skippedCount++;
      continue;
    }

    const targetName = toJpegFileName(file.originalName);
    const existingConvertedFile = await prisma.projectFile.findFirst({
      where: {
        projectId: file.projectId,
        dailyTaskId: file.dailyTaskId,
        uploadedByUserId: file.uploadedByUserId,
        originalName: targetName,
        mimeType: "image/jpeg",
      },
      select: {
        id: true,
      },
    });

    if (existingConvertedFile) {
      skippedCount++;
      continue;
    }

    const existingJob = await prisma.heicConversionJob.findFirst({
      where: {
        projectId: file.projectId,
        dailyTaskId: file.dailyTaskId,
        uploadedByUserId: file.uploadedByUserId,
        originalName: file.originalName,
        targetName,
        status: {
          in: ["PENDING", "PROCESSING", "COMPLETED"],
        },
      },
      select: {
        id: true,
      },
    });

    if (existingJob) {
      skippedCount++;
      continue;
    }

    const tempStoragePath = buildStoragePath(
      "pending-heic/projects",
      file.projectId,
      file.originalName,
    );
    const targetStoragePath = buildStoragePath("projects", file.projectId, targetName);
    const sourcePath = path.join(uploadRoot, file.storagePath);
    const tempPath = path.join(uploadRoot, tempStoragePath);

    await mkdir(path.dirname(tempPath), {
      recursive: true,
    });
    await copyFile(sourcePath, tempPath);

    await prisma.heicConversionJob.create({
      data: {
        projectId: file.projectId,
        dailyTaskId: file.dailyTaskId,
        uploadedByUserId: file.uploadedByUserId,
        originalName: file.originalName,
        targetName,
        tempStoragePath,
        targetStoragePath,
        note: file.note,
        timelineTitle: "HEIC JPEG'e donusturuldu",
      },
    });

    queuedCount++;
  }

  console.log(`Existing HEIC queue complete. Queued: ${queuedCount}. Skipped: ${skippedCount}.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
