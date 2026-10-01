export const MEDIA_JOB_MAX_ATTEMPTS = 5;
export const MEDIA_JOB_LEASE_MS = 2 * 60_000;

export function getMediaJobFailureState(attempts: number, now = new Date()) {
  const exhausted = attempts >= MEDIA_JOB_MAX_ATTEMPTS;
  const delayMs = Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));
  return {
    status: exhausted ? ("FAILED" as const) : ("PENDING" as const),
    nextAttemptAt: new Date(now.getTime() + delayMs),
    lockedBy: null,
    lockedUntil: null,
  };
}

/** A published file must survive cleanup/cache errors after its DB commit. */
export async function finishMediaPublication<T>(options: {
  commit: () => Promise<T>;
  cleanup?: () => Promise<unknown>;
  notify?: () => Promise<unknown> | unknown;
  onPostCommitError?: (stage: "cleanup" | "notify") => void;
}) {
  const result = await options.commit();
  for (const stage of ["cleanup", "notify"] as const) {
    try {
      await options[stage]?.();
    } catch {
      options.onPostCommitError?.(stage);
    }
  }
  return result;
}
