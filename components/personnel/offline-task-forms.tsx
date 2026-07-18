"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  isCompressibleImage,
  prepareFilesForUpload,
} from "@/lib/client/image-compression";

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
  setMessage: (message: string) => void,
  setProgress: (progress: number | null) => void,
) {
  await refreshFormLocation(form);

  const formData = new FormData(form);
  let files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);
  const hasFiles = files.length > 0;

  if (!navigator.onLine) {
    setProgress(null);
    setMessage("İnternet bağlantısı yok. Bağlantı geldikten sonra tekrar deneyin.");
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
        "Video yüklemesi uzun sürebilir. Yükleme bitene kadar bu ekranı kapatmayın.",
      );
    }

    if (isPreparingUpload) {
      setProgress(8);
    }

    try {
      files = await prepareFilesForUpload(files);
    } catch {
      setProgress(null);
      setMessage("Dosyalar yüklemeye hazırlanamadı. Tekrar seçip deneyin.");
      return "failed";
    }
    formData.delete("files");

    for (const file of files) {
      formData.append("files", file, file.name);
    }

    if (hasCompressibleImage && hasVideo) {
      setMessage(
        "Video yüklemesi uzun sürebilir. Yükleme bitene kadar bu ekranı kapatmayın.",
      );
      setProgress(10);
    }
  }

  formData.set("type", type);

  if (type === "NOTE" && hasFiles) {
    setMessage("Yükleniyor...");
    setProgress(12);
  }

  let response: DirectResponse;

  try {
    response = await postPersonnelEvent(formData, setProgress);
  } catch {
    setProgress(null);
    setMessage("Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.");
    return "failed";
  }

  if (!response.ok) {
    setProgress(null);
    setMessage(response.error || "İşlem kaydedilemedi. Tekrar deneyin.");
    return "failed";
  }

  setProgress(100);
  setMessage("İşlem kaydedildi.");
  return "synced";
}

type DirectResponse = {
  error?: string;
  ok: boolean;
  status: number;
};

function postPersonnelEvent(
  formData: FormData,
  setProgress: (progress: number | null) => void,
) {
  return new Promise<DirectResponse>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/offline/sync");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const uploadProgress = Math.round((event.loaded / event.total) * 80);
        setProgress(Math.min(92, Math.max(12, 12 + uploadProgress)));
      }
    };
    request.onerror = () => reject(new Error("Upload failed"));
    request.onload = () => {
      let payload: { error?: string; ok?: boolean } = {};

      try {
        payload = JSON.parse(request.responseText || "{}");
      } catch {
        // API başarıları JSON ve ok: true döndürür.
      }

      const responsePath = request.responseURL
        ? new URL(request.responseURL, window.location.href).pathname
        : "";
      const contentType = request.getResponseHeader("content-type") ?? "";
      const ok =
        request.status >= 200 &&
        request.status < 300 &&
        responsePath !== "/login" &&
        contentType.includes("application/json") &&
        payload.ok === true;

      setProgress(ok ? 96 : null);
      resolve({
        error:
          responsePath === "/login"
            ? "Oturum süresi doldu. Giriş yaptıktan sonra tekrar deneyin."
            : payload.error,
        ok,
        status: responsePath === "/login" ? 401 : request.status,
      });
    };

    request.send(formData);
  });
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

export function PersonnelArriveForm({
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
  const { state, setState } = useSubmissionState();
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
      const result = await submitPersonnelEvent(
        "ARRIVED_SITE",
        form,
        (message) => setState((current) => ({ ...current, message })),
        (progress) => setState((current) => ({ ...current, progress })),
      );
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
        disabled={disabled || isSubmitting}
      >
        {children}
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
}: Readonly<{
  children: React.ReactNode;
  hasTodayNote: boolean;
  taskId: string;
}>) {
  const router = useRouter();
  const { state, setState } = useSubmissionState();
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
      const result = await submitPersonnelEvent(
        "LEFT_SITE",
        form,
        (message) => setState((current) => ({ ...current, message })),
        (progress) => setState((current) => ({ ...current, progress })),
      );
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
      <SubmissionNotice isWorking={isSubmitting} state={state} />
    </form>
  );
}

export function PersonnelNoteForm({
  children,
  taskId,
}: Readonly<{
  children: React.ReactNode;
  taskId: string;
}>) {
  const router = useRouter();
  const { state, setState } = useSubmissionState();
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
      const result = await submitPersonnelEvent(
        "NOTE",
        form,
        (message) => setState((current) => ({ ...current, message })),
        (progress) => setState((current) => ({ ...current, progress })),
      );
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
