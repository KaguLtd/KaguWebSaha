import { prisma } from "../lib/db/prisma";
import { processMediaJobs } from "../lib/files/media-processing";
import { writeWorkerHeartbeat, type WorkerHeartbeat } from "./media-worker-monitor";
import path from "node:path";

let stopping = false;
const heartbeatFile = process.env.MEDIA_WORKER_HEARTBEAT_FILE;
if (heartbeatFile && !path.isAbsolute(heartbeatFile)) throw new Error("MEDIA_WORKER_HEARTBEAT_FILE must be absolute");
const snapshot: WorkerHeartbeat = {
  version: 1, pid: process.pid, startedAt: new Date().toISOString(), lastHeartbeatAt: new Date().toISOString(),
  lastSuccessfulBatchAt: null, state: "STARTING", successfulBatches: 0, lastBatchCount: 0,
  pendingJobs: null, oldestPendingAt: null, queueObservedAt: null,
};
function stop() { stopping = true; snapshot.state = "STOPPING"; }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
let writingHeartbeat: Promise<void> | null = null;
async function publishHeartbeat() {
  if (!heartbeatFile) return;
  if (writingHeartbeat) await writingHeartbeat;
  snapshot.lastHeartbeatAt = new Date().toISOString();
  const writing = writeWorkerHeartbeat(heartbeatFile, { ...snapshot }).catch(() => {
    console.warn("[media-worker] Heartbeat could not be written.");
  });
  writingHeartbeat = writing;
  await writing;
  if (writingHeartbeat === writing) writingHeartbeat = null;
}
let nextQueueObservation = 0;
async function observeQueue() {
  if (!heartbeatFile || Date.now() < nextQueueObservation) return;
  nextQueueObservation = Date.now() + 60_000;
  try {
    const where = { status: "PENDING" as const };
    const [heicCount, thumbnailCount, oldestHeic, oldestThumbnail] = await Promise.all([
      prisma.heicConversionJob.count({ where }), prisma.imageThumbnailJob.count({ where }),
      prisma.heicConversionJob.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.imageThumbnailJob.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);
    const dates = [oldestHeic?.createdAt, oldestThumbnail?.createdAt].filter((value): value is Date => Boolean(value));
    snapshot.pendingJobs = heicCount + thumbnailCount;
    snapshot.oldestPendingAt = dates.length ? new Date(Math.min(...dates.map((value) => value.getTime()))).toISOString() : null;
    snapshot.queueObservedAt = new Date().toISOString();
  } catch { console.warn("[media-worker] Queue observation unavailable."); }
}

async function run() {
  await publishHeartbeat();
  const heartbeatTimer = setInterval(() => { void publishHeartbeat(); }, 15_000);
  heartbeatTimer.unref();
  try {
    while (!stopping) {
      try {
        const processed = await processMediaJobs();
        snapshot.lastSuccessfulBatchAt = new Date().toISOString();
        snapshot.successfulBatches += 1;
        snapshot.lastBatchCount = processed;
        if (!stopping) snapshot.state = "RUNNING";
        await observeQueue();
        await publishHeartbeat();
        if (processed === 0 && !stopping) await new Promise((resolve) => setTimeout(resolve, 5_000));
      } catch {
        if (!stopping) snapshot.state = "DEGRADED";
        await publishHeartbeat();
        console.warn("[media-worker] Batch unavailable; retrying shortly.");
        if (!stopping) await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  } finally { clearInterval(heartbeatTimer); snapshot.state = "STOPPING"; await publishHeartbeat(); }
}

void run().finally(() => prisma.$disconnect());
