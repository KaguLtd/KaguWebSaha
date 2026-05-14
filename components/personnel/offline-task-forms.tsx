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

  let response: Response;

  try {
    response = await fetch("/api/offline/sync", {
      method: "POST",
      body: formData,
    });
  } catch {
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

  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setMessage(payload?.error || "Islem kaydedilemedi.");
      return "failed";
    }

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
  disabled,
  disabledMessage,
  taskId,
}: Readonly<{
  children: React.ReactNode;
  disabled?: boolean;
  disabledMessage?: string;
  taskId: string;
}>) {
  const router = useRouter();
  const { state, refreshPending, setState } = useOfflineSync();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setState((current) => ({ ...current, message: "Kaydediliyor..." }));
    try {
      const result = await submitOrQueue("ARRIVED_SITE", form, (message) =>
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
    <form className="flex w-full flex-col items-center text-left" onSubmit={handleSubmit}>
      <input name="taskId" type="hidden" value={taskId} />
      <fieldset
        className="flex w-full flex-col items-center"
        disabled={isSubmitting || disabled}
      >
        {children}
      </fieldset>
      <PendingNotice
        state={{
          ...state,
          message: disabled ? disabledMessage || state.message : state.message,
        }}
      />
    </form>
  );
}

export function OfflineLeaveForm({
  children,
  hasTodayNote,
  taskId,
}: Readonly<{
  children: React.ReactNode;
  hasTodayNote: boolean;
  taskId: string;
}>) {
  const router = useRouter();
  const { state, refreshPending, setState } = useOfflineSync();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmSeconds, setConfirmSeconds] = useState(0);
  const isConfirming = confirmSeconds > 0;

  useEffect(() => {
    if (confirmSeconds === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setConfirmSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [confirmSeconds]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (isSubmitting) {
      return;
    }

    if (!hasTodayNote) {
      setState((current) => ({
        ...current,
        message: "Bugün yaptıklarının notunu yaz!",
      }));
      return;
    }

    if (!isConfirming) {
      setConfirmSeconds(5);
      setState((current) => ({
        ...current,
        message: "",
      }));
      return;
    }

    setIsSubmitting(true);
    setState((current) => ({ ...current, message: "Kaydediliyor..." }));
    try {
      const result = await submitOrQueue("LEFT_SITE", form, (message) =>
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
    <form className="flex w-full flex-col items-center text-left" onSubmit={handleSubmit}>
      <input name="taskId" type="hidden" value={taskId} />
      <fieldset className="flex w-full flex-col items-center" disabled={isSubmitting}>
        {children}
        <button
          className={`flex h-44 w-44 flex-col items-center justify-center rounded-full px-6 text-center text-2xl font-semibold leading-tight text-white shadow-lg transition focus:outline-none focus:ring-4 ${
            isConfirming
              ? "bg-orange-500 hover:bg-orange-600 focus:ring-orange-200"
              : "bg-red-600 hover:bg-red-700 focus:ring-red-200"
          }`}
          type="submit"
        >
          {isConfirming ? (
            <>
              <span className="text-4xl leading-none">{confirmSeconds}</span>
              <span className="mt-2 text-base font-semibold">Emin Misiniz?</span>
            </>
          ) : (
            "Sahadan Ayrıldım"
          )}
        </button>
      </fieldset>
      <PendingNotice state={state} />
    </form>
  );
}

export function OfflineNoteForm({
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
    const form = event.currentTarget;

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setState((current) => ({ ...current, message: "Kaydediliyor..." }));
    try {
      const result = await submitOrQueue("NOTE", form, (message) =>
        setState((current) => ({ ...current, message })),
      );
      await refreshPending();

      if (result === "synced") {
        form.reset();
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
