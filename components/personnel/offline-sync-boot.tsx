"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  listOfflineItems,
  syncOfflineItems,
  type OfflineQueueKind,
} from "@/lib/offline/queue";

export function OfflineSyncBoot({
  kind = "VISIT_UPLOAD",
}: Readonly<{
  kind?: OfflineQueueKind;
}>) {
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const syncingRef = useRef(false);
  const router = useRouter();

  async function syncPending() {
    if (syncingRef.current) {
      return;
    }

    syncingRef.current = true;

    try {
      const before = await listOfflineItems([kind]);

      if (before.length > 0) {
        setMessage(
          navigator.onLine
            ? `${before.length} bekleyen kayıt gönderiliyor...`
            : `${before.length} kayıt bağlantı bekliyor.`,
        );
      } else {
        setMessage("");
        setProgress(null);
        return;
      }

      const result = await syncOfflineItems({
        kinds: [kind],
        onProgress: ({ current, progress: nextProgress, total }) => {
          setMessage(`${current}/${total} kayıt yükleniyor...`);
          setProgress(nextProgress);
        },
      });

      if (result.failedIds.length > 0) {
        setProgress(null);
        setMessage(result.error || "Önceki kayıtlarınız yüklenemedi!");
        if (result.synced > 0) {
          router.refresh();
        }
        return;
      }

      if (result.synced > 0) {
        setMessage(
          result.remaining > 0
            ? result.error || `${result.remaining} kayıt tekrar denenecek.`
            : `${result.synced} bekleyen kayıt gönderildi.`,
        );
        setProgress(result.remaining > 0 ? null : 100);
        router.refresh();
        if (result.remaining === 0) {
          window.setTimeout(() => {
            setMessage("");
            setProgress(null);
          }, 3500);
        }
        return;
      }

      setProgress(null);
      setMessage(
        result.remaining > 0
          ? result.error || `${result.remaining} kayıt bağlantı bekliyor.`
          : result.error || "",
      );
    } catch {
      const remaining = await listOfflineItems([kind]).catch(() => []);
      setProgress(null);
      setMessage(
        remaining.length > 0
          ? `${remaining.length} kayıt cihazda saklanıyor; tekrar denenecek.`
          : "",
      );
    } finally {
      syncingRef.current = false;
    }
  }

  useEffect(() => {
    syncPending();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        syncPending();
      }
    }

    window.addEventListener("online", syncPending);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const retryInterval = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        syncPending();
      }
    }, 15000);

    return () => {
      window.removeEventListener("online", syncPending);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(retryInterval);
    };
  }, [kind]);

  if (!message) {
    return null;
  }

  return (
    <div
      aria-valuemax={progress !== null ? 100 : undefined}
      aria-valuemin={progress !== null ? 0 : undefined}
      aria-valuenow={progress ?? undefined}
      className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 overflow-hidden rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-lg"
      role={progress !== null ? "progressbar" : "status"}
    >
      {progress !== null ? (
        <div
          className="absolute inset-y-0 left-0 overflow-hidden bg-primary/10 transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        >
          <div className="h-full w-full animate-pulse bg-gradient-to-r from-primary/5 via-primary/25 to-primary/10" />
        </div>
      ) : null}
      <div className="relative flex items-center justify-between gap-3">
        <span>{message}</span>
        {progress !== null ? (
          <span className="shrink-0 tabular-nums">%{progress}</span>
        ) : null}
      </div>
    </div>
  );
}
