import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type WorkerHeartbeat = {
  version: 1;
  pid: number;
  startedAt: string;
  lastHeartbeatAt: string;
  lastSuccessfulBatchAt: string | null;
  state: "STARTING" | "RUNNING" | "DEGRADED" | "STOPPING";
  successfulBatches: number;
  lastBatchCount: number;
  pendingJobs: number | null;
  oldestPendingAt: string | null;
  queueObservedAt: string | null;
};

export async function writeWorkerHeartbeat(file: string, snapshot: WorkerHeartbeat) {
  if (!path.isAbsolute(file)) throw new Error("Worker heartbeat path must be absolute");
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}
