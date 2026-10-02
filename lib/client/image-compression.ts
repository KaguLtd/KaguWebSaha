"use client";

const COMPRESSIBLE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const COMPRESSIBLE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_ORIGINAL_SIZE_BYTES = 1.5 * 1024 * 1024;
const MAX_LONG_EDGE_PX = 1920;
const JPEG_QUALITY = 0.85;

export function isCompressibleImage(file: File): boolean {
  const type = file.type.toLowerCase();
  const extension = getFileExtension(file.name);

  return COMPRESSIBLE_MIME_TYPES.has(type) || COMPRESSIBLE_EXTENSIONS.has(extension);
}

export async function compressImageFile(file: File): Promise<File> {
  if (!isCompressibleImage(file) || file.size <= MAX_ORIGINAL_SIZE_BYTES) {
    return file;
  }

  try {
    const bitmap = await decodeImage(file);
    const { width, height } = getTargetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      closeImage(bitmap);
      return file;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    closeImage(bitmap);

    const blob = await canvasToJpegBlob(canvas);
    if (!blob) {
      return file;
    }

    const compressedFile = new File([blob], getJpegFileName(file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });

    return compressedFile.size < file.size ? compressedFile : file;
  } catch {
    return file;
  }
}

export async function prepareFilesForUpload(files: File[], signal?: AbortSignal): Promise<File[]> {
  const preparedFiles: File[] = [];

  for (const file of files) {
    signal?.throwIfAborted();
    // Some mobile browsers never resolve image decoding/canvas conversion.
    // Keep the original if preparation stalls, and allow the user to stop it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    try {
      const fallback = new Promise<File>((resolve, reject) => {
        timer = setTimeout(() => resolve(file), 20_000);
        abort = () => reject(new Error("Gönderim durduruldu."));
        signal?.addEventListener("abort", abort, { once: true });
      });
      preparedFiles.push(await Promise.race([compressImageFile(file), fallback]));
      signal?.throwIfAborted();
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }

  return preparedFiles;
}

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? "" : fileName.slice(dotIndex).toLowerCase();
}

function getJpegFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
  return `${baseName || "image"}.jpg`;
}

function getTargetSize(width: number, height: number) {
  const longEdge = Math.max(width, height);

  if (longEdge <= MAX_LONG_EDGE_PX) {
    return { width, height };
  }

  const scale = MAX_LONG_EDGE_PX / longEdge;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return decodeImageElement(file);
    }
  }

  return decodeImageElement(file);
}

function decodeImageElement(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image decode failed"));
    };
    image.src = url;
  });
}

function closeImage(image: ImageBitmap | HTMLImageElement) {
  if ("close" in image) {
    image.close();
  }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });
}
