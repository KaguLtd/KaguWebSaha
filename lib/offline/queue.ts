"use client";

import { createClientId } from "@/lib/offline/client-id";

export type OfflineItemType = "ARRIVED_SITE" | "LEFT_SITE" | "NOTE";
export type OfflineQueueKind = "PERSONNEL" | "VISIT_UPLOAD";

type QueueItemBase = {
  id: string;
  files?: File[];
  expectedFileCount?: number;
  createdAt: string;
};

export type PersonnelOfflineQueueItem = QueueItemBase & {
  type: OfflineItemType;
  taskId: string;
  note?: string;
  latitude?: string;
  longitude?: string;
};

export type VisitUploadQueueItem = QueueItemBase & {
  type: "VISIT_FILE";
  projectId: string;
  projectVisitId?: string;
  note?: string;
};

export type OfflineQueueItem = PersonnelOfflineQueueItem | VisitUploadQueueItem;

export type OfflineSyncProgress = {
  current: number;
  itemId: string;
  kind: OfflineQueueKind;
  progress: number;
  total: number;
};

export type OfflineSyncResult = {
  error?: string;
  failedIds: string[];
  remaining: number;
  synced: number;
};

type SyncOptions = {
  kinds?: OfflineQueueKind[];
  onProgress?: (progress: OfflineSyncProgress) => void;
};

const DB_NAME = "kagu-saha-offline";
const STORE_NAME = "pending-items";
const DB_VERSION = 1;
const activeSyncs = new Map<
  string,
  {
    listeners: Set<(progress: OfflineSyncProgress) => void>;
    promise: Promise<OfflineSyncResult>;
  }
>();

function openQueueDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
) {
  const db = await openQueueDb();

  return new Promise<T | void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = run(store);

    if (request) {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }

    transaction.oncomplete = () => {
      if (!request) {
        resolve();
      }
      db.close();
    };
    transaction.onerror = () => {
      reject(transaction.error);
      db.close();
    };
  });
}

export async function enqueueOfflineItem(
  item: Omit<PersonnelOfflineQueueItem, "id" | "createdAt">,
) {
  return addQueueItem(item);
}

export async function enqueueVisitUpload(
  item: Omit<VisitUploadQueueItem, "id" | "createdAt" | "type">,
) {
  return addQueueItem({ ...item, type: "VISIT_FILE" as const });
}

async function addQueueItem(
  item: Omit<OfflineQueueItem, "id" | "createdAt">,
) {
  const queuedItem = {
    ...item,
    id: createClientId(),
    createdAt: new Date().toISOString(),
    expectedFileCount: item.files?.filter((file) => file.size > 0).length ?? 0,
  } as OfflineQueueItem;

  await withStore("readwrite", (store) => store.add(queuedItem));

  return queuedItem;
}

export async function replaceOfflineItemFiles(id: string, files: File[]) {
  const item = await withStore<OfflineQueueItem | undefined>("readonly", (store) =>
    store.get(id),
  );

  if (!item) {
    return;
  }

  await withStore("readwrite", (store) =>
    store.put({ ...item, expectedFileCount: files.length, files }),
  );
}

