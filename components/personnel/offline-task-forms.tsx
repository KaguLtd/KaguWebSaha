"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  enqueueOfflineItem,
  listOfflineItems,
  syncOfflineItems,
  type OfflineItemType,
} from "@/lib/offline/queue";
import { createClientId } from "@/lib/offline/client-id";

type SyncState = {
  pending: number;
  message: string;
};

function useOfflineSync() {
  const [state, setState] = useState<SyncState>({
    pending: 0,
    message: "",
  });
  const router = useRouter();

  async function refreshPending() {
    const items = await listOfflineItems();
    setState((current) => ({
      ...current,
      pending: items.length,
    }));
  }

  async function syncNow() {
    const result = await syncOfflineItems();
    setState({
      pending: result.remaining,
      message:
        result.synced > 0
          ? `${result.synced} bekleyen kayit gonderildi.`
          : result.remaining > 0
            ? `${result.remaining} kayit bekliyor.`
            : "",
    });

    if (result.synced > 0) {
      router.refresh();
    }
  }

  useEffect(() => {
    refreshPending();
    syncNow();

    window.addEventListener("online", syncNow);

    return () => {
      window.removeEventListener("online", syncNow);
    };
  }, []);

  return {
    state,
    refreshPending,
    syncNow,
    setState,
  };
}

async function submitOrQueue(
  type: OfflineItemType,
  form: HTMLFormElement,
  setMessage: (message: string) => void,
) {
  const formData = new FormData(form);
  const taskId = String(formData.get("taskId") ?? "");
  const note = String(formData.get("note") ?? "");
  const latitude = String(formData.get("latitude") ?? "");
  const longitude = String(formData.get("longitude") ?? "");
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (!navigator.onLine) {
    await enqueueOfflineItem({
      type,
      taskId,
      note: note || undefined,
      latitude: latitude || undefined,
      longitude: longitude || undefined,
      files,
    });
    setMessage("Internet yok. Islem bekleyen kayitlara alindi.");
    return "queued";
  }

  formData.set("clientItemId", createClientId());
  formData.set("type", type);

  const response = await fetch("/api/offline/sync", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    await enqueueOfflineItem({
      type,
      taskId,
      note: note || undefined,
      latitude: latitude || undefined,
      longitude: longitude || undefined,
      files,
    });
    setMessage("Sunucuya ulasilamadi. Islem bekleyen kayitlara alindi.");
    return "queued";
  }

  setMessage("Islem kaydedildi.");
  return "synced";
}

export function OfflineArriveForm({
  children,
  taskId,
}: Readonly<{
  children: React.ReactNode;
  taskId: string;
}>) {
  const router = useRouter();
  const { state, refreshPending, setState } = useOfflineSync();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setState((current) => ({ ...current, message: "Kaydediliyor..." }));
    try {
      const result = await submitOrQueue("ARRIVED_SITE", event.currentTarget, (message) =>
        setState((current) => ({ ...current, message })),
      );
      await refreshPending();

      if (result === "synced") {
        router.refresh();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input name="taskId" type="hidden" value={taskId} />
      <fieldset disabled={isSubmitting}>{children}</fieldset>
      <PendingNotice state={state} />
    </form>
  );
}

export function OfflineLeaveForm({
  children,
  taskId,
}: Readonly<{
  children: React.ReactNode;
  taskId: string;
}>) {
  const router = useRouter();
  const { state, refreshPending, setState } = useOfflineSync();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setState((current) => ({ ...current, message: "Kaydediliyor..." }));
    try {
      const result = await submitOrQueue("LEFT_SITE", event.currentTarget, (message) =>
        setState((current) => ({ ...current, message })),
      );
      await refreshPending();

      if (result === "synced") {
        router.refresh();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="w-full text-left" onSubmit={handleSubmit}>
      <input name="taskId" type="hidden" value={taskId} />
      <fieldset disabled={isSubmitting}>{children}</fieldset>
      <PendingNotice state={state} />
    </form>
  );
}

function PendingNotice({ state }: { state: SyncState }) {
  if (!state.message && state.pending === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
      {state.message || `${state.pending} bekleyen kayit var.`}
    </div>
  );
}
