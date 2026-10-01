"use client";
import { createClientId } from "@/lib/offline/client-id";
import { prepareFilesForUpload } from "@/lib/client/image-compression";

export type OfflineQueueKind = "PERSONNEL" | "VISIT_UPLOAD";
export type PersonnelEventType = "ARRIVED_SITE" | "LEFT_SITE" | "NOTE";
type QueueItemBase = {
  id: string; userId: string; createdAt: string; schemaVersion: 2;
  files?: File[]; expectedFileCount?: number; status?: "PENDING" | "FAILED";
  lastError?: string; nextAttemptAt?: number; attempts?: number;
  prepared?: boolean; uploadGeneration?: string; sendingBy?: string; sendingUntil?: number; sequence?: number;
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
export type OfflineSyncProgress = { current: number; itemId: string; kind: OfflineQueueKind; progress: number; total: number };
export type OfflineSyncResult = { error?: string; failedIds: string[]; remaining: number; synced: number };
type SyncOptions = { kinds?: OfflineQueueKind[]; userId: string; eventsOnly?: boolean; force?: boolean; onProgress?: (progress: OfflineSyncProgress) => void };
type EnqueueEvent = { userId: string; taskId: string; projectId: string; eventType: PersonnelEventType; note?: string; latitude?: string; longitude?: string; occurredAt?: string; actualHeadcount?: number; files?: File[] };
// Old open V1 tabs cannot read or delete V1.1 records with their legacy syncer.
const DB_NAME = "kagu-saha-offline-v11";
const LEGACY_DB_NAME = "kagu-saha-offline";
const STORE_NAME = "pending-items";
const DB_VERSION = 1;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const PAGE_ID = createClientId();
const activeSyncs = new Map<string, { promise: Promise<OfflineSyncResult>; listeners: Set<NonNullable<SyncOptions["onProgress"]>> }>();

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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Cihaz depolaması başka bir sekmede güncelleniyor."));
  });
}
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void) {
  const db = await openQueueDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    let result: T | undefined;
    const request = run(transaction.objectStore(STORE_NAME));
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
  await appendItems([item]);
  notifyQueueChange();
  return item;
}
export async function enqueueVisitUploads(input: { userId: string; projectId: string; projectVisitId?: string; note?: string; files: File[] }) {
  validateUploadSelection(input.files);
  const items: VisitUploadQueueItem[] = input.files.map((file) => ({ ...base(input.userId), ...input, type: "VISIT_FILE", files: [file], expectedFileCount: 1 }));
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
      ...(options.resetUpload ? { uploadGeneration: createClientId() } : {}) };
  });
  if (!changed) throw new Error("Kayıt bulunamadı, başka hesaba ait veya halen gönderiliyor.");
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
export async function readLegacyOfflineItemsForRecovery(): Promise<LegacyOfflineRecord[]> {
  const response = await boundedFetch("/api/offline/legacy-access", { cache: "no-store" }, 15_000);
  if (!response.ok || response.redirected) throw new Error("Eski kayıtları yalnız yönetici hesabı kurtarabilir.");
  const permission = await response.json();
  if (permission.ok !== true) throw new Error("Kurtarma yetkisi doğrulanamadı.");
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
export function syncOfflineItems(options: SyncOptions) {
  const kinds = options.kinds ?? ["VISIT_UPLOAD", "PERSONNEL"];
  const key = `${options.userId}:${kinds.join(",")}:${options.eventsOnly ? "events" : "all"}`;
  const active = activeSyncs.get(key);
  if (active) { if (options.onProgress) active.listeners.add(options.onProgress); return active.promise; }
  const listeners = new Set<NonNullable<SyncOptions["onProgress"]>>();
  if (options.onProgress) listeners.add(options.onProgress);
  const promise = runSync({ ...options, kinds, onProgress: (progress) => { for (const listener of listeners) listener(progress); } }).catch(async () => ({
    error: "Cihazdaki kayıtlar okunamadı; kayıtları silmeden tekrar deneyin.", failedIds: [], synced: 0,
    remaining: (await listOfflineItems(kinds, options.userId).catch(() => [])).length,
  })).finally(() => { activeSyncs.delete(key); }).then((result) => {
    // A blocked/no-op pass must not wake the boot loop indefinitely.
    if (result.synced > 0 || result.failedIds.length > 0) notifyQueueChange();
    return result;
  });
  activeSyncs.set(key, { promise, listeners }); return promise;
}
async function runSync(options: SyncOptions & { kinds: OfflineQueueKind[] }): Promise<OfflineSyncResult> {
  const items = await listOfflineItems(options.kinds, options.userId);
  if (!navigator.onLine) return { failedIds: [], synced: 0, remaining: items.length };
  const ordered = [...items.filter((item) => item.type === "PERSONNEL_EVENT"), ...items.filter((item) => item.type !== "PERSONNEL_EVENT")];
  let synced = 0; let error: string | undefined;
  const failedIds: string[] = [];
  const claimToken = `${PAGE_ID}:${createClientId()}`;
  const blockedTasks = new Set<string>();
  for (const [index, original] of ordered.entries()) {
    if (options.eventsOnly && original.type !== "PERSONNEL_EVENT") continue;
    if (original.status === "FAILED" || (!options.force && (original.nextAttemptAt ?? 0) > Date.now())) {
      if (original.lastError) error = original.lastError;
      if (original.type === "PERSONNEL_EVENT") blockedTasks.add(original.taskId);
      continue;
    }
    if ("taskId" in original && blockedTasks.has(original.taskId)) continue;
    if (original.type === "PERSONNEL_FILE" && (await listOfflineItems(["PERSONNEL"], options.userId)).some((item) => item.id === original.dependencyId)) continue;
    const claimed = await mutateItem(original.id, (item) => {
      if (item.sendingBy && (item.sendingUntil ?? 0) > Date.now()) return;
      return { ...item, sendingBy: claimToken, sendingUntil: Date.now() + 180_000 };
    });
    if (!claimed) { if (original.type === "PERSONNEL_EVENT") blockedTasks.add(original.taskId); continue; }
    const heartbeat = window.setInterval(() => { void mutateItem(original.id, (item) => item.sendingBy === claimToken ? { ...item, sendingUntil: Date.now() + 180_000 } : undefined).catch(() => {}); }, 30_000);
    const report = (progress: number) => options.onProgress?.({ current: index + 1, total: ordered.length, itemId: original.id, kind: getQueueItemKind(original), progress });
    try {
      report(0); await sendItem(original, report); await deleteOfflineItem(original.id, options.userId, { allowSending: true }); synced += 1; report(100);
    } catch (cause) {
      const failure = cause instanceof QueueError ? cause : new QueueError("Bağlantı kesildi. Kayıt cihazda korunuyor.", 0);
      error = failure.message; failedIds.push(original.id);
      if (original.type === "PERSONNEL_EVENT") blockedTasks.add(original.taskId);
      const permanent = [400, 403, 404, 413, 422].includes(failure.status);
      await mutateItem(original.id, (item) => ({ ...item, status: permanent ? "FAILED" : "PENDING", lastError: failure.message,
        attempts: (item.attempts ?? 0) + 1, nextAttemptAt: Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(item.attempts ?? 0, 6)) }));
      if ([0, 401, 503].includes(failure.status)) break;
    } finally {
      window.clearInterval(heartbeat);
      await mutateItem(original.id, (item) => item.sendingBy === claimToken ? { ...item, sendingBy: undefined, sendingUntil: undefined } : undefined);
    }
  }
  return { error, failedIds, synced, remaining: (await listOfflineItems(options.kinds, options.userId)).length };
}
class QueueError extends Error { constructor(message: string, readonly status: number) { super(message); } }
type UploadResponse = { ok: boolean; error?: string; uploadId: string; offsetBytes: number; sizeBytes: number; status: string; processing?: boolean };
async function jsonRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await boundedFetch(url, { ...options, cache: "no-store" }, 30_000);
  const payload = await response.json().catch(() => ({}));
  if (response.redirected || response.status === 401) throw new QueueError("Oturum süresi doldu. Kayıt cihazda korundu; tekrar giriş yapın.", 401);
  if (!response.ok || payload.ok !== true) throw new QueueError(payload.error || "Sunucu kaydı kabul etmedi.", response.status || 503);
  return payload as T;
}
async function boundedFetch(url: string, options: RequestInit, timeout: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function restartExpiredUpload(item: OfflineQueueItem) {
  await mutateItem(item.id, (stored) => stored.userId === item.userId ? { ...stored, uploadGeneration: createClientId() } : undefined);
  throw new QueueError("Geçici yükleme süresi doldu. Cihazdaki dosya korunarak yeni yükleme başlayacak.", 409);
}
async function sendItem(item: OfflineQueueItem, onProgress: (progress: number) => void) {
  if (item.type === "PERSONNEL_EVENT") {
    await jsonRequest("/api/offline/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      ownerUserId: item.userId, type: item.eventType, taskId: item.taskId, clientItemId: item.id, occurredAt: item.occurredAt,
      note: item.note, latitude: item.latitude, longitude: item.longitude, actualHeadcount: item.actualHeadcount,
    }) }); return;
  }
  let files = (item.files ?? []).filter((file) => file instanceof Blob && file.size > 0);
  if (!files.length || files.length < (item.expectedFileCount ?? 0)) throw new QueueError("Dosya cihazda bulunamadı. Kaydı silmeden dosyayı yeniden seçin.", 422);
  if (!item.prepared) { files = await prepareFilesForUpload(files); await replaceOfflineItemFiles(item.id, files, { userId: item.userId }); }
  for (const [index, file] of files.entries()) {
    let upload = await jsonRequest<UploadResponse>("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      ownerUserId: item.userId, clientUploadId: `${item.id}_${item.uploadGeneration ?? "v1"}_${index}`, projectId: item.projectId, dailyTaskId: item.type === "PERSONNEL_FILE" ? item.taskId : undefined,
      projectVisitId: item.type === "VISIT_FILE" ? item.projectVisitId : undefined,
      originalName: file.name || `dosya-${index + 1}`, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, note: item.note,
    }) });
    if (upload.status === "CANCELLED") await restartExpiredUpload(item);
    let conflicts = 0;
    while (upload.offsetBytes < file.size) {
      const chunk = file.slice(upload.offsetBytes, Math.min(file.size, upload.offsetBytes + 128 * 1024));
      const response = await boundedFetch(`/api/uploads/${upload.uploadId}`, { method: "PATCH", headers: { "Upload-Offset": String(upload.offsetBytes), "Content-Type": "application/octet-stream" }, body: chunk }, 120_000);
      if (response.status === 410) await restartExpiredUpload(item);
      if (response.status === 409) {
        if (++conflicts > 3) throw new QueueError("Yükleme başka bir sekmede işleniyor. Kayıt korunarak yeniden denenecek.", 409);
        upload = await jsonRequest<UploadResponse>(`/api/uploads/${upload.uploadId}`); continue;
      }
      const payload = await response.json().catch(() => ({}));
      if (response.redirected || response.status === 401) throw new QueueError("Oturum süresi doldu; dosya cihazda korunuyor.", 401);
      if (!response.ok || payload.ok !== true) throw new QueueError(payload.error || "Dosya parçası gönderilemedi.", response.status);
      upload = payload as UploadResponse; conflicts = 0;
      onProgress(Math.round(((index + upload.offsetBytes / file.size) / files.length) * 96));
    }
    await jsonRequest(`/api/uploads/${upload.uploadId}/finalize`, { method: "POST" });
  }
}