export async function listOfflineItems(kinds?: OfflineQueueKind[]) {
  const items =
    (await withStore<OfflineQueueItem[]>("readonly", (store) => store.getAll())) ?? [];
  const allowedKinds = kinds ? new Set(kinds) : null;

  return items
    .filter((item) => !allowedKinds || allowedKinds.has(getQueueItemKind(item)))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function deleteOfflineItem(id: string) {
  await withStore("readwrite", (store) => store.delete(id));
}

export function syncOfflineItems(options: SyncOptions = {}) {
  const kinds = options.kinds ?? ["PERSONNEL", "VISIT_UPLOAD"];
  const syncKey = [...kinds].sort().join(",");
  const currentSync = activeSyncs.get(syncKey);

  if (currentSync) {
    if (options.onProgress) {
      currentSync.listeners.add(options.onProgress);
      void currentSync.promise.finally(() => {
        currentSync.listeners.delete(options.onProgress!);
      });
    }

    return currentSync.promise;
  }

  const listeners = new Set<(progress: OfflineSyncProgress) => void>();
  if (options.onProgress) {
    listeners.add(options.onProgress);
  }

  const promise = runSync(kinds, (progress) => {
    for (const listener of listeners) {
      listener(progress);
    }
  })
    .catch(async () => ({
      error: "Cihazdaki yükleme kuyruğu okunamadı; uygulama yeniden açıldığında tekrar denenecek.",
      failedIds: [],
      synced: 0,
      remaining: (await listOfflineItems(kinds).catch(() => [])).length,
    }))
    .finally(() => {
      activeSyncs.delete(syncKey);
    });

  activeSyncs.set(syncKey, { listeners, promise });
  return promise;
}

async function runSync(
  kinds: OfflineQueueKind[],
  onProgress: (progress: OfflineSyncProgress) => void,
): Promise<OfflineSyncResult> {
  if (!navigator.onLine) {
    return {
      failedIds: [],
      synced: 0,
      remaining: (await listOfflineItems(kinds)).length,
    };
  }

  const failedIds: string[] = [];
  let synced = 0;
  let error: string | undefined;

  while (!error) {
    const items = await listOfflineItems(kinds);

    if (items.length === 0) {
      break;
    }

    for (const [index, item] of items.entries()) {
      const kind = getQueueItemKind(item);
      const reportProgress = (itemProgress: number) => {
        onProgress({
          current: index + 1,
          itemId: item.id,
          kind,
          progress: Math.round(((index + itemProgress / 100) / items.length) * 100),
          total: items.length,
        });
      };

      reportProgress(0);

      try {
        const response = await postQueueItem(item, reportProgress);

        if (!response.ok) {
          const responseError = response.error || "Kayıt gönderilemedi.";

          if ([400, 404, 413, 422].includes(response.status)) {
            await deleteOfflineItem(item.id);
            failedIds.push(item.id);
            error = responseError;
            break;
          }

          error = responseError;
          break;
        }

        await deleteOfflineItem(item.id);
        synced += 1;
        reportProgress(100);
      } catch {
        error = "Bağlantı kesildi. Kayıt cihazda saklandı ve tekrar denenecek.";
        break;
      }
    }
  }

  return {
    error,
    failedIds,
    synced,
    remaining: (await listOfflineItems(kinds)).length,
  };
}

function getQueueItemKind(item: OfflineQueueItem): OfflineQueueKind {
  return item.type === "VISIT_FILE" ? "VISIT_UPLOAD" : "PERSONNEL";
}

function postQueueItem(
  item: OfflineQueueItem,
  onProgress: (progress: number) => void,
) {
  const files = (item.files ?? []).filter(
    (file) => file instanceof Blob && file.size > 0,
  );

  if ((item.expectedFileCount ?? 0) > files.length) {
    return Promise.resolve({
      error:
        "Önceki dosyalarınız yüklenemedi! Dosyalar cihaz depolamasında bulunamadı; lütfen yeniden seçip yükleyin.",
      ok: false,
      status: 422,
    });
  }

  const formData = new FormData();
  let jsonBody: Record<string, string> | null = null;
  let endpoint: string;

  if (item.type === "VISIT_FILE") {
    endpoint = "/api/admin/visits";
    formData.set("clientItemId", item.id);
    formData.set("operation", "file");
    formData.set("projectId", item.projectId);
    if (item.projectVisitId) {
      formData.set("projectVisitId", item.projectVisitId);
    }
  } else {
    endpoint = "/api/offline/sync";
    jsonBody = {
      clientItemId: item.id,
      type: item.type,
      taskId: item.taskId,
      createdAt: item.createdAt,
    };
    if (item.latitude && item.longitude) {
      jsonBody.latitude = item.latitude;
      jsonBody.longitude = item.longitude;
    }
  }

  if (item.note) {
    if (jsonBody) {
      jsonBody.note = item.note;
    } else {
      formData.set("note", item.note);
    }
  }

  for (const [index, file] of files.entries()) {
    const fileName = file instanceof File && file.name
      ? file.name
      : `bekleyen-dosya-${index + 1}`;
    formData.append("files", file, fileName);
  }

  return new Promise<{ error?: string; ok: boolean; status: number }>(
    (resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", endpoint);

      const useJson = jsonBody !== null && files.length === 0;
      if (useJson) {
        request.setRequestHeader("Content-Type", "application/json");
      } else if (jsonBody) {
        for (const [name, value] of Object.entries(jsonBody)) {
          formData.set(name, value);
        }
      }

      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.min(96, Math.round((event.loaded / event.total) * 96)));
        }
      };
      request.onerror = () => reject(new Error("Upload failed"));
      request.ontimeout = () => reject(new Error("Upload timed out"));
      request.onload = () => {
        let payload: { error?: string; ok?: boolean } = {};
        const contentType = request.getResponseHeader("content-type") ?? "";
        try {
          payload = JSON.parse(request.responseText || "{}");
        } catch {
          // API başarıları her zaman JSON olarak ve ok: true ile dönmelidir.
        }

        const responsePath = request.responseURL
          ? new URL(request.responseURL, window.location.href).pathname
          : "";
        const receivedApiSuccess =
          request.status >= 200 &&
          request.status < 300 &&
          contentType.includes("application/json") &&
          payload.ok === true;

        if (
          responsePath === "/login" ||
          (request.status >= 200 && request.status < 300 && !receivedApiSuccess)
        ) {
          resolve({
            error:
              "Oturum süresi doldu. Bekleyen dosyalar cihazda korundu; giriş yaptıktan sonra tekrar yüklenecek.",
            ok: false,
            status: 401,
          });
          return;
        }

        resolve({
          error: payload.error,
          ok: receivedApiSuccess,
          status: request.status,
        });
      };

      request.send(useJson ? JSON.stringify(jsonBody) : formData);
    },
  );
}
