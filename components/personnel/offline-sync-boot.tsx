"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { dismissOfflineNotifications, getOfflineSyncProgress, listOfflineItems, syncOfflineItems, type OfflineQueueItem, type OfflineQueueKind } from "@/lib/offline/queue";
import { UploadProgress } from "@/components/personnel/upload-progress";

function ready(item: OfflineQueueItem) {
  return item.status !== "FAILED" && (item.nextAttemptAt ?? 0) <= Date.now() && (item.sendingUntil ?? 0) <= Date.now();
}

export function OfflineSyncBoot({ kind = "VISIT_UPLOAD", userId }: Readonly<{ kind?: OfflineQueueKind; userId: string }>) {
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let disposed = false;
    let busy = false;
    let eventsBusy = false;
    let rerun = false;
    const dismissalKey = `kagu-queue-dismissed:${userId}:${kind}`;
    let dismissedIds: string[] | null = null;
    try { const stored = JSON.parse(sessionStorage.getItem(dismissalKey) ?? "null"); if (Array.isArray(stored)) dismissedIds = stored; } catch {}
    setDismissed(dismissedIds !== null);
    async function dismiss(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail.userId !== userId || detail.kind !== kind) return;
      setDismissed(true);
      dismissedIds = (await listOfflineItems([kind], userId).catch(() => [])).map((item) => item.id);
      try { sessionStorage.setItem(dismissalKey, JSON.stringify(dismissedIds)); } catch {}
    }
    function show(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail.userId !== userId || detail.kind !== kind) return;
      dismissedIds = null; setDismissed(false);
      try { sessionStorage.removeItem(dismissalKey); } catch {}
    }
    function syncProgress() {
      const active = getOfflineSyncProgress(userId, kind);
      if (active) updateMessage(`${active.current}/${active.total} kayıt gönderiliyor...`, active.overallProgress);
      else if (!disposed) setProgress(null);
    }
    const updateMessage = (value: string, percentage: number | null = null) => {
      if (!disposed) { setMessage(value); setProgress(percentage); }
    };

    async function syncEventPriority() {
      if (disposed || kind !== "PERSONNEL" || eventsBusy || !navigator.onLine) return;
      eventsBusy = true;
      try {
        const items = await listOfflineItems([kind], userId);
        if (!items.some((item) => item.type === "PERSONNEL_EVENT" && ready(item))) return;
        const result = await syncOfflineItems({ userId, kinds: [kind], eventsOnly: true });
        if (result.synced > 0 && !disposed) router.refresh();
      } catch {
        updateMessage("Saha kayıtları cihazda korunuyor; tekrar denenecek.");
      } finally { eventsBusy = false; }
    }

    async function syncPending() {
      if (disposed) return;
      if (busy) { rerun = true; return; }
      busy = true;
      rerun = false;
      try {
        await syncEventPriority();
        const items = await listOfflineItems([kind], userId);
        if (dismissedIds && items.some((item) => !dismissedIds!.includes(item.id))) {
          dismissedIds = null; setDismissed(false);
          try { sessionStorage.removeItem(dismissalKey); } catch {}
        }
        if (items.length === 0) { updateMessage(""); return; }
        if (!navigator.onLine) { updateMessage(`${items.length} kayıt cihazda saklanıyor; bağlantı bekliyor.`); return; }
        const dependencyIds = new Set(items.filter((item) => item.type === "PERSONNEL_EVENT").map((item) => item.id));
        const canSend = items.some((item) => ready(item) && (item.type !== "PERSONNEL_FILE" || !dependencyIds.has(item.dependencyId)));
        if (!canSend) {
          const active = getOfflineSyncProgress(userId, kind);
          if (active) { syncProgress(); return; }
          const failed = items.filter((item) => item.status === "FAILED").length;
          updateMessage(failed > 0 ? `${failed} kayıt için işlem gerekiyor. Dosyalar cihazda korunuyor.` : `${items.length} kayıt gönderimi bekliyor.`);
          return;
        }
        const result = await syncOfflineItems({
          userId, kinds: [kind],
          onProgress: ({ current, total, overallProgress }) => updateMessage(`${current}/${total} kayıt gönderiliyor...`, overallProgress),
        });
        if (result.synced > 0 && !disposed) router.refresh();
        updateMessage(result.remaining > 0 ? result.error || `${result.remaining} kayıt cihazda bekliyor.` : "");
      } catch {
        updateMessage("Cihaz kayıtları okunamadı; kayıtları silmeden tekrar deneyin.");
      } finally {
        busy = false;
        if (rerun && !disposed) window.setTimeout(() => { void syncPending(); }, 0);
      }
    }

    function queueChanged() {
      // Short events can continue even while syncPending is sending a large video.
      void syncEventPriority();
      void syncPending();
    }
    function visibilityChanged() { if (document.visibilityState === "visible") queueChanged(); }
    queueChanged();
    window.addEventListener("online", queueChanged);
    window.addEventListener("kagu-queue-changed", queueChanged);
    window.addEventListener("kagu-sync-progress", syncProgress);
    window.addEventListener("kagu-dismiss-queue-notifications", dismiss);
    window.addEventListener("kagu-show-queue-notifications", show);
    syncProgress();
    document.addEventListener("visibilitychange", visibilityChanged);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") queueChanged(); }, 15_000);
    return () => {
      disposed = true;
      window.removeEventListener("online", queueChanged);
      window.removeEventListener("kagu-queue-changed", queueChanged);
      window.removeEventListener("kagu-sync-progress", syncProgress);
      window.removeEventListener("kagu-dismiss-queue-notifications", dismiss);
      window.removeEventListener("kagu-show-queue-notifications", show);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.clearInterval(interval);
    };
  }, [kind, router, userId]);

  if (!message || dismissed) return null;
  return (
    <div
      className="fixed bottom-24 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 overflow-hidden rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-lg md:bottom-4"
      role="status">
      <div className="relative flex items-center justify-between gap-3"><span>{message}</span><button aria-label="Bildirimleri kaldır" className="shrink-0 rounded border px-2 py-1 text-xs" onClick={() => dismissOfflineNotifications(userId, kind)} type="button">Kapat</button></div>
      {progress !== null ? <UploadProgress value={progress} /> : null}
      <Link className="relative mt-1 inline-block text-xs text-primary underline" href={kind === "PERSONNEL" ? "/personnel/settings#bekleyen-kayitlar" : "/admin/visits#bekleyen-kayitlar"}>Bekleyen kayıtları aç</Link>
    </div>
  );
}
