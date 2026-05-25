import { PrismaClient } from "@prisma/client";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const prisma = new PrismaClient();

const COMPRESSIBLE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const COMPRESSIBLE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const HEIC_EXTENSIONS = new Set([".heic", ".heif"]);
const DEFAULT_UPLOAD_DIR = "uploads";
const MIN_BYTES = 1.5 * 1024 * 1024;
const MAX_LONG_EDGE_PX = 1920;
const JPEG_QUALITY = 85;

const options = parseArgs(process.argv.slice(2));

function parseArgs(args) {
  const parsed = {
    dryRun: true,
    limit: null,
    minBytes: MIN_BYTES,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--write") {
      parsed.dryRun = false;
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--limit") {
      parsed.limit = parsePositiveInteger(args[index + 1], "--limit");
      index += 1;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      parsed.limit = parsePositiveInteger(arg.slice("--limit=".length), "--limit");
      continue;
    }

    if (arg === "--min-bytes") {
      parsed.minBytes = parsePositiveInteger(args[index + 1], "--min-bytes");
      index += 1;
      continue;
    }

    if (arg.startsWith("--min-bytes=")) {
      parsed.minBytes = parsePositiveInteger(
        arg.slice("--min-bytes=".length),
        "--min-bytes",
      );
      continue;
    }

    throw new Error(`Bilinmeyen arguman: ${arg}`);
  }

  return parsed;
}

function parsePositiveInteger(value, name) {
  const number = Number(value);

  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${name} pozitif bir tam sayi olmali.`);
  }

  return number;
}

function getUploadRoot() {
  const uploadDir = process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;

  return path.resolve(process.cwd(), uploadDir);
}

function resolveStoragePath(uploadRoot, storagePath) {
  const absolutePath = path.resolve(uploadRoot, storagePath);

  if (!absolutePath.startsWith(uploadRoot + path.sep)) {
    throw new Error(`Gecersiz storage path: ${storagePath}`);
  }

  return absolutePath;
}

function getJpegFileName(fileName) {
  const parsed = path.parse(fileName);
  const baseName = parsed.name || "upload";

  return `${baseName}.jpg`;
}

function isCompressibleProjectFile(file) {
  const mimeType = file.mimeType.toLowerCase();
  const originalExtension = path.extname(file.originalName).toLowerCase();
  const storageExtension = path.extname(file.storagePath).toLowerCase();

  if (
    HEIC_MIME_TYPES.has(mimeType) ||
    HEIC_EXTENSIONS.has(originalExtension) ||
    HEIC_EXTENSIONS.has(storageExtension)
  ) {
    return false;
  }

  return (
    COMPRESSIBLE_MIME_TYPES.has(mimeType) ||
    COMPRESSIBLE_EXTENSIONS.has(originalExtension) ||
    COMPRESSIBLE_EXTENSIONS.has(storageExtension)
  );
}

async function compressBuffer(buffer) {
  return sharp(buffer, {
    animated: false,
    failOn: "none",
  })
    .rotate()
    .resize({
      fit: "inside",
      height: MAX_LONG_EDGE_PX,
      width: MAX_LONG_EDGE_PX,
      withoutEnlargement: true,
    })
    .jpeg({
      mozjpeg: true,
      quality: JPEG_QUALITY,
    })
    .toBuffer();
}

async function writeFileAtomically(targetPath, buffer) {
  await mkdir(path.dirname(targetPath), {
    recursive: true,
  });

  const tempPath = `${targetPath}.compressing-${Date.now()}-${process.pid}.tmp`;

  await writeFile(tempPath, buffer);
  await rename(tempPath, targetPath);
}

async function main() {
  const uploadRoot = getUploadRoot();
  const files = await prisma.projectFile.findMany({
    where: {
      sizeBytes: {
        gt: options.minBytes,
      },
      OR: [
        {
          mimeType: {
            in: Array.from(COMPRESSIBLE_MIME_TYPES),
          },
        },
        ...Array.from(COMPRESSIBLE_EXTENSIONS).flatMap((extension) => [
          {
            originalName: {
              endsWith: extension,
              mode: "insensitive",
            },
          },
          {
            storagePath: {
              endsWith: extension,
              mode: "insensitive",
            },
          },
        ]),
      ],
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      createdAt: true,
      id: true,
      mimeType: true,
      originalName: true,
      sizeBytes: true,
      storagePath: true,
    },
    ...(options.limit ? { take: options.limit } : {}),
  });

  let compressedCount = 0;
  let failedCount = 0;
  let savedBytes = 0;
  let skippedCount = 0;

  console.log(
    `Existing image compression ${options.dryRun ? "dry run" : "write"} started. Candidates: ${files.length}.`,
  );
  console.log(
    `Rules: min ${(options.minBytes / (1024 * 1024)).toFixed(2)} MB, max edge ${MAX_LONG_EDGE_PX}px, JPEG quality ${JPEG_QUALITY}.`,
  );

  for (const file of files) {
    if (!isCompressibleProjectFile(file)) {
      skippedCount += 1;
      continue;
    }

    const absolutePath = resolveStoragePath(uploadRoot, file.storagePath);

    try {
      const sourceStats = await stat(absolutePath);
      const sourceBuffer = await readFile(absolutePath);
      const compressedBuffer = await compressBuffer(sourceBuffer);

      if (compressedBuffer.byteLength >= sourceBuffer.byteLength) {
        skippedCount += 1;
        console.log(
          `SKIP ${file.id} ${file.originalName}: compressed file is not smaller.`,
        );
        continue;
      }

      const nextOriginalName = getJpegFileName(file.originalName);
      const saved = sourceBuffer.byteLength - compressedBuffer.byteLength;
      savedBytes += saved;

      if (!options.dryRun) {
        await writeFileAtomically(absolutePath, compressedBuffer);
        await prisma.projectFile.update({
          where: {
            id: file.id,
          },
          data: {
            originalName: nextOriginalName,
            mimeType: "image/jpeg",
            sizeBytes: BigInt(compressedBuffer.byteLength),
          },
          select: {
            id: true,
          },
        });
      }

      compressedCount += 1;
      console.log(
        `${options.dryRun ? "WOULD_COMPRESS" : "COMPRESSED"} ${file.id} ${file.originalName}: ${formatBytes(sourceStats.size)} -> ${formatBytes(compressedBuffer.byteLength)} (${formatBytes(saved)} saved)`,
      );
    } catch (error) {
      failedCount += 1;
      console.error(
        `FAILED ${file.id} ${file.originalName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  console.log(
    `Done. ${options.dryRun ? "Would compress" : "Compressed"}: ${compressedCount}. Skipped: ${skippedCount}. Failed: ${failedCount}. Estimated saved: ${formatBytes(savedBytes)}.`,
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
