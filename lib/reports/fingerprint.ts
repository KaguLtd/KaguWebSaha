import { createHash } from "node:crypto";
import type { ReportSnapshot } from "./calculations";

/** Compare the server-calculated content, excluding generation-only metadata. */
export function reportFingerprint(snapshot: ReportSnapshot): string {
  const metadata = snapshot.metadata ? { ...snapshot.metadata, readAt: undefined, reportId: undefined,
    createdByUserId: undefined, createdByName: undefined, title: undefined } : undefined;
  return createHash("sha256").update(JSON.stringify({ ...snapshot, generatedAt: undefined, metadata })).digest("hex");
}
