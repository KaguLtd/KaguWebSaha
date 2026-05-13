import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const DEFAULT_UPLOAD_DIR = "uploads";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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

export async function saveProjectUpload(file: File, projectId: string) {
  if (file.size <= 0) {
    return null;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Dosya boyutu 25 MB limitini asamaz.");
  }

  const originalName = file.name || "upload";
  const safeName = sanitizeFileName(originalName) || "upload";
  const storedName = `${randomUUID()}-${safeName}`;
  const relativePath = path.join("projects", projectId, storedName);
  const uploadRoot = getUploadRoot();
  const absolutePath = path.resolve(uploadRoot, relativePath);

  if (!absolutePath.startsWith(uploadRoot + path.sep)) {
    throw new Error("Gecersiz dosya yolu.");
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

  return {
    originalName,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: BigInt(file.size),
    storagePath: relativePath.replace(/\\/g, "/"),
  };
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

