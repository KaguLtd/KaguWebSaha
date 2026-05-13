"use client";

import { createClientId } from "@/lib/offline/client-id";

export type OfflineItemType = "ARRIVED_SITE" | "LEFT_SITE";

export type OfflineQueueItem = {
  id: string;
  type: OfflineItemType;
  taskId: string;
  note?: string;
  latitude?: string;
  longitude?: string;
  files?: File[];
  createdAt: string;
};

const DB_NAME = "kagu-saha-offline";
const STORE_NAME = "pending-items";
const DB_VERSION = 1;

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
  item: Omit<OfflineQueueItem, "id" | "createdAt">,
) {
  const queuedItem: OfflineQueueItem = {
    ...item,
    id: createClientId(),
    createdAt: new Date().toISOString(),
  };

  await withStore("readwrite", (store) => store.add(queuedItem));

  return queuedItem;
}

export async function listOfflineItems() {
  const items = await withStore<OfflineQueueItem[]>("readonly", (store) =>
    store.getAll(),
  );

  return items ?? [];
}

export async function deleteOfflineItem(id: string) {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function syncOfflineItems() {
  if (!navigator.onLine) {
    return {
      synced: 0,
      remaining: (await listOfflineItems()).length,
    };
  }

  const items = await listOfflineItems();
  let synced = 0;

  for (const item of items) {
    const formData = new FormData();
    formData.set("clientItemId", item.id);
    formData.set("type", item.type);
    formData.set("taskId", item.taskId);
    formData.set("createdAt", item.createdAt);

    if (item.note) {
      formData.set("note", item.note);
    }

    if (item.latitude && item.longitude) {
      formData.set("latitude", item.latitude);
      formData.set("longitude", item.longitude);
    }

    for (const file of item.files ?? []) {
      formData.append("files", file);
    }

    const response = await fetch("/api/offline/sync", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      break;
    }

    await deleteOfflineItem(item.id);
    synced += 1;
  }

  return {
    synced,
    remaining: (await listOfflineItems()).length,
  };
}
