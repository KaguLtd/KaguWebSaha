"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  enqueuePersonnelEvent, hasPendingPersonnelNote, listOfflineItems, syncOfflineItems,
} from "@/lib/offline/queue";
import { PersonnelMediaPicker } from "@/components/personnel/media-picker";

type PersonnelEventType = "ARRIVED_SITE" | "LEFT_SITE" | "NOTE";

type SubmissionState = {
  message: string;
  progress: number | null;
};

function useSubmissionState() {
  const [state, setState] = useState<SubmissionState>({
    message: "",
    progress: null,
  });

  return {
    state,
    setState,
  };
}

async function submitPersonnelEvent(
  type: PersonnelEventType,
  form: HTMLFormElement,
  formData: FormData,
  setMessage: (message: string) => void,
  setProgress: (progress: number | null) => void,
  context: { userId: string; projectId: string; files?: File[] },
) {
  if (type !== "NOTE") {
    await refreshFormLocation(form, formData);
  }

  if (type === "NOTE" && !String(formData.get("note") ?? "").trim()) {
    setProgress(null);
    setMessage("Not alanı boş bırakılamaz.");
    return "failed";
  }

  const files = context.files ?? formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);
  let stored = false;
  try {
    const queued = await enqueuePersonnelEvent({
      userId: context.userId, projectId: context.projectId, taskId: String(formData.get("taskId") ?? ""),
      eventType: type, note: String(formData.get("note") ?? "").trim() || undefined, files,
      latitude: String(formData.get("latitude") ?? "") || undefined, longitude: String(formData.get("longitude") ?? "") || undefined,
      actualHeadcount: formData.get("actualHeadcount") ? Number(formData.get("actualHeadcount")) : undefined,
    });
    stored = true;
    setMessage("Kayıt cihazda saklandı.");
    const result = await syncOfflineItems({ userId: context.userId, kinds: ["PERSONNEL"], eventsOnly: true });
    const remaining = await listOfflineItems(["PERSONNEL"], context.userId);
    const eventPending = remaining.find((item) => item.id === queued.event.id);
    if (!eventPending) {
      setProgress(100);
      setMessage(files.length ? `Not kaydedildi. ${files.length} dosya ayrı olarak yükleniyor; bekleyenleri Ayarlar'da görebilirsiniz.` : "İşlem kaydedildi.");
      void syncOfflineItems({ userId: context.userId, kinds: ["PERSONNEL"] });
      return "synced";
    }
    setProgress(null);
    setMessage(result.error || "İnternet bekleniyor. Kayıt cihazda saklandı ve bağlantıda gönderilecek.");
    return eventPending.status === "FAILED" ? "retained" : "queued";
  } catch (error) {
    setProgress(null);
    setMessage(stored ? "Kayıt cihazda korundu. Gönderim durumunu Ayarlar'daki bekleyen kayıtlardan kontrol edin." : error instanceof Error ? error.message : "Cihaza kayıt yapılamadı. Not ve dosyalar ekranda korundu; depolama alanını kontrol edin.");
    return stored ? "queued" : "failed";
  }
}

