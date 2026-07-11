"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ClipboardPenLine, MapPinCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

type VisitInteractionPanelProps = {
  initialVisitId?: string | null;
  projectId: string;
};

type VisitResponse = {
  error?: string;
  ok?: boolean;
  visitId?: string | null;
};

export function VisitInteractionPanel({
  initialVisitId,
  projectId,
}: VisitInteractionPanelProps) {
  const [activeVisitId, setActiveVisitId] = useState(initialVisitId ?? "");
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [visitConfirmation, setVisitConfirmation] = useState<"idle" | "confirm">("idle");
  const router = useRouter();

  async function submit(formData: FormData, successMessage: string, withLocation = false) {
    setIsPending(true);
    setMessage("");
    setError("");

    try {
      formData.set("projectId", projectId);

      if (activeVisitId && !formData.has("projectVisitId")) {
        formData.set("projectVisitId", activeVisitId);
      }

      if (withLocation) {
        await appendCurrentLocation(formData);
      }

      const response = await fetch("/api/admin/visits", {
        body: formData,
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as VisitResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Islem kaydedilemedi.");
      }

      if (payload.visitId) {
        setActiveVisitId(payload.visitId);
      }

      setMessage(successMessage);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Islem kaydedilemedi.",
      );
    } finally {
      setIsPending(false);
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
            name="note"
            placeholder="Istege bagli kisa ziyaret notu"
            rows={3}
          />
          <button
            className={`mx-auto flex h-44 w-44 items-center justify-center rounded-full px-6 text-center text-xl font-semibold leading-tight text-white shadow-lg transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:text-white disabled:shadow-none md:h-12 md:w-full md:rounded-md md:text-base ${
              activeVisitId
                ? "bg-slate-500 focus:ring-slate-200"
                : visitConfirmation === "confirm"
                  ? "bg-amber-500 hover:bg-amber-600 focus:ring-amber-200"
                  : "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-200"
            }`}
            disabled={isPending || Boolean(activeVisitId)}
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
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              formData.set("operation", "note");
              submit(formData, "Not eklendi.");
              event.currentTarget.reset();
            }}
          >
            <label className="flex items-center gap-2 text-sm font-medium text-navy" htmlFor="note">
              <ClipboardPenLine className="h-4 w-4" aria-hidden="true" />
              Not ekle
            </label>
            <textarea
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
              id="note"
              name="note"
              required
              rows={4}
            />
            <Button disabled={isPending} type="submit" variant="outline">
              Kaydet
            </Button>
          </form>

          <form
            className="flex flex-col gap-3 rounded-md border border-navy/10 bg-primary/5 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              formData.set("operation", "file");
              submit(formData, "Dosya eklendi.");
              event.currentTarget.reset();
            }}
          >
            <label className="flex items-center gap-2 text-sm font-medium text-navy" htmlFor="files">
              <Camera className="h-4 w-4" aria-hidden="true" />
              Foto / dosya ekle
            </label>
            <input
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm file:mr-3 file:rounded-md file:border file:border-primary/20 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
              id="files"
              multiple
              name="files"
              required
              type="file"
            />
            <textarea
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
              name="note"
              placeholder="Dosya notu, istege bagli"
              rows={2}
            />
            <Button disabled={isPending} type="submit" variant="outline">
              Yukle
            </Button>
          </form>
        </div>

        {activeVisitId ? (
          <p className="rounded-md border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            Yeni not ve dosyalar aktif ziyaret kaydina baglanir.
          </p>
        ) : null}
        {message ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </p>
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
