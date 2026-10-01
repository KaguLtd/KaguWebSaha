import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { recordProjectUpload, scheduleHeicConversionProcessing } from "@/lib/files/heic-conversion-jobs";
import { scheduleImageThumbnailProcessing } from "@/lib/files/image-thumbnail-jobs";
import { prepareStoredProjectUpload, removeStorageFile } from "@/lib/files/storage";
import { UploadProtocolError } from "@/lib/uploads/protocol";
import { ensureOpenUpload, ownedUpload, uploadError, uploadStatus, uploadUser, withUploadLock } from "@/lib/uploads/server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  try {
    const user = await uploadUser(request);
    const { uploadId } = await context.params;
    const existing = await ownedUpload(uploadId, user);
    if (existing.status === "COMPLETED") return NextResponse.json(uploadStatus(existing));
    const result = await withUploadLock(uploadId, user, async (session, tx) => {
      if (session.status === "COMPLETED") return { session, cleanup: false };
      ensureOpenUpload(session);
      if (session.offsetBytes !== session.sizeBytes) throw new UploadProtocolError("Dosya aktarimi tamamlanmadi.", 409, Number(session.offsetBytes));
      const upload = await prepareStoredProjectUpload({ name: session.originalName, type: session.mimeType, size: Number(session.sizeBytes) }, session.projectId, session.tempStoragePath, session.id);
      const recorded = await recordProjectUpload(upload, {
        projectId: session.projectId, dailyTaskId: session.dailyTaskId, projectVisitId: session.projectVisitId,
        uploadedByUserId: user.id, uploadSessionId: session.id, note: session.note,
        timelineTitle: user.role === "PERSONNEL" ? "Personel dosya ekledi" : session.projectVisitId ? "Ziyaret dosyasi eklendi" : "Proje dosyasi eklendi",
      }, tx);
      const updated = await tx.uploadSession.update({ where: { id: session.id }, data: { status: "COMPLETED", completedAt: new Date(), projectFileId: recorded.projectFileId } });
      return { session: updated, cleanup: upload.status === "ready" };
    });
    // Successful DB publication is never rolled back by cleanup or cache notification errors.
    if (result.cleanup) {
      try {
        await removeStorageFile(result.session.tempStoragePath);
        await prisma.uploadSession.update({ where: { id: uploadId }, data: { stagingCleanedAt: new Date() } });
      } catch { console.warn("[uploads] Published staging cleanup will need another attempt."); }
    }
    try {
      revalidatePath("/admin"); revalidatePath(`/admin/projects/${result.session.projectId}`);
      revalidatePath(`/admin/visits/${result.session.projectId}`); revalidatePath("/personnel");
      if (result.session.dailyTaskId) revalidatePath(`/personnel/tasks/${result.session.dailyTaskId}`);
    } catch { console.warn("[uploads] Published file cache refresh deferred."); }
    scheduleHeicConversionProcessing(); scheduleImageThumbnailProcessing();
    return NextResponse.json(uploadStatus(result.session));
  } catch (error) { return uploadError(error); }
}
