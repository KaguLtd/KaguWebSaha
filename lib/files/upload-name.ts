const extensions: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic",
  "image/heif": ".heif", "image/gif": ".gif", "image/avif": ".avif", "video/mp4": ".mp4",
};

/** Stable per-upload names, including camera Blobs with no extension. */
export function uniqueUploadName(name: string, mimeType: string, id: string, visit = false) {
  const leaf = name.split(/[\\/]/).pop() || "image";
  const dot = leaf.lastIndexOf(".");
  const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
  const extension = dot > 0 ? leaf.slice(dot) : extensions[mimeType.toLowerCase()] || "";
  if (!visit && !/^(image|blob|upload|foto|photo)$/i.test(stem)) return leaf;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${visit ? "ziyaret" : "dosya"}-${stem}-${safeId}${extension}`;
}
