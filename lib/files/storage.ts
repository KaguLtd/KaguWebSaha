import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { Worker } from "worker_threads";

const DEFAULT_UPLOAD_DIR = "uploads";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);
const THUMBNAIL_SOURCE_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/tiff",
  "image/webp",
]);
const THUMBNAIL_SOURCE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

export type ReadyProjectUpload = {
  status: "ready";
  originalName: string;
  mimeType: string;
  sizeBytes: bigint;
  storagePath: string;
};

export type PendingHeicProjectUpload = {
  status: "pending-heic";
  originalName: string;
  targetName: string;
  sizeBytes: bigint;
  tempStoragePath: string;
  targetStoragePath: string;
};

export type ProjectUploadResult = ReadyProjectUpload | PendingHeicProjectUpload;

function getUploadRoot() {
  const uploadDir = process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;

  return path.resolve(process.cwd(), uploadDir);
}

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function isHeicUpload(file: File, originalName: string, buffer: Buffer) {
  const mimeType = file.type.toLowerCase();
  const extension = path.extname(originalName).toLowerCase();

  return (
    HEIC_MIME_TYPES.has(mimeType) ||
    extension === ".heic" ||
    extension === ".heif" ||
    hasHeicBrand(buffer)
  );
}

function hasHeicBrand(buffer: Buffer) {
  if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") {
    return false;
  }

  for (let offset = 8; offset + 4 <= Math.min(buffer.length, 32); offset += 4) {
    if (HEIC_BRANDS.has(buffer.toString("ascii", offset, offset + 4))) {
      return true;
    }
  }

  return false;
}

function toJpegFileName(fileName: string) {
  const parsed = path.parse(fileName);
  const baseName = parsed.name || "upload";

  return `${baseName}.jpg`;
}

function buildStoragePath(rootFolder: string, projectId: string, fileName: string) {
  const safeName = sanitizeFileName(fileName) || "upload";
  const storedName = `${randomUUID()}-${safeName}`;

  return path.join(rootFolder, projectId, storedName).replace(/\\/g, "/");
}

export function buildProjectStoragePath(projectId: string, fileName: string) {
  return buildStoragePath("projects", projectId, fileName);
}

export function buildProjectThumbnailStoragePath(projectId: string, fileName: string) {
  const parsed = path.parse(fileName);
  const baseName = parsed.name || "thumbnail";

  return buildStoragePath("thumbnails/projects", projectId, `${baseName}.webp`);
}

function buildPendingHeicStoragePath(projectId: string, fileName: string) {
  return buildStoragePath("pending-heic/projects", projectId, fileName);
}

export async function convertHeicToJpeg(buffer: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const worker = new Worker(
      `
        const { parentPort, workerData } = require("worker_threads");
        const convert = require("heic-convert");

        (async () => {
          const output = await convert({
            buffer: Buffer.from(workerData.buffer),
            format: "JPEG",
            quality: 0.92,
          });

          parentPort.postMessage(Buffer.from(output));
        })().catch((error) => {
          parentPort.postMessage({
            error: error instanceof Error ? error.message : "HEIC dosyasi JPEG'e donusturulemedi.",
          });
        });
      `,
      {
        eval: true,
        workerData: {
          buffer,
        },
      },
    );

    worker.once("message", (message: Buffer | Uint8Array | { error: string }) => {
      if (message && typeof message === "object" && "error" in message) {
        reject(new Error(message.error));
        return;
      }

      resolve(Buffer.from(message));
    });

    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error("HEIC donusturme islemi tamamlanamadi."));
      }
    });
  });
}

export async function writeStorageBuffer(storagePath: string, buffer: Buffer) {
  const absolutePath = resolveStoragePath(storagePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);
}

export async function removeStorageFile(storagePath: string) {
  try {
    await unlink(resolveStoragePath(storagePath));
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

export async function saveProjectUpload(file: File, projectId: string): Promise<ProjectUploadResult | null> {
  if (file.size <= 0) {
    return null;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Dosya boyutu 100 MB limitini asamaz.");
  }

  let originalName = file.name || "upload";
  const fileBuffer: Buffer<ArrayBufferLike> = Buffer.from(await file.arrayBuffer());

  if (isHeicUpload(file, originalName, fileBuffer)) {
    const tempStoragePath = buildPendingHeicStoragePath(projectId, originalName);
    const targetName = toJpegFileName(originalName);
    const targetStoragePath = buildProjectStoragePath(projectId, targetName);

    await writeStorageBuffer(tempStoragePath, fileBuffer);

    return {
      status: "pending-heic",
      originalName,
      targetName,
      sizeBytes: BigInt(fileBuffer.byteLength),
      tempStoragePath,
      targetStoragePath,
    };
  }

  const storagePath = buildProjectStoragePath(projectId, originalName);

  await writeStorageBuffer(storagePath, fileBuffer);

  return {
    status: "ready",
    originalName,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: BigInt(fileBuffer.byteLength),
    storagePath,
  };
}

export function isThumbnailSourceImage(mimeType: string, fileName: string) {
  const normalizedMimeType = mimeType.toLowerCase();
  const extension = path.extname(fileName).toLowerCase();

  if (HEIC_MIME_TYPES.has(normalizedMimeType) || extension === ".heic" || extension === ".heif") {
    return false;
  }

  return (
    THUMBNAIL_SOURCE_MIME_TYPES.has(normalizedMimeType) ||
    THUMBNAIL_SOURCE_EXTENSIONS.has(extension)
  );
}

export function resolveStoragePath(storagePath: string) {
  const uploadRoot = getUploadRoot();
  const absolutePath = path.resolve(uploadRoot, storagePath);

  if (!absolutePath.startsWith(uploadRoot + path.sep)) {
    throw new Error("Gecersiz dosya yolu.");
  }

  return absolutePath;
}

export function formatFileSize(sizeBytes: bigint | number) {
  const size = Number(sizeBytes);

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
