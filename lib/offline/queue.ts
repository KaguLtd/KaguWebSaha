"use client";
import { createClientId } from "@/lib/offline/client-id";
import { uniqueUploadName } from "@/lib/files/upload-name";
import { prepareFilesForUpload } from "@/lib/client/image-compression";
import { JsonRequestError, requestJson } from "@/lib/client/json-request";
import { acknowledgeUploadChunk, shrinkUploadChunk, uploadChunkState, type AdaptiveUploadChunkState } from "@/lib/client/adaptive-upload-chunks";

export type OfflineQueueKind = "PERSONNEL" | "VISIT_UPLOAD";
export type PersonnelEventType = "ARRIVED_SITE" | "LEFT_SITE" | "NOTE";
type QueueItemBase = {
  id: string; userId: string; createdAt: string; schemaVersion: 2;
  files?: File[]; expectedFileCount?: number; status?: "PENDING" | "FAILED";
  lastError?: string; nextAttemptAt?: number; attempts?: number;
  prepared?: boolean; uploadGeneration?: string; sendingBy?: string; sendingUntil?: number; sequence?: number;
  chunkState?: AdaptiveUploadChunkState; uploadFileGenerations?: Record<string, string>;
};
export type PersonnelEventQueueItem = QueueItemBase & {
  type: "PERSONNEL_EVENT"; eventType: PersonnelEventType; taskId: string;
  note?: string; latitude?: string; longitude?: string; occurredAt: string; actualHeadcount?: number;
};
export type PersonnelFileQueueItem = QueueItemBase & {
  type: "PERSONNEL_FILE"; taskId: string; projectId: string; dependencyId: string; note?: string;
};
export type VisitUploadQueueItem = QueueItemBase & {
  type: "VISIT_FILE"; projectId: string; projectVisitId?: string; note?: string;
};
export type OfflineQueueItem = PersonnelEventQueueItem | PersonnelFileQueueItem | VisitUploadQueueItem;
export type OfflineSyncProgress = { current: number; itemId: string; kind: OfflineQueueKind; progress: number; total: number; overallProgress: number };
export type OfflineSyncResult = { error?: string; failedIds: string[]; remaining: number; synced: number };
export type SuccessfulUploadReceipt = {
  id: string; uploadedByUserId: string; uploadId: string; projectFileId: string | null;
  completedAt: string; originalName: string;
};
type SyncOptions = { kinds?: OfflineQueueKind[]; userId: string; eventsOnly?: boolean; force?: boolean; signal?: AbortSignal; onProgress?: (progress: OfflineSyncProgress) => void };
type EnqueueEvent = { userId: string; taskId: string; projectId: string; eventType: PersonnelEventType; note?: string; latitude?: string; longitude?: string; occurredAt?: string; actualHeadcount?: number; files?: File[] };
// Old open V1 tabs cannot read or delete V1.1 records with their legacy syncer.
const DB_NAME = "kagu-saha-offline-v11";
const LEGACY_DB_NAME = "kagu-saha-offline";
const STORE_NAME = "pending-items";
const RECEIPTS_STORE_NAME = "successful-uploads";
const DB_VERSION = 2;
const MAX_RECEIPTS_PER_ACCOUNT = 100;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const PAGE_ID = createClientId();
const activeSyncs = new Map<string, { userId: string; kinds: OfflineQueueKind[]; controller: AbortController; progress?: OfflineSyncProgress; promise: Promise<OfflineSyncResult>; listeners: Set<NonNullable<SyncOptions["onProgress"]>> }>();
const pausedSyncs = new Set<string>();

