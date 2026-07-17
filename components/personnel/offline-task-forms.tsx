"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  enqueueOfflineItem,
  listOfflineItems,
  replaceOfflineItemFiles,
  syncOfflineItems,
  type OfflineItemType,
} from "@/lib/offline/queue";
import {
  isCompressibleImage,
  prepareFilesForUpload,
} from "@/lib/client/image-compression";

type SyncState = {
  pending: number;
  message: string;
  progress: number | null;
};

function useOfflineSync() {
  const [state, setState] = useState<SyncState>({
    pending: 0,
    message: "",
    progress: null,
  });
  const router = useRouter();

  async function refreshPending() {
    const items = await listOfflineItems(["PERSONNEL"]);
    setState((current) => ({
      ...current,
      pending: items.length,
    }));
  }

  async function syncNow() {
    const result = await syncOfflineItems({
      kinds: ["PERSONNEL"],
      onProgress: ({ current, progress, total }) => {
        setState((currentState) => ({
          ...currentState,
          message: `${current}/${total} kayıt yükleniyor...`,
          progress,
        }));
      },
    });
    setState({
      pending: result.remaining,
      progress: null,
      message:
        result.failedIds.length > 0
          ? result.error || "Önceki kayıtlarınız yüklenemedi!"
          : result.error && result.remaining > 0
          ? result.error
          : result.synced > 0
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
  setProgress: (progress: number | null) => void,
) {
  await refreshFormLocation(form);

  const formData = new FormData(form);
  const taskId = String(formData.get("taskId") ?? "");
  const note = String(formData.get("note") ?? "");
  const latitude = String(formData.get("latitude") ?? "");
  const longitude = String(formData.get("longitude") ?? "");
  let files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);
  const hasFiles = files.length > 0;
  let queuedItem;

  try {
    queuedItem = await enqueueOfflineItem({
      type,
      taskId,
      note: note || undefined,
      latitude: latitude || undefined,
      longitude: longitude || undefined,
      files,
    });
  } catch {
    setProgress(null);
    setMessage(
      "Kayıt cihazdaki güvenli kuyruğa alınamadı. Depolama alanını kontrol edip tekrar deneyin.",
    );
    return "failed";
  }

  if (type === "NOTE" && hasFiles) {
    const hasVideo = files.some((file) => file.type.toLowerCase().startsWith("video/"));
    const hasCompressibleImage = files.some(isCompressibleImage);
    const isPreparingUpload = hasCompressibleImage || hasVideo;

    if (hasCompressibleImage) {
      setMessage("Fotoğraflar yükleme için hazırlanıyor...");
    } else if (hasVideo) {
      setMessage(
        "Video yüklemesi uzun sürebilir; ekran kapansa da tekrar açıldığında devam eder.",
      );
    }

    if (isPreparingUpload) {
      setProgress(8);
    }

    files = await prepareFilesForUpload(files);
    await replaceOfflineItemFiles(queuedItem.id, files);

    if (hasCompressibleImage && hasVideo) {
      setMessage(
        "Video yüklemesi uzun sürebilir; ekran kapansa da tekrar açıldığında devam eder.",
      );
      setProgress(10);
    }
  }

  if (!navigator.onLine) {
    setProgress(null);
    setMessage("Internet yok. Islem bekleyen kayitlara alindi.");
    return "queued";
  }

  if (type === "NOTE" && hasFiles) {
    setMessage("Yükleniyor...");
    setProgress(12);
  }

  const result = await syncOfflineItems({
    kinds: ["PERSONNEL"],
    onProgress: ({ current, progress, total }) => {
      setProgress(progress);
      setMessage(`${current}/${total} kayıt yükleniyor...`);
    },
  });

  if (result.failedIds.includes(queuedItem.id)) {
    setProgress(null);
    setMessage(result.error || "İşlem kaydedilemedi.");
    return "failed";
  }

  const isStillQueued = (await listOfflineItems(["PERSONNEL"])).some(
    (item) => item.id === queuedItem.id,
  );

  if (isStillQueued) {
    setProgress(null);
    setMessage(
      result.error || "Bağlantı kesildi. Kayıt cihazda saklandı ve tekrar denenecek.",
    );
    return "queued";
  }

  setProgress(100);
  setMessage("Islem kaydedildi.");
  return "synced";
}

function refreshFormLocation(form: HTMLFormElement) {
  if (!window.isSecureContext || !("geolocation" in navigator)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = form.elements.namedItem("latitude");
        const longitude = form.elements.namedItem("longitude");

        if (latitude instanceof HTMLInputElement) {
          latitude.value = String(position.coords.latitude);
        }

        if (longitude instanceof HTMLInputElement) {
          longitude.value = String(position.coords.longitude);
        }

        resolve();
      },
      () => resolve(),
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 8000,
      },
    );
  });
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
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setState((current) => ({
      ...current,
      message: "Kaydediliyor...",
      progress: 6,
    }));
    try {
      const result = await submitOrQueue(
        "ARRIVED_SITE",
        form,
        (message) => setState((current) => ({ ...current, message })),
        (progress) => setState((current) => ({ ...current, progress })),
      );
      await refreshPending();

      if (result === "synced") {
        router.refresh();
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <form
      aria-busy={isSubmitting}
      className="flex w-full flex-col items-center text-left"
      onSubmit={handleSubmit}
    >
      <input name="taskId" type="hidden" value={taskId} />
      <fieldset className="flex w-full flex-col items-center" disabled={disabled}>
        {children}
      </fieldset>
      <PendingNotice
        isWorking={isSubmitting}
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
  const submittingRef = useRef(false);
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

    if (submittingRef.current) {
      return;
    }

    if (!hasTodayNote) {
      setState((current) => ({
        ...current,
        message: "Bugün yaptıklarının notunu yaz!",
        progress: null,
      }));
      return;
    }

    if (!isConfirming) {
      setConfirmSeconds(5);
      setState((current) => ({
        ...current,
        message: "",
        progress: null,
      }));
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setState((current) => ({
      ...current,
      message: "Kaydediliyor...",
      progress: 6,
    }));
    try {
      const result = await submitOrQueue(
        "LEFT_SITE",
        form,
        (message) => setState((current) => ({ ...current, message })),
        (progress) => setState((current) => ({ ...current, progress })),
      );
      await refreshPending();

      if (result === "synced") {
        router.refresh();
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <form
      aria-busy={isSubmitting}
      className="flex w-full flex-col items-center text-left"
      onSubmit={handleSubmit}
    >
      <input name="taskId" type="hidden" value={taskId} />
      <fieldset className="flex w-full flex-col items-center">
        {children}
        <button
          className={`flex h-44 w-44 flex-col items-center justify-center rounded-full px-6 text-center text-2xl font-semibold leading-tight text-white shadow-lg transition focus:outline-none focus:ring-4 ${
            isConfirming
              ? "bg-orange-500 hover:bg-orange-600 focus:ring-orange-200"
              : "bg-red-600 hover:bg-red-700 focus:ring-red-200"
          }`}
          disabled={isSubmitting}
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
      <PendingNotice isWorking={isSubmitting} state={state} />
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
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setState((current) => ({
      ...current,
      message: "Kaydediliyor...",
      progress: 6,
    }));
    try {
      const result = await submitOrQueue(
        "NOTE",
        form,
        (message) => setState((current) => ({ ...current, message })),
        (progress) => setState((current) => ({ ...current, progress })),
      );
      await refreshPending();

      if (result === "synced") {
        form.reset();
        router.refresh();
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <form aria-busy={isSubmitting} className="w-full text-left" onSubmit={handleSubmit}>
      <input name="taskId" type="hidden" value={taskId} />
      <fieldset disabled={isSubmitting}>{children}</fieldset>
      <PendingNotice isWorking={isSubmitting} state={state} />
    </form>
  );
}

function PendingNotice({
  isWorking = false,
  state,
}: {
  isWorking?: boolean;
  state: SyncState;
}) {
  if (!state.message && state.pending === 0) {
    return null;
  }

  const progress =
    typeof state.progress === "number"
      ? Math.min(100, Math.max(0, state.progress))
      : null;
  const showProgress = isWorking && progress !== null;

  return (
    <div
      aria-valuemax={showProgress ? 100 : undefined}
      aria-valuemin={showProgress ? 0 : undefined}
      aria-valuenow={showProgress ? progress : undefined}
      className="relative mt-4 overflow-hidden rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
      role={showProgress ? "progressbar" : "status"}
    >
      {showProgress ? (
        <div
          className="absolute inset-y-0 left-0 overflow-hidden bg-primary/10 transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        >
          <div className="h-full w-full animate-pulse bg-gradient-to-r from-primary/5 via-primary/25 to-primary/10" />
        </div>
      ) : null}
      <div className="relative flex items-center justify-between gap-3">
        <span>{state.message || `${state.pending} bekleyen kayit var.`}</span>
        {showProgress ? (
          <span className="shrink-0 tabular-nums text-muted-foreground/80">
            %{progress}
          </span>
        ) : null}
      </div>
    </div>
  );
}
