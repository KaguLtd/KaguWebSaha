"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function PendingHeicRefresh() {
  const router = useRouter();
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let hadPending = false;
    let version: string | null | undefined;
    async function check() {
      let interval = 60_000;
      try {
        if (document.visibilityState === "visible" && navigator.onLine) {
          const response = await fetch("/api/files/pending-heic", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
          if (response.ok && !response.redirected) {
            const data = await response.json() as { pendingCount: number; failedCount?: number; completedVersion?: string | null };
            if (!disposed) {
              setFailed(data.failedCount ?? 0);
              if ((version !== undefined && data.completedVersion !== version) || (hadPending && data.pendingCount === 0)) router.refresh();
              version = data.completedVersion;
              hadPending = data.pendingCount > 0;
              if (hadPending) interval = 10_000;
            }
          }
        }
      } catch { /* Polling resumes without changing an accepted upload's result. */ }
      finally { if (!disposed) timer = setTimeout(() => { void check(); }, interval); }
    }
    const start = () => { clearTimeout(timer); void check(); };
    start();
    window.addEventListener("kagu-queue-changed", start);
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener("kagu-queue-changed", start); };
  }, [router]);
  return failed > 0 ? <div className="mx-auto my-4 max-w-3xl rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">{failed} dosyanın dönüşümü veya önizlemesi tamamlanamadı. Kaynak dosyalar korunuyor; yönetici Dosya İşleri ekranından tekrar deneyebilir.</div> : null;
}
