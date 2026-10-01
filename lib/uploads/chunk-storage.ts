import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { UploadProtocolError } from "./protocol";

/** Caller holds the upload DB row lock until its offset is committed. */
export async function writeUploadChunk(absolutePath: string, offset: number, bytes: Buffer, committedOffset: number) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const handle = await open(absolutePath, "r+").catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    if (committedOffset > 0) throw new UploadProtocolError("Sunucudaki gecici dosya bulunamadi; dosyayi yeniden yukleyin.", 410, 0);
    return open(absolutePath, "w+");
  });
  try {
    const info = await handle.stat();
    if (info.size < committedOffset) throw new UploadProtocolError("Sunucudaki dosya parcasi eksik; dosyayi yeniden yukleyin.", 410, 0);
    if (offset < committedOffset) {
      const existing = Buffer.alloc(bytes.length);
      const read = await handle.read(existing, 0, existing.length, offset);
      if (read.bytesRead !== bytes.length || !existing.equals(bytes)) {
        throw new UploadProtocolError("Tekrar gonderilen dosya parcasi eslesmiyor.", 409, committedOffset);
      }
      return committedOffset;
    }
    let written = 0;
    while (written < bytes.length) {
      const result = await handle.write(bytes, written, bytes.length - written, offset + written);
      if (result.bytesWritten === 0) throw new Error("Dosya parcasi diske yazilamadi.");
      written += result.bytesWritten;
    }
    const nextOffset = offset + bytes.length;
    // Remove bytes from an interrupted, uncommitted previous attempt.
    await handle.truncate(nextOffset);
    await handle.sync();
    return nextOffset;
  } finally { await handle.close(); }
}
