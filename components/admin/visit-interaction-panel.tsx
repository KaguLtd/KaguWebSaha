"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ClipboardPenLine, MapPinCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NoteDraftRecovery } from "@/components/admin/note-draft-recovery";
import { isCompressibleImage } from "@/lib/client/image-compression";
import {
  enqueueVisitUploads,
  listOfflineItems,
  syncOfflineItems,
} from "@/lib/offline/queue";
import { requestJson } from "@/lib/client/json-request";
import { useNoteDraft } from "@/lib/client/use-note-draft";
import { getVisitDayKey } from "@/lib/visits/status";

type VisitInteractionPanelProps = {
  initialVisitId?: string | null;
  currentDay: string;
  projectId: string;
  userId: string;
};

type VisitResponse = {
  ok: true;
  visitId?: string | null;
};

export function VisitInteractionPanel({
  initialVisitId,
  currentDay,
  projectId,
  userId,
}: VisitInteractionPanelProps) {
  const [activeVisitId, setActiveVisitId] = useState(initialVisitId ?? "");
  const [isPending, setIsPending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingUploads, setPendingUploads] = useState(0);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [visitConfirmation, setVisitConfirmation] = useState<"idle" | "confirm">("idle");
  const router = useRouter();
  const visitDraft = useNoteDraft(userId, projectId, "visit");
  const noteDraft = useNoteDraft(userId, projectId, "note");
  const fileDraft = useNoteDraft(userId, projectId, "files");
  const submitting = useRef(false);
  const uploading = useRef(false);
  const shownDay = useRef(currentDay);

  useEffect(() => {
    setActiveVisitId(initialVisitId ?? "");
    shownDay.current = currentDay;
  }, [currentDay, initialVisitId]);

  useEffect(() => {
    function checkDay() {
      const nextDay = getVisitDayKey();
      if (shownDay.current === nextDay) return;
      shownDay.current = nextDay;
      setActiveVisitId("");
      setVisitConfirmation("idle");
      router.refresh();
    }
    const timer = window.setInterval(checkDay, 30_000);
    window.addEventListener("focus", checkDay);
    document.addEventListener("visibilitychange", checkDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", checkDay);
      document.removeEventListener("visibilitychange", checkDay);
    };
  }, [router]);

  useEffect(() => {
    void syncVisitUploads();

    async function syncVisitUploads() {
      const before = await listOfflineItems(["VISIT_UPLOAD"], userId);
      setPendingUploads(before.length);

      if (before.length === 0) {
        return;
      }

      const result = await syncOfflineItems({
        kinds: ["VISIT_UPLOAD"],
        userId,
        onProgress: ({ current, progress, total }) => {
          setUploadMessage(`${current}/${total} ziyaret kaydı yükleniyor...`);
          setUploadProgress(progress);
        },
      });

      setPendingUploads(result.remaining);
      setUploadProgress(null);
      setUploadMessage(
        result.failedIds.length > 0
          ? result.error || "Önceki dosyalarınız yüklenemedi!"
          : result.remaining > 0
          ? result.error || `${result.remaining} ziyaret kaydı tekrar denenecek.`
          : "",
      );

      if (result.synced > 0) {
        router.refresh();
      }
    }
  }, [router, userId]);

  async function submit(formData: FormData, successMessage: string, withLocation = false) {
    if (submitting.current) return false;
    submitting.current = true;
    setIsPending(true);
    setMessage("");
    setError("");

    try {
      formData.set("projectId", projectId);
      formData.set("ownerUserId", userId);
      const isVisit = formData.get("operation") === "visit";
      const draft = isVisit ? visitDraft : noteDraft;
      const submission = draft.capture(isVisit ? currentDay : activeVisitId);
      formData.set("note", submission.value);
      formData.set("clientItemId", submission.clientItemId);
      if (getVisitDayKey() !== currentDay) {
        setActiveVisitId("");
        router.refresh();
        throw new Error("Gün değişti. Ziyaret bilgisi yenileniyor; notunuz korundu, tekrar kaydedin.");
      }

      if (activeVisitId && !formData.has("projectVisitId")) {
        formData.set("projectVisitId", activeVisitId);
      }
      if (withLocation) {
        await appendCurrentLocation(formData);
      }

      const payload = await requestJson<VisitResponse>("/api/admin/visits", {
        body: formData,
        method: "POST",
        redirect: "error",
      });
      if (isVisit && (typeof payload.visitId !== "string" || !payload.visitId.trim())) throw new Error("Ziyaret kaydı doğrulanamadı. Notunuz korundu; tekrar deneyin.");

      if (payload.visitId) {
        setActiveVisitId(payload.visitId);
      }

      const cleared = draft.acknowledge(submission);
      setMessage(cleared ? successMessage : `${successMessage} Yeni düzenlemeniz taslakta korunuyor.`);
      router.refresh();
      return true;
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Islem kaydedilemedi.",
      );
      return false;
    } finally {
      submitting.current = false;
      setIsPending(false);
    }
  }

  async function submitFiles(form: HTMLFormElement) {
    if (uploading.current || !fileDraft.ready) return;
    uploading.current = true;
    setIsUploading(true);
    setMessage("");
    setError("");
    setUploadProgress(2);

    const formData = new FormData(form);
    const note = String(formData.get("note") ?? "").trim();
    const submission = fileDraft.capture(activeVisitId);
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File && value.size > 0);

    if (files.length === 0) {
      setError("Yüklenecek dosya seçilmedi.");
      setUploadProgress(null);
      uploading.current = false;
      setIsUploading(false);
      return;
    }

    let queuedItems;
    try {
      queuedItems = await enqueueVisitUploads({
        userId,
        projectId,
        projectVisitId: activeVisitId || undefined,
        note: note || undefined,
        files,
      });
      const input = form.elements.namedItem("files");
      if (input instanceof HTMLInputElement) input.value = "";
      fileDraft.acknowledge(submission);
      setPendingUploads((current) => current + queuedItems.length);
    } catch {
      setError(
        "Dosyalar cihazdaki güvenli kuyruğa alınamadı. Depolama alanını kontrol edip tekrar deneyin.",
      );
      setUploadProgress(null);
      uploading.current = false;
      setIsUploading(false);
      return;
    }

    try {
      const hasCompressibleImage = files.some(isCompressibleImage);
      const hasVideo = files.some((file) =>
        file.type.toLowerCase().startsWith("video/"),
      );

      setUploadMessage(
        hasCompressibleImage
          ? "Fotoğraflar yükleme için hazırlanıyor..."
          : hasVideo
            ? "Video cihazda saklandı, yükleme uzun sürebilir..."
            : "Dosyalar güvenli kuyrukta, yükleme başlıyor...",
      );
      setUploadProgress(6);

      if (!navigator.onLine) {
        setUploadMessage("İnternet yok. Dosyalar cihazda saklandı ve bağlantıda yüklenecek.");
        setUploadProgress(null);
        return;
      }

      const result = await syncOfflineItems({
        kinds: ["VISIT_UPLOAD"],
        userId,
        onProgress: ({ current, progress, total }) => {
          setUploadMessage(`${current}/${total} ziyaret kaydı yükleniyor...`);
          setUploadProgress(progress);
        },
      });
      const remainingItems = await listOfflineItems(["VISIT_UPLOAD"], userId);
      const queuedIds = new Set(queuedItems.map((item) => item.id));
      const isStillQueued = remainingItems.some((item) => queuedIds.has(item.id));

      setPendingUploads(remainingItems.length);

      if (result.failedIds.some((id) => queuedIds.has(id))) {
        setError(result.error || "Dosyalar kaydedilemedi.");
        setUploadMessage("");
        setUploadProgress(null);
        return;
      }

      if (isStillQueued) {
        setUploadMessage(
          result.error || "Bağlantı kesildi. Dosyalar cihazda saklandı ve tekrar denenecek.",
        );
        setUploadProgress(null);
        return;
      }

      setUploadProgress(100);
      setUploadMessage("Dosyalar yüklendi; önizleme işlemleri arka planda sürüyor.");
      setMessage("Dosya eklendi.");
      router.refresh();
      window.setTimeout(() => {
        setUploadMessage("");
        setUploadProgress(null);
      }, 3500);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Dosyalar hazırlanamadı. Cihazdaki kayıt korundu; tekrar deneyin.");
      setUploadProgress(null);
    } finally {
      uploading.current = false;
      setIsUploading(false);
    }
  }

  return (
    <section className="rounded-lg border border-primary/15 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (activeVisitId) {
              return;
            }
            if (visitConfirmation === "idle") {
              setVisitConfirmation("confirm");
              return;
            }
            const formData = new FormData(event.currentTarget);
            formData.set("operation", "visit");
            submit(formData, "Ziyaret kaydedildi.", true);
          }}
        >
          <label className="text-sm font-medium text-navy" htmlFor="visit-note">
            Ziyaret notu
          </label>
          <textarea
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
            id="visit-note"
            disabled={!visitDraft.ready || isPending}
            maxLength={20000}
            name="note"
            placeholder="Istege bagli kisa ziyaret notu"
            rows={3}
            value={visitDraft.value}
            onChange={(event) => visitDraft.setValue(event.target.value)}
          />
          <NoteDraftRecovery drafts={visitDraft.previousDrafts} restore={visitDraft.restoreDraft} disabled={isPending} />
          <button
            className={`mx-auto flex h-44 w-44 items-center justify-center rounded-full px-6 text-center text-xl font-semibold leading-tight text-white shadow-lg transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:text-white disabled:shadow-none md:h-12 md:w-full md:rounded-md md:text-base ${
              activeVisitId
                ? "bg-slate-500 focus:ring-slate-200"
                : visitConfirmation === "confirm"
                  ? "bg-amber-500 hover:bg-amber-600 focus:ring-amber-200"
                  : "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-200"
            }`}
            disabled={isPending || !visitDraft.ready || Boolean(activeVisitId)}
            type="submit"
          >
            <MapPinCheck className="h-4 w-4" aria-hidden="true" />
            {isPending
              ? "Kaydediliyor..."
              : activeVisitId
                ? "Ziyaret Edildi"
                : visitConfirmation === "confirm"
                  ? "Sahada misin?"
                  : "Ziyaret Ettim"}
          </button>
        </form>

        <div className="grid gap-4 lg:grid-cols-2">
          <form
            className="flex flex-col gap-3 rounded-md border border-navy/10 bg-primary/5 p-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const formData = new FormData(form);
              formData.set("operation", "note");
              await submit(formData, "Not eklendi.");
            }}
          >
            <label className="flex items-center gap-2 text-sm font-medium text-navy" htmlFor="note">
              <ClipboardPenLine className="h-4 w-4" aria-hidden="true" />
              Not ekle
            </label>
            <textarea
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
              id="note"
              disabled={!noteDraft.ready}
              maxLength={20000}
              name="note"
              required
              rows={4}
              value={noteDraft.value}
              onChange={(event) => noteDraft.setValue(event.target.value)}
            />
            <NoteDraftRecovery drafts={noteDraft.previousDrafts} restore={noteDraft.restoreDraft} disabled={isPending} />
            <Button disabled={isPending || !noteDraft.ready} type="submit" variant="outline">
              Kaydet
            </Button>
          </form>

          <form
            className="flex flex-col gap-3 rounded-md border border-navy/10 bg-primary/5 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitFiles(event.currentTarget);
            }}
          >
            <label className="flex items-center gap-2 text-sm font-medium text-navy" htmlFor="files">
              <Camera className="h-4 w-4" aria-hidden="true" />
              Foto / dosya ekle
            </label>
            <input
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm file:mr-3 file:rounded-md file:border file:border-primary/20 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
              id="files"
              disabled={isUploading || !fileDraft.ready}
              multiple
              name="files"
              required
              type="file"
            />
            <textarea
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
              name="note"
              disabled={!fileDraft.ready}
              maxLength={20000}
              placeholder="Dosya notu, istege bagli"
              rows={2}
              value={fileDraft.value}
              onChange={(event) => fileDraft.setValue(event.target.value)}
            />
            <NoteDraftRecovery drafts={fileDraft.previousDrafts} restore={fileDraft.restoreDraft} disabled={isUploading} />
            <Button disabled={isUploading || !fileDraft.ready} type="submit" variant="outline">
              Yukle
            </Button>
          </form>
        </div>

        {activeVisitId ? (
          <p className="rounded-md border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            Yeni not ve dosyalar aktif ziyaret kaydina baglanir.
          </p>
        ) : null}
        {uploadMessage || pendingUploads > 0 ? (
          <div
            aria-valuemax={uploadProgress !== null ? 100 : undefined}
            aria-valuemin={uploadProgress !== null ? 0 : undefined}
            aria-valuenow={uploadProgress ?? undefined}
            className="relative overflow-hidden rounded-md border border-primary/20 bg-white px-3 py-2 text-sm text-muted-foreground"
            role={uploadProgress !== null ? "progressbar" : "status"}
          >
            {uploadProgress !== null ? (
              <div
                className="absolute inset-y-0 left-0 overflow-hidden bg-primary/10 transition-[width] duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              >
                <div className="h-full w-full animate-pulse bg-gradient-to-r from-primary/5 via-primary/25 to-primary/10" />
              </div>
            ) : null}
            <div className="relative flex items-center justify-between gap-3">
              <span>
                {uploadMessage || `${pendingUploads} ziyaret yüklemesi bağlantı bekliyor.`}
              </span>
              {uploadProgress !== null ? (
                <span className="shrink-0 tabular-nums">%{uploadProgress}</span>
              ) : null}
            </div>
          </div>
        ) : null}
        {message ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </p>
        ) : null}
        {[visitDraft.persistenceError, noteDraft.persistenceError, fileDraft.persistenceError].find(Boolean) ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{[visitDraft.persistenceError, noteDraft.persistenceError, fileDraft.persistenceError].find(Boolean)}</p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function appendCurrentLocation(formData: FormData) {
  if (!("geolocation" in navigator)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        formData.set("latitude", String(position.coords.latitude));
        formData.set("longitude", String(position.coords.longitude));
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
