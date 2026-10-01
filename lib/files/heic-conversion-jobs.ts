import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { queueProjectFileThumbnail } from "./image-thumbnail-jobs";
import { processHeicJobs } from "./media-processing";
import type { ProjectUploadResult } from "./storage";

type Client = typeof prisma | Prisma.TransactionClient;
type UploadContext = {
  dailyTaskId?: string | null;
  projectVisitId?: string | null;
  uploadSessionId?: string | null;
  note?: string | null;
  projectId: string;
  timelineTitle: string;
  uploadedByUserId: string;
};
let processing = false;

export async function recordProjectUpload(upload: ProjectUploadResult, context: UploadContext, client: Client = prisma) {
  if (upload.status === "ready") {
    const file = await client.projectFile.create({ data: {
      projectId: context.projectId, dailyTaskId: context.dailyTaskId, projectVisitId: context.projectVisitId,
      uploadSessionId: context.uploadSessionId, uploadedByUserId: context.uploadedByUserId,
      originalName: upload.originalName, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes,
      storagePath: upload.storagePath, note: context.note,
    } });
    await client.projectTimelineEvent.create({ data: {
      projectId: context.projectId, dailyTaskId: context.dailyTaskId, projectVisitId: context.projectVisitId,
      userId: context.uploadedByUserId, eventType: "FILE_ADDED", title: context.timelineTitle,
      description: upload.originalName, fileId: file.id,
    } });
    await queueProjectFileThumbnail(file, client);
    return { projectFileId: file.id, heicConversionJobId: null };
  }
  const job = await client.heicConversionJob.create({ data: {
    projectId: context.projectId, dailyTaskId: context.dailyTaskId, projectVisitId: context.projectVisitId,
    uploadSessionId: context.uploadSessionId, uploadedByUserId: context.uploadedByUserId,
    originalName: upload.originalName, targetName: upload.targetName,
    tempStoragePath: upload.tempStoragePath, targetStoragePath: upload.targetStoragePath,
    note: context.note, timelineTitle: context.timelineTitle,
  } });
  scheduleHeicConversionProcessing();
  return { projectFileId: null, heicConversionJobId: job.id };
}

export function scheduleHeicConversionProcessing() {
  if (process.env.MEDIA_WORKER_MODE === "external") return;
  const run = () => {
    if (processing) return;
    processing = true;
    void processHeicJobs(3, ({ projectId, dailyTaskId }) => {
      for (const route of ["/admin", "/admin/schedule", "/admin/visits", "/admin/reports", "/personnel", `/admin/visits/${projectId}`, `/admin/projects/${projectId}`]) revalidatePath(route);
      if (dailyTaskId) {
        revalidatePath(`/admin/schedule/tasks/${dailyTaskId}`);
        revalidatePath(`/personnel/tasks/${dailyTaskId}`);
      }
    }).catch(() => console.warn("[media-worker] HEIC batch could not run."))
      .finally(() => { processing = false; });
  };
  try { after(run); } catch { setImmediate(run); }
}
