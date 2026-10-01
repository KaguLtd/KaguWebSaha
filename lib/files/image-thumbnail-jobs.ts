import type { Prisma, ProjectFile } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createThumbnailJob, processThumbnailJobs } from "./media-processing";

type Client = typeof prisma | Prisma.TransactionClient;
type ThumbnailFile = Pick<ProjectFile, "id" | "projectId" | "dailyTaskId" | "originalName" | "mimeType" | "storagePath" | "thumbnailStoragePath">;
let processing = false;

export async function queueProjectFileThumbnail(file: ThumbnailFile, client: Client = prisma) {
  await createThumbnailJob(file, client);
  scheduleImageThumbnailProcessing();
}

export async function queueMissingProjectFileThumbnails(limit = 100) {
  const files = await prisma.projectFile.findMany({
    where: { mimeType: { startsWith: "image/" }, thumbnailStoragePath: null, thumbnailJobs: { none: {} } },
    orderBy: { createdAt: "asc" }, take: limit,
  });
  for (const file of files) await queueProjectFileThumbnail(file);
}

export function scheduleImageThumbnailProcessing() {
  if (process.env.MEDIA_WORKER_MODE === "external") return;
  const run = () => {
    if (processing) return;
    processing = true;
    void processThumbnailJobs(5, ({ projectId, dailyTaskId }) => {
      for (const route of ["/admin", "/admin/schedule", "/admin/visits", "/personnel", `/admin/projects/${projectId}`, `/admin/visits/${projectId}`]) revalidatePath(route);
      if (dailyTaskId) {
        revalidatePath(`/admin/schedule/tasks/${dailyTaskId}`);
        revalidatePath(`/personnel/tasks/${dailyTaskId}`);
      }
    }).catch(() => console.warn("[media-worker] Thumbnail batch could not run."))
      .finally(() => { processing = false; });
  };
  try { after(run); } catch { setImmediate(run); }
}
