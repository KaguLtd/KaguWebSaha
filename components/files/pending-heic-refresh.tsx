"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function PendingHeicRefresh() {
  const router = useRouter();
  const hadPending = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function checkPendingHeic() {
      try {
        const response = await fetch("/api/files/pending-heic", {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as {
          completedVersion?: null | string;
          pendingCount?: number;
        };
        const pendingCount = data.pendingCount ?? 0;
        const completedVersion = data.completedVersion ?? null;
        const seenVersion = window.sessionStorage.getItem("file-processing-version");

        if (completedVersion && completedVersion !== seenVersion) {
          window.sessionStorage.setItem("file-processing-version", completedVersion);
          router.refresh();
        } else if (hadPending.current && pendingCount === 0) {
          router.refresh();
        }

        hadPending.current = pendingCount > 0;
      } catch {
        // Polling is best-effort; file processing continues server-side.
      }
    }

    void checkPendingHeic();
    const interval = window.setInterval(() => {
      if (isMounted) {
        void checkPendingHeic();
      }
    }, 2500);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [router]);

  return null;
}
