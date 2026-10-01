import { prisma } from "../lib/db/prisma";
import { processMediaJobs } from "../lib/files/media-processing";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function run() {
  while (!stopping) {
    try {
      const processed = await processMediaJobs();
      if (processed === 0) await new Promise((resolve) => setTimeout(resolve, 5_000));
    } catch {
      console.warn("[media-worker] Batch unavailable; retrying shortly.");
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

void run().finally(() => prisma.$disconnect());
