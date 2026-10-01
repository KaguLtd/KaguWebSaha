import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { removeStorageFile, resolveStoragePath } from "@/lib/files/storage";
import { writeUploadChunk } from "@/lib/uploads/chunk-storage";
import { parseUploadOffset, readUploadChunk, UploadProtocolError, validateChunkPosition } from "@/lib/uploads/protocol";
import { ensureOpenUpload, ownedUpload, renewedUploadExpiry, uploadError, uploadStatus, uploadUser, withUploadLock } from "@/lib/uploads/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ uploadId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await uploadUser(request);
    const { uploadId } = await context.params;
    return NextResponse.json(uploadStatus(await ownedUpload(uploadId, user)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return uploadError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await uploadUser(request);
    const { uploadId } = await context.params;
    await ownedUpload(uploadId, user);
    const offset = parseUploadOffset(request.headers.get("upload-offset"));
    const bytes = await readUploadChunk(request);
    const result = await withUploadLock(uploadId, user, async (session, tx) => {
      ensureOpenUpload(session);
      const committed = Number(session.offsetBytes);
      validateChunkPosition(offset, bytes.length, committed, Number(session.sizeBytes));
      const nextOffset = await writeUploadChunk(resolveStoragePath(session.tempStoragePath), offset, bytes, committed);
      const updated = await tx.uploadSession.update({ where: { id: uploadId }, data: { offsetBytes: BigInt(nextOffset), expiresAt: renewedUploadExpiry() } });
      return uploadStatus(updated);
    });
    return NextResponse.json(result, { headers: { "Upload-Offset": String(result.offsetBytes) } });
  } catch (error) { return uploadError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await uploadUser(request);
    const { uploadId } = await context.params;
    const result = await withUploadLock(uploadId, user, async (session, tx) => {
      if (session.status === "COMPLETED") throw new UploadProtocolError("Kaydedilmis dosya bu islemle silinemez.", 409);
      const updated = await tx.uploadSession.update({ where: { id: uploadId }, data: { status: "CANCELLED" } });
      return { session: updated, storagePath: session.tempStoragePath };
    });
    try {
      await removeStorageFile(result.storagePath);
      await prisma.uploadSession.update({ where: { id: uploadId }, data: { stagingCleanedAt: new Date() } });
    } catch { console.warn("[uploads] Cancelled staging cleanup will need another attempt."); }
    return NextResponse.json(uploadStatus(result.session));
  } catch (error) { return uploadError(error); }
}