export function getOfflineSyncProgress(userId: string, kind: OfflineQueueKind) {
  return [...activeSyncs.values()].find((sync) => sync.userId === userId && sync.kinds.includes(kind) && sync.progress)?.progress ?? null;
}
export async function stopOfflineSync(userId: string, kind: OfflineQueueKind) {
  pausedSyncs.add(`${userId}:${kind}`);
  const active = [...activeSyncs.values()].filter((sync) => sync.userId === userId && sync.kinds.includes(kind));
  for (const sync of active) sync.controller.abort();
  await Promise.all(active.map((sync) => sync.promise));
}
export function dismissOfflineNotifications(userId: string, kind: OfflineQueueKind) {
  window.dispatchEvent(new CustomEvent("kagu-dismiss-queue-notifications", { detail: { userId, kind } }));
}
export function showOfflineNotifications(userId: string, kind: OfflineQueueKind) {
  window.dispatchEvent(new CustomEvent("kagu-show-queue-notifications", { detail: { userId, kind } }));
}

export function validateUploadSelection(files: File[]) {
  if (files.length > 20) throw new Error("Bir kayıtta en fazla 20 dosya seçebilirsiniz.");
  if (files.some((file) => file.size > MAX_FILE_BYTES)) throw new Error("Bir dosya en fazla 100 MB olabilir.");
  if (files.reduce((sum, file) => sum + file.size, 0) > 500 * 1024 * 1024) throw new Error("Seçilen dosyaların toplamı 500 MB'ı geçemez.");
}
function openQueueDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(RECEIPTS_STORE_NAME)) request.result.createObjectStore(RECEIPTS_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Cihaz depolaması başka bir sekmede güncelleniyor."));
  });
}
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void, storeName = STORE_NAME) {
  const db = await openQueueDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    let result: T | undefined;
    const request = run(transaction.objectStore(storeName));
    if (request) request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? request?.error ?? new Error("Cihaza kayıt tamamlanamadı.")); };
  });
}
async function mutateItem(id: string, change: (item: OfflineQueueItem) => OfflineQueueItem | undefined) {
  const db = await openQueueDb();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let changed = false;
    const request = store.get(id);
    request.onsuccess = () => {
      if (!isOwnedQueueItem(request.result)) return;
      const next = change(request.result);
      if (next) { store.put(next); changed = true; }
    };
    tx.oncomplete = () => { db.close(); resolve(changed); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Cihazdaki kayıt güncellenemedi.")); };
  });
}
function notifyQueueChange() { window.dispatchEvent(new Event("kagu-queue-changed")); }
async function appendItems(items: OfflineQueueItem[]) {
  // Allocate order inside the write transaction, including across tabs. Two
  // clicks in the same millisecond must not reorder NOTE and LEFT_SITE.
  await withStore("readwrite", (store) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const previous = (request.result as unknown[]).filter(isOwnedQueueItem);
      let sequence = Math.max(Date.now() * 1000, ...previous.map((item) => item.sequence ?? Date.parse(item.createdAt) * 1000));
      for (const item of items) { item.sequence = ++sequence; store.add(item); }
    };
  });
  for (const item of items) pausedSyncs.delete(`${item.userId}:${getQueueItemKind(item)}`);
}
function base(userId: string): QueueItemBase {
  if (!userId) throw new Error("Kullanıcı bilgisi olmadan cihaza kayıt yapılamaz.");
  return { id: createClientId(), userId, createdAt: new Date().toISOString(), schemaVersion: 2, status: "PENDING" };
}
export async function enqueuePersonnelEvent(input: EnqueueEvent) {
  validateUploadSelection(input.files ?? []);
  const event: PersonnelEventQueueItem = {
    ...base(input.userId), type: "PERSONNEL_EVENT", eventType: input.eventType,
    taskId: input.taskId, occurredAt: input.occurredAt ?? new Date().toISOString(),
    ...(input.note ? { note: input.note } : {}), ...(input.latitude ? { latitude: input.latitude } : {}),
    ...(input.longitude ? { longitude: input.longitude } : {}),
    ...(input.actualHeadcount !== undefined ? { actualHeadcount: input.actualHeadcount } : {}),
  };
  const media: PersonnelFileQueueItem[] = (input.files ?? []).map((file) => ({
    ...base(input.userId), type: "PERSONNEL_FILE", taskId: input.taskId, projectId: input.projectId,
    dependencyId: event.id, note: input.note, files: [file], expectedFileCount: 1,
  }));
  await appendItems([event, ...media]);
  notifyQueueChange();
  return { event, media };
}
export async function enqueueVisitUpload(input: { userId: string; projectId: string; projectVisitId?: string; note?: string; files?: File[] }) {
  validateUploadSelection(input.files ?? []);
  const item: VisitUploadQueueItem = { ...base(input.userId), ...input, type: "VISIT_FILE", expectedFileCount: input.files?.length ?? 0 };
  item.files = input.files?.map((file, index) => new File([file], uniqueUploadName(file.name, file.type, `${item.id}-${index}`, true), { type: file.type, lastModified: file.lastModified }));
  await appendItems([item]);
  notifyQueueChange();
  return item;
}
export async function enqueueVisitUploads(input: { userId: string; projectId: string; projectVisitId?: string; note?: string; files: File[] }) {
  validateUploadSelection(input.files);
  const items: VisitUploadQueueItem[] = input.files.map((file) => {
    const item: VisitUploadQueueItem = { ...base(input.userId), ...input, type: "VISIT_FILE", files: [], expectedFileCount: 1 };
    item.files = [new File([file], uniqueUploadName(file.name, file.type, item.id, true), { type: file.type, lastModified: file.lastModified })];
    return item;
  });
  await appendItems(items);
  notifyQueueChange();
  return items;
}
export async function replaceOfflineItemFiles(id: string, files: File[], options: { userId: string; resetUpload?: boolean; prepared?: boolean }) {
  if (!options.userId) throw new Error("Kullanıcı bilgisi olmadan kayıt güncellenemez.");
  validateUploadSelection(files);
  const changed = await mutateItem(id, (item) => {
    if (item.userId !== options.userId) return;
    if (options.resetUpload && (item.sendingUntil ?? 0) > Date.now()) return;
    return { ...item, files, expectedFileCount: files.length, prepared: options.prepared ?? true, status: "PENDING", lastError: undefined, nextAttemptAt: 0,
      ...(options.resetUpload ? { uploadGeneration: createClientId(), uploadFileGenerations: undefined, chunkState: undefined } : {}) };
  });
  if (!changed) throw new Error("Kayıt bulunamadı, başka hesaba ait veya halen gönderiliyor.");
  if (options.resetUpload) {
    const item = (await listOfflineItems(undefined, options.userId)).find((row) => row.id === id);
    if (item) pausedSyncs.delete(`${options.userId}:${getQueueItemKind(item)}`);
  }
  notifyQueueChange();
}
function isOwnedQueueItem(item: unknown): item is OfflineQueueItem {
  if (!item || typeof item !== "object") return false;
  const value = item as Partial<OfflineQueueItem>;
  return value.schemaVersion === 2 && typeof value.userId === "string" && typeof value.id === "string" &&
    ["PERSONNEL_EVENT", "PERSONNEL_FILE", "VISIT_FILE"].includes(value.type ?? "");
}
export function getQueueItemKind(item: OfflineQueueItem): OfflineQueueKind { return item.type === "VISIT_FILE" ? "VISIT_UPLOAD" : "PERSONNEL"; }
export async function listOfflineItems(kinds?: OfflineQueueKind[], userId?: string) {
  const stored = (await withStore<unknown[]>("readonly", (store) => store.getAll())) ?? [];
  if (!userId) return [];
  return stored.filter(isOwnedQueueItem).filter((item) => item.userId === userId && (!kinds || kinds.includes(getQueueItemKind(item))))
    .sort((a, b) => (a.sequence ?? Date.parse(a.createdAt) * 1000) - (b.sequence ?? Date.parse(b.createdAt) * 1000));
}
function isSuccessfulUploadReceipt(value: unknown): value is SuccessfulUploadReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<SuccessfulUploadReceipt>;
  return typeof receipt.id === "string" && typeof receipt.uploadedByUserId === "string" && typeof receipt.uploadId === "string" &&
    (receipt.projectFileId === null || typeof receipt.projectFileId === "string") && typeof receipt.originalName === "string" &&
    typeof receipt.completedAt === "string" && Number.isFinite(Date.parse(receipt.completedAt));
}
/** Device-local delivery receipts; no media, note, project or task contents are retained. */
export async function listSuccessfulUploads(userId: string): Promise<SuccessfulUploadReceipt[]> {
  if (!userId) return [];
  const rows = (await withStore<unknown[]>("readonly", (store) => store.getAll(), RECEIPTS_STORE_NAME)) ?? [];
  return rows.filter(isSuccessfulUploadReceipt).filter((receipt) => receipt.uploadedByUserId === userId)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, MAX_RECEIPTS_PER_ACCOUNT);
}
async function rememberSuccessfulUpload(receipt: SuccessfulUploadReceipt) {
  await withStore("readwrite", (store) => {
    const read = store.getAll();
    read.onsuccess = () => {
      const owned = (read.result as unknown[]).filter(isSuccessfulUploadReceipt).filter((row) => row.uploadedByUserId === receipt.uploadedByUserId);
      const previous = owned.find((row) => row.id === receipt.id);
      const next = { ...receipt, completedAt: previous?.completedAt ?? receipt.completedAt };
      store.put(next);
      const retained = [next, ...owned.filter((row) => row.id !== next.id)].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
      for (const expired of retained.slice(MAX_RECEIPTS_PER_ACCOUNT)) store.delete(expired.id);
    };
  }, RECEIPTS_STORE_NAME);
}
/** Resolve completed HEIC deliveries to their eventual canonical file ID. Failures retain receipts. */
export async function refreshSuccessfulUploads(userId: string): Promise<SuccessfulUploadReceipt[]> {
  const receipts = await listSuccessfulUploads(userId);
  if (!navigator.onLine) return receipts;
  for (const receipt of receipts.filter((row) => row.projectFileId === null)) {
    try {
      const upload = await requestJson<UploadResponse>(`/api/uploads/${encodeURIComponent(receipt.uploadId)}`);
      if (upload.uploadId === receipt.uploadId && upload.status === "COMPLETED" && typeof upload.projectFileId === "string" && upload.projectFileId) {
        await rememberSuccessfulUpload({ ...receipt, projectFileId: upload.projectFileId });
      }
    } catch (error) { if (error instanceof JsonRequestError && [0, 401, 503].includes(error.status)) break; }
  }
  return listSuccessfulUploads(userId);
}
export async function countLegacyOfflineItems() {
  const stored = (await withStore<unknown[]>("readonly", (store) => store.getAll())) ?? [];
  const oldCount = await new Promise<number>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) { db.close(); resolve(0); return; }
      const tx = db.transaction(STORE_NAME, "readonly");
      const count = tx.objectStore(STORE_NAME).count();
      tx.oncomplete = () => { db.close(); resolve(count.result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
  return oldCount + stored.filter((item) => !isOwnedQueueItem(item)).length;
}
export type LegacyOfflineRecord = { id: string; type: string; createdAt: string; note: string; projectId: string; taskId: string; files: File[]; expectedFileCount: number };
/** Explicit device-wide cleanup of ownerless records; never removes V2 owned records. */
export async function clearLegacyOfflineItems() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) { db.close(); resolve(); return; }
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const read = store.getAll();
      read.onsuccess = () => { for (const item of read.result) if (!isOwnedQueueItem(item)) store.delete(item.id); };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
  await withStore("readwrite", (store) => {
    const read = store.getAll();
    read.onsuccess = () => { for (const item of read.result) if (!isOwnedQueueItem(item)) store.delete(item.id); };
  });
  notifyQueueChange();
}
export async function readLegacyOfflineItemsForRecovery(): Promise<LegacyOfflineRecord[]> {
  await requestJson("/api/offline/legacy-access", {}, 15_000);
  const old = await new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) { db.close(); resolve([]); return; }
      const tx = db.transaction(STORE_NAME, "readonly"); const read = tx.objectStore(STORE_NAME).getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
  const newer = (await withStore<unknown[]>("readonly", (store) => store.getAll())) ?? [];
  return [...old, ...newer.filter((item) => !isOwnedQueueItem(item))].flatMap((value) => {
    if (!value || typeof value !== "object" || !("id" in value)) return [];
    const row = value as Record<string, unknown>;
    const files = Array.isArray(row.files) ? row.files.filter((file): file is File => file instanceof Blob) : [];
    return [{ id: String(row.id), type: String(row.type ?? "Bilinmeyen"), createdAt: String(row.createdAt ?? ""), note: String(row.note ?? ""),
      projectId: String(row.projectId ?? ""), taskId: String(row.taskId ?? ""), files, expectedFileCount: Number(row.expectedFileCount ?? files.length) }];
  });
}
export async function deleteOfflineItem(id: string, userId: string, options: { includeDependents?: boolean; allowSending?: boolean } = {}) {
  if (!userId) throw new Error("Kullanıcı bilgisi olmadan kayıt silinemez.");
  let denied = false;
  await withStore("readwrite", (store) => {
    const read = store.get(id);
    read.onsuccess = () => {
      if (!read.result) return;
      if (!isOwnedQueueItem(read.result) || read.result.userId !== userId ||
          (!options.allowSending && (read.result.sendingUntil ?? 0) > Date.now())) { denied = true; return; }
      store.delete(id);
      if (options.includeDependents) {
        const all = store.getAll();
        all.onsuccess = () => {
          for (const item of all.result) {
            if (isOwnedQueueItem(item) && item.userId === userId && item.type === "PERSONNEL_FILE" && item.dependencyId === id) store.delete(item.id);
          }
        };
      }
    };
  });
  if (denied) throw new Error("Kayıt başka hesaba ait veya halen gönderiliyor; silinmedi.");
  notifyQueueChange();
}
export async function retryOfflineItem(id: string, userId: string) {
  if (!userId) throw new Error("Kullanıcı bilgisi olmadan kayıt yeniden gönderilemez.");
  const changed = await mutateItem(id, (item) => item.userId === userId && (item.sendingUntil ?? 0) <= Date.now()
    ? { ...item, status: "PENDING", lastError: undefined, nextAttemptAt: 0 } : undefined);
  if (!changed) throw new Error("Kayıt bulunamadı, başka hesaba ait veya halen gönderiliyor.");
  notifyQueueChange();
}
export async function hasPendingPersonnelNote(userId: string, taskId: string) {
  return (await listOfflineItems(["PERSONNEL"], userId)).some((item) => item.type === "PERSONNEL_EVENT" && item.status !== "FAILED" && item.eventType === "NOTE" && item.taskId === taskId && Boolean(item.note));
}
export function syncOfflineItems(options: SyncOptions): Promise<OfflineSyncResult> {
  const kinds = options.kinds ?? ["VISIT_UPLOAD", "PERSONNEL"];
  if (options.force) for (const kind of kinds) pausedSyncs.delete(`${options.userId}:${kind}`);
  if (kinds.some((kind) => pausedSyncs.has(`${options.userId}:${kind}`))) {
    return listOfflineItems(kinds, options.userId).then((items) => ({ failedIds: [], synced: 0, remaining: items.length }));
  }
  const key = `${options.userId}:${kinds.join(",")}:${options.eventsOnly ? "events" : "all"}`;
  const active = activeSyncs.get(key);
  if (active) { if (options.onProgress) active.listeners.add(options.onProgress); return active.promise; }
  const listeners = new Set<NonNullable<SyncOptions["onProgress"]>>();
  if (options.onProgress) listeners.add(options.onProgress);
  const controller = new AbortController();
  const promise = runSync({ ...options, kinds, signal: controller.signal, onProgress: (progress) => {
    const active = activeSyncs.get(key);
    if (active) active.progress = progress;
    window.dispatchEvent(new Event("kagu-sync-progress"));
    for (const listener of listeners) listener(progress);
  } }).catch(async () => ({
    error: "Cihazdaki kayıtlar okunamadı; kayıtları silmeden tekrar deneyin.", failedIds: [], synced: 0,
    remaining: (await listOfflineItems(kinds, options.userId).catch(() => [])).length,
  })).finally(() => { activeSyncs.delete(key); window.dispatchEvent(new Event("kagu-sync-progress")); }).then((result) => {
    // A blocked/no-op pass must not wake the boot loop indefinitely.
    if (result.synced > 0 || result.failedIds.length > 0) notifyQueueChange();
    return result;
  });
  activeSyncs.set(key, { userId: options.userId, kinds, controller, promise, listeners }); return promise;
}
async function runSync(options: SyncOptions & { kinds: OfflineQueueKind[] }): Promise<OfflineSyncResult> {
  const items = await listOfflineItems(options.kinds, options.userId);
  if (!navigator.onLine) return { failedIds: [], synced: 0, remaining: items.length };
  const eligible = items.filter((item) => (!options.eventsOnly || item.type === "PERSONNEL_EVENT") && item.status !== "FAILED" && (options.force || (item.nextAttemptAt ?? 0) <= Date.now()));
  const ordered = [...items.filter((item) => item.type === "PERSONNEL_EVENT"), ...items.filter((item) => item.type !== "PERSONNEL_EVENT")];
  const weight = (item: OfflineQueueItem) => Math.max(1, (item.files ?? []).reduce((sum, file) => sum + file.size, 0));
  const totalWeight = eligible.reduce((sum, item) => sum + weight(item), 0);
  let completedWeight = 0;
  let synced = 0; let error: string | undefined;
  const failedIds: string[] = [];
  const claimToken = `${PAGE_ID}:${createClientId()}`;
  // An in-flight event in another tab preserves order for all task events.
  const blockedTasks = new Set<string>();
  // A rejected/backed-off event blocks later state transitions. Independent
  // notes can still commit, and each photo waits only for its own note receipt.
  const blockedTransitions = new Set<string>();
  for (const [index, original] of ordered.entries()) {
    if (options.signal?.aborted) break;
    if (options.eventsOnly && original.type !== "PERSONNEL_EVENT") continue;
    if (original.status === "FAILED" || (!options.force && (original.nextAttemptAt ?? 0) > Date.now())) {
      if (original.lastError) error = original.lastError;
      if (original.type === "PERSONNEL_EVENT") blockedTransitions.add(original.taskId);
      continue;
    }
    if ("taskId" in original && blockedTasks.has(original.taskId)) continue;
    if (original.type === "PERSONNEL_EVENT" && original.eventType !== "NOTE" && blockedTransitions.has(original.taskId)) continue;
    if (original.type === "PERSONNEL_FILE" && (await listOfflineItems(["PERSONNEL"], options.userId)).some((item) => item.id === original.dependencyId)) continue;
    const claimed = await mutateItem(original.id, (item) => {
      if (item.sendingBy && (item.sendingUntil ?? 0) > Date.now()) return;
      return { ...item, sendingBy: claimToken, sendingUntil: Date.now() + 180_000 };
    });
    if (!claimed) { if (original.type === "PERSONNEL_EVENT") blockedTasks.add(original.taskId); continue; }
    const heartbeat = window.setInterval(() => { void mutateItem(original.id, (item) => item.sendingBy === claimToken ? { ...item, sendingUntil: Date.now() + 180_000 } : undefined).catch(() => {}); }, 30_000);
    const report = (progress: number) => options.onProgress?.({ current: index + 1, total: ordered.length, itemId: original.id, kind: getQueueItemKind(original), progress,
      overallProgress: Math.min(100, Math.floor((completedWeight + weight(original) * progress / 100) / Math.max(1, totalWeight) * 100)) });
    try {
      report(0); await sendItem(original, report, options.signal); options.signal?.throwIfAborted();
      await deleteOfflineItem(original.id, options.userId, { allowSending: true }); synced += 1; report(100); completedWeight += weight(original);
    } catch (cause) {
      if (options.signal?.aborted) { error = "Gönderim durduruldu. Kayıtlar cihazda korunuyor."; break; }
      const failure = cause instanceof QueueError || cause instanceof JsonRequestError ? cause : new QueueError("Bağlantı kesildi. Kayıt cihazda korunuyor.", 0);
      error = failure.message; failedIds.push(original.id);
      if (original.type === "PERSONNEL_EVENT") blockedTransitions.add(original.taskId);
      const permanent = [400, 403, 404, 413, 422].includes(failure.status);
      await mutateItem(original.id, (item) => ({ ...item, status: permanent ? "FAILED" : "PENDING", lastError: failure.message,
        attempts: (item.attempts ?? 0) + 1, nextAttemptAt: Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(item.attempts ?? 0, 6)) }));
      // A 503 on one route need not stop independent notes/uploads. Network and
      // authentication failures still stop the pass to preserve account safety.
      if ([0, 401].includes(failure.status)) break;
    } finally {
      window.clearInterval(heartbeat);
      await mutateItem(original.id, (item) => item.sendingBy === claimToken ? { ...item, sendingBy: undefined, sendingUntil: undefined } : undefined);
    }
  }
  return { error, failedIds, synced, remaining: (await listOfflineItems(options.kinds, options.userId)).length };
}
class QueueError extends Error { constructor(message: string, readonly status: number) { super(message); } }
type UploadResponse = { ok: true; uploadId: string; offsetBytes: number; sizeBytes: number; status: string; processing?: boolean; projectFileId: string | null; completedAt?: string | null };
function validateUploadResponse(upload: UploadResponse, sizeBytes: number, uploadId?: string) {
  if (!upload || typeof upload.uploadId !== "string" || !upload.uploadId || (uploadId && upload.uploadId !== uploadId) ||
    !Number.isSafeInteger(upload.offsetBytes) || upload.offsetBytes < 0 || upload.offsetBytes > sizeBytes || upload.sizeBytes !== sizeBytes ||
    !["OPEN", "PROCESSING", "COMPLETED", "CANCELLED"].includes(upload.status)) {
    throw new QueueError("Sunucudan geçerli yükleme konumu alınamadı. Dosya cihazda korunuyor.", 503);
  }
}
async function restartExpiredUpload(item: OfflineQueueItem, index: number) {
  // Only this file gets a new session; already published siblings retain their original identity.
  await mutateItem(item.id, (stored) => stored.userId === item.userId ? { ...stored, uploadFileGenerations: { ...stored.uploadFileGenerations, [index]: createClientId() } } : undefined);
  throw new QueueError("Geçici yükleme süresi doldu. Cihazdaki dosya korunarak yeni yükleme başlayacak.", 409);
}
async function sendItem(item: OfflineQueueItem, onProgress: (progress: number) => void, signal?: AbortSignal) {
  const request = <T extends { ok: true }>(url: string, options: RequestInit = {}, timeout?: number) => requestJson<T>(url, { ...options, signal }, timeout);
  if (item.type === "PERSONNEL_EVENT") {
    await request("/api/offline/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      ownerUserId: item.userId, type: item.eventType, taskId: item.taskId, clientItemId: item.id, occurredAt: item.occurredAt,
      note: item.note, latitude: item.latitude, longitude: item.longitude, actualHeadcount: item.actualHeadcount,
    }) }); return;
  }
  let files = (item.files ?? []).filter((file) => file instanceof Blob && file.size > 0);
  if (!files.length || files.length < (item.expectedFileCount ?? 0)) throw new QueueError("Dosya cihazda bulunamadı. Kaydı silmeden dosyayı yeniden seçin.", 422);
  if (!item.prepared) { files = await prepareFilesForUpload(files, signal); signal?.throwIfAborted(); await replaceOfflineItemFiles(item.id, files, { userId: item.userId }); }
  let chunkState = uploadChunkState(item.chunkState);
  const saveChunkState = async () => {
    const saved = await mutateItem(item.id, (stored) => stored.userId === item.userId ? { ...stored, chunkState } : undefined);
    if (!saved) throw new QueueError("Cihazdaki yükleme durumu saklanamadı. Dosya korunuyor.", 503);
  };
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let completedBytes = 0;
  for (const [index, file] of files.entries()) {
    signal?.throwIfAborted();
    let upload = await request<UploadResponse>("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      ownerUserId: item.userId, clientUploadId: `${item.id}_${item.uploadFileGenerations?.[index] ?? item.uploadGeneration ?? "v1"}_${index}`, projectId: item.projectId, dailyTaskId: item.type === "PERSONNEL_FILE" ? item.taskId : undefined,
      projectVisitId: item.type === "VISIT_FILE" ? item.projectVisitId : undefined,
      originalName: file.name || `dosya-${index + 1}`, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, note: item.note,
    }) });
    validateUploadResponse(upload, file.size);
    onProgress(Math.floor((completedBytes + upload.offsetBytes) / totalBytes * 96));
    if (upload.status === "CANCELLED") await restartExpiredUpload(item, index);
    let conflicts = 0;
    while (upload.offsetBytes < file.size) {
      const chunk = file.slice(upload.offsetBytes, Math.min(file.size, upload.offsetBytes + chunkState.chunkBytes));
      const startedAt = performance.now();
      let acknowledged: UploadResponse;
      try {
        acknowledged = await request<UploadResponse>(`/api/uploads/${upload.uploadId}`, { method: "PATCH", headers: { "Upload-Offset": String(upload.offsetBytes), "Content-Type": "application/octet-stream" }, body: chunk }, 120_000);
      } catch (error) {
        if (error instanceof JsonRequestError && error.status === 410) await restartExpiredUpload(item, index);
        if (error instanceof JsonRequestError && error.status === 409) {
          if (++conflicts > 3) throw new QueueError("Yükleme başka bir sekmede işleniyor. Kayıt korunarak yeniden denenecek.", 409);
          const previous = upload.offsetBytes;
          const expectedUploadId = upload.uploadId;
          const refreshed = await request<UploadResponse>(`/api/uploads/${expectedUploadId}`);
          validateUploadResponse(refreshed, file.size, expectedUploadId);
          upload = refreshed;
          if (upload.offsetBytes < previous) throw new QueueError("Sunucu yükleme konumu geriledi. Dosya cihazda korunuyor.", 503);
          continue;
        }
        if (error instanceof JsonRequestError && error.status !== 401 && (error.status === 0 || error.status >= 500)) {
          chunkState = shrinkUploadChunk(chunkState); await saveChunkState();
        }
        throw error;
      }
      validateUploadResponse(acknowledged, file.size, upload.uploadId);
      if (acknowledged.offsetBytes < upload.offsetBytes + chunk.size) throw new QueueError("Dosya parçası henüz doğrulanmadı. Kayıt cihazda korunuyor.", 503);
      chunkState = acknowledgeUploadChunk(chunkState, chunk.size, performance.now() - startedAt);
      await saveChunkState();
      upload = acknowledged; conflicts = 0;
      onProgress(Math.floor((completedBytes + upload.offsetBytes) / totalBytes * 96));
    }
    const finalized = await request<UploadResponse>(`/api/uploads/${upload.uploadId}/finalize`, { method: "POST" });
    validateUploadResponse(finalized, file.size, upload.uploadId);
    if (finalized.status !== "COMPLETED" || finalized.offsetBytes !== file.size ||
      !((typeof finalized.projectFileId === "string" && finalized.projectFileId) || (finalized.projectFileId === null && finalized.processing === true))) {
      throw new QueueError("Dosyanın kayıt onayı doğrulanamadı. Dosya cihazda korunuyor.", 503);
    }
    // A receipt failure leaves the queued Blob intact; an idempotent finalize can retry safely.
    await rememberSuccessfulUpload({ id: `${item.userId}:${finalized.uploadId}`, uploadedByUserId: item.userId, uploadId: finalized.uploadId,
      projectFileId: finalized.projectFileId, completedAt: finalized.completedAt && Number.isFinite(Date.parse(finalized.completedAt)) ? finalized.completedAt : new Date().toISOString(),
      originalName: file.name || `dosya-${index + 1}` });
    completedBytes += file.size;
  }
}
