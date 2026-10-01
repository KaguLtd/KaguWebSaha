export const MAX_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

export class UploadProtocolError extends Error {
  constructor(message: string, public status: number, public offsetBytes?: number) {
    super(message);
  }
}

export function parseUploadOffset(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) throw new UploadProtocolError("Yukleme konumu eksik veya gecersiz.", 400);
  const offset = Number(value);
  if (!Number.isSafeInteger(offset)) throw new UploadProtocolError("Yukleme konumu gecersiz.", 400);
  return offset;
}

export function validateChunkPosition(offset: number, length: number, committedOffset: number, total: number) {
  if (length <= 0 || length > MAX_UPLOAD_CHUNK_BYTES) throw new UploadProtocolError("Dosya parcasi 2 MB sinirini asamaz veya bos olamaz.", 413, committedOffset);
  if (offset > committedOffset || (offset < committedOffset && offset + length > committedOffset)) {
    throw new UploadProtocolError("Yukleme konumu degisti; sunucu durumunu yeniden okuyun.", 409, committedOffset);
  }
  if (offset + length > total) throw new UploadProtocolError("Dosya boyutu bildirilen siniri asiyor.", 413, committedOffset);
}

export async function readUploadChunk(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new UploadProtocolError("Dosya parcasi bos.", 400);
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_UPLOAD_CHUNK_BYTES) {
        await reader.cancel();
        throw new UploadProtocolError("Dosya parcasi 2 MB sinirini asamaz.", 413);
      }
      parts.push(result.value);
    }
  } finally { reader.releaseLock(); }
  if (size === 0) throw new UploadProtocolError("Dosya parcasi bos.", 400);
  const buffer = Buffer.allocUnsafe(size);
  let position = 0;
  for (const part of parts) { buffer.set(part, position); position += part.byteLength; }
  return buffer;
}
