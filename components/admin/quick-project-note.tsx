"use client";

import { Camera, StickyNote } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";

export function QuickProjectNote({
  iconOnly = false,
  projectId,
  projectName,
}: {
  iconOnly?: boolean;
  projectId: string;
  projectName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  return (
    <>
      <Button
        aria-label={iconOnly ? `${projectName} icin hizli not ekle` : undefined}
        className={iconOnly ? "h-8 w-8 p-0" : undefined}
        onClick={() => setIsOpen(true)}
        size={iconOnly ? "icon" : "sm"}
        title={iconOnly ? "Hizli Not Ekle" : undefined}
        type="button"
      >
        <StickyNote aria-hidden="true" className="h-4 w-4" />
        {iconOnly ? <span className="sr-only">Hizli Not Ekle</span> : "Hizli Not Ekle"}
      </Button>
      <Drawer
        description={`${projectName} projesinin timeline'ina, gunluk programa bagli olmayan bir kayit ekler.`}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Hizli Not Ekle"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setIsPending(true);
            setError("");
            try {
              const formData = new FormData(event.currentTarget);
              formData.set("operation", "quick-note");
              formData.set("projectId", projectId);
              const response = await fetch("/api/admin/visits", { body: formData, method: "POST" });
              const payload = (await response.json().catch(() => ({}))) as { error?: string };
              if (!response.ok) throw new Error(payload.error || "Not kaydedilemedi.");
              setIsOpen(false);
              router.refresh();
            } catch (submitError) {
              setError(submitError instanceof Error ? submitError.message : "Not kaydedilemedi.");
            } finally {
              setIsPending(false);
            }
          }}
        >
          <label className="flex flex-col gap-2 text-sm font-medium text-navy">
            Not
            <textarea
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
              name="note"
              placeholder="Sahadaki gelisme veya proje notu"
              rows={6}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-navy">
            <span className="flex items-center gap-2"><Camera className="h-4 w-4" /> Fotograf / dosya</span>
            <input
              accept="image/*,.pdf"
              className="w-full cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-primary/35 file:bg-primary/10 file:px-3 file:py-2 file:font-semibold file:text-primary file:shadow-sm file:transition hover:file:border-primary/60 hover:file:bg-primary/15"
              multiple
              name="files"
              type="file"
            />
          </label>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          <Button disabled={isPending} type="submit">
            {isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </form>
      </Drawer>
    </>
  );
}