function refreshFormLocation(form: HTMLFormElement, formData: FormData) {
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
          formData.set("latitude", latitude.value);
        }

        if (longitude instanceof HTMLInputElement) {
          longitude.value = String(position.coords.longitude);
          formData.set("longitude", longitude.value);
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

export function PersonnelArriveForm({
  children,
  disabled,
  disabledMessage,
  taskId,
  userId,
  projectId,
  defaultHeadcount,
  onStored,
}: Readonly<{
  children: React.ReactNode;
  disabled?: boolean;
  disabledMessage?: string;
  taskId: string;
  userId: string;
  projectId: string;
  defaultHeadcount?: number | null;
  onStored?: () => void;
}>) {
  const router = useRouter();
  const { state, setState } = useSubmissionState();
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStored, setIsStored] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (submittingRef.current) {
      return;
    }

    // Disabled kontroller FormData'ya girmez; formu isSubmitting'den once dondur.
    const formData = new FormData(form);
    submittingRef.current = true;
    setIsSubmitting(true);
    setState((current) => ({
      ...current,
      message: "Kaydediliyor...",
      progress: 6,
    }));
    try {
      const result = await submitPersonnelEvent(
        "ARRIVED_SITE",
        form,
        formData,
        (message) => setState((current) => ({ ...current, message })),
        (progress) => setState((current) => ({ ...current, progress })),
        { userId, projectId },
      );
      if (result !== "failed") setIsStored(true);
      if (result === "synced" || result === "queued") onStored?.();
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
      <fieldset
        className="flex w-full flex-col items-center"
        disabled={disabled || isSubmitting || isStored}
      >
        {children}
        {defaultHeadcount !== undefined && defaultHeadcount !== null ? (
          <label className="mt-4 flex flex-col gap-2 text-sm">Bugün sahaya gelen ekip mevcudu
            <input className="rounded-md border px-3 py-2" defaultValue={defaultHeadcount} min={0} max={500} name="actualHeadcount" required type="number" />
          </label>
        ) : null}
      </fieldset>
      <SubmissionNotice
        isWorking={isSubmitting}
        state={{
          ...state,
          message: disabled ? disabledMessage || state.message : state.message,
        }}
      />
    </form>
  );
}

export function PersonnelLeaveForm({
  children,
  hasTodayNote,
  taskId,
  userId,
  projectId,
  onStored,
}: Readonly<{
  children: React.ReactNode;
  hasTodayNote: boolean;
  taskId: string;
  userId: string;
  projectId: string;
  onStored?: () => void;
}>) {
  const router = useRouter();
  const { state, setState } = useSubmissionState();
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStored, setIsStored] = useState(false);
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

    if (!hasTodayNote && !(await hasPendingPersonnelNote(userId, taskId))) {
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

    // Disabled kontroller FormData'ya girmez; formu isSubmitting'den once dondur.
    const formData = new FormData(form);
    submittingRef.current = true;
    setIsSubmitting(true);
    setState((current) => ({
      ...current,
      message: "Kaydediliyor...",
      progress: 6,
    }));
    try {
      const result = await submitPersonnelEvent(
        "LEFT_SITE",
        form,
        formData,
        (message) => setState((current) => ({ ...current, message })),
        (progress) => setState((current) => ({ ...current, progress })),
        { userId, projectId },
      );
      if (result !== "failed") setIsStored(true);
      if (result === "synced" || result === "queued") onStored?.();
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
          disabled={isSubmitting || isStored}
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
      <SubmissionNotice isWorking={isSubmitting} state={state} />
    </form>
  );
}

export function PersonnelNoteForm({
  children,
  taskId,
  userId,
  projectId,
}: Readonly<{
  children: React.ReactNode;
  taskId: string;
  userId: string;
  projectId: string;
}>) {
  const router = useRouter();
  const { state, setState } = useSubmissionState();
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (submittingRef.current) {
      return;
    }

    // Not ve dosyalari fieldset kapanmadan once tek istek icin dondur.
    const formData = new FormData(form);
    submittingRef.current = true;
    setIsSubmitting(true);
    setState((current) => ({
      ...current,
      message: "Kaydediliyor...",
      progress: 6,
    }));
    try {
      const result = await submitPersonnelEvent(
        "NOTE",
        form,
        formData,
        (message) => setState((current) => ({ ...current, message })),
        (progress) => setState((current) => ({ ...current, progress })),
        { userId, projectId, files },
      );
      if (result !== "failed") {
        form.reset();
        setFiles([]);
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
      <fieldset disabled={isSubmitting}>
        {children}
        <PersonnelMediaPicker files={files} onChange={setFiles} />
        <button className="mt-5 w-full rounded-md border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60" type="submit">{isSubmitting ? "Kaydediliyor..." : "Kaydet"}</button>
      </fieldset>
      <SubmissionNotice isWorking={isSubmitting} state={state} />
    </form>
  );
}

function SubmissionNotice({
  isWorking = false,
  state,
}: {
  isWorking?: boolean;
  state: SubmissionState;
}) {
  if (!state.message) {
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
        <span>{state.message}</span>
        {showProgress ? (
          <span className="shrink-0 tabular-nums text-muted-foreground/80">
            %{progress}
          </span>
        ) : null}
      </div>
    </div>
  );
}
