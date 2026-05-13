"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { listOfflineItems, syncOfflineItems } from "@/lib/offline/queue";

export function OfflineSyncBoot() {
  const [message, setMessage] = useState("");
  const syncingRef = useRef(false);
  const router = useRouter();

  async function syncPending() {
    if (syncingRef.current) {
      return;
    }

    syncingRef.current = true;

    try {
      const before = await listOfflineItems();

      if (before.length > 0) {
        setMessage(`${before.length} bekleyen kayit gonderiliyor...`);
      }

      const result = await syncOfflineItems();

      if (result.synced > 0) {
        setMessage(`${result.synced} bekleyen kayit gonderildi.`);
        router.refresh();
        window.setTimeout(() => setMessage(""), 3500);
        return;
      }

      setMessage(result.remaining > 0 ? `${result.remaining} kayit bekliyor.` : "");
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

    return () => {
      window.removeEventListener("online", syncPending);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  if (!message) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-lg">
      {message}
    </div>
  );
}
