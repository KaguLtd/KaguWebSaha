export const INITIAL_UPLOAD_CHUNK_BYTES = 128 * 1024;
export const MIN_UPLOAD_CHUNK_BYTES = 64 * 1024;
export const MAX_UPLOAD_CHUNK_BYTES = 1024 * 1024;
export const UPLOAD_CHUNK_TARGET_MS = 18_000;

export type AdaptiveUploadChunkState = {
  chunkBytes: number;
  bytesPerSecond?: number;
  stableAcks: number;
};

function boundedBytes(bytes: number) {
  return Math.max(MIN_UPLOAD_CHUNK_BYTES, Math.min(MAX_UPLOAD_CHUNK_BYTES,
    Math.floor(bytes / MIN_UPLOAD_CHUNK_BYTES) * MIN_UPLOAD_CHUNK_BYTES));
}

export function uploadChunkState(saved?: Partial<AdaptiveUploadChunkState>): AdaptiveUploadChunkState {
  return {
    chunkBytes: boundedBytes(Number.isFinite(saved?.chunkBytes) ? saved!.chunkBytes! : INITIAL_UPLOAD_CHUNK_BYTES),
    ...(typeof saved?.bytesPerSecond === "number" && Number.isFinite(saved.bytesPerSecond) && saved.bytesPerSecond > 0 ? { bytesPerSecond: saved.bytesPerSecond } : {}),
    stableAcks: typeof saved?.stableAcks === "number" && Number.isFinite(saved.stableAcks) ? Math.max(0, Math.min(1, Math.floor(saved.stableAcks))) : 0,
  };
}

/** elapsedMs includes the full acknowledged response, including JSON decoding. */
export function acknowledgeUploadChunk(saved: AdaptiveUploadChunkState, bytes: number, elapsedMs: number): AdaptiveUploadChunkState {
  const state = uploadChunkState(saved);
  if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return state;
  const measured = bytes / (elapsedMs / 1000);
  const bytesPerSecond = state.bytesPerSecond === undefined ? measured : state.bytesPerSecond * 0.65 + measured * 0.35;
  // A slow ACK must reduce immediately, even after earlier fast samples.
  const estimate = elapsedMs > 20_000 ? Math.min(measured, bytesPerSecond) : bytesPerSecond;
  const target = boundedBytes(estimate * (UPLOAD_CHUNK_TARGET_MS / 1000));
  if (target < state.chunkBytes) return { chunkBytes: target, bytesPerSecond, stableAcks: 0 };
  // A tiny final remainder is not sufficient evidence to grow the next transfer.
  const stableAcks = bytes >= state.chunkBytes && elapsedMs < 15_000 ? state.stableAcks + 1 : 0;
  if (target > state.chunkBytes && stableAcks >= 2) {
    return { chunkBytes: Math.min(target, state.chunkBytes * 2), bytesPerSecond, stableAcks: 0 };
  }
  return { ...state, bytesPerSecond, stableAcks: Math.min(stableAcks, 1) };
}

export function shrinkUploadChunk(saved?: AdaptiveUploadChunkState): AdaptiveUploadChunkState {
  const state = uploadChunkState(saved);
  // Discard fast measurements so the first recovered ACK cannot restore an unsafe size.
  return { chunkBytes: boundedBytes(state.chunkBytes / 2), stableAcks: 0 };
}
