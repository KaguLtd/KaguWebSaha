"use client";

import { Camera, StickyNote } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { NoteDraftRecovery } from "@/components/admin/note-draft-recovery";
import { requestJson } from "@/lib/client/json-request";
import { useNoteDraft } from "@/lib/client/use-note-draft";
import { enqueueVisitUploads, syncOfflineItems } from "@/lib/offline/queue";

export function QuickProjectNote({ iconOnly = false, projectId, projectName, userId }: {
  iconOnly?: boolean; projectId: string; projectName: string; userId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const draft = useNoteDraft(userId, projectId, "quick-note");
  const router = useRouter();

  return (
    <>
      <Button aria-label={iconOnly ? `${projectName} icin hizli not ekle` : undefined}
        className={iconOnly ? "h-8 w-8 p-0" : undefined} onClick={() => setIsOpen(true)}
        size={iconOnly ? "icon" : "sm"} title={iconOnly ? "Hizli Not Ekle" : undefined} type="button">
        <StickyNote aria-hidden="true" className="h-4 w-4" />
        {iconOnly ? <span className="sr-only">Hizli Not Ekle</span> : "Hizli Not Ekle"}
      </Button>
      {notice ? <p className="text-xs text-muted-foreground" role="status">{notice}</p> : null}
      <Drawer description={`${projectName} projesinin timeline'ina, gunluk programa bagli olmayan bir kayit ekler.`}
        isOpen={isOpen} onClose={() => setIsOpen(false)} title="Hizli Not Ekle">
        <form className="flex flex-col gap-4" onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current || !draft.ready) return;
          const form = event.currentTarget;
          const formData = new FormData(form);
          const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
          const submission = draft.capture("quick-note");
          if (!submission.value.trim() && !files.length) { setError("Not yazın veya en az bir dosya seçin."); return; }
          submitting.current = true;
          setIsPending(true);
          setError("");
          setNotice("");
          let queuedCount = 0;
          try {
            if (files.length) {
              const queued = await enqueueVisitUploads({ userId, projectId, note: submission.value.trim() || undefined, files });
              queuedCount = queued.length;
              // Originals are durable before the selection is cleared or networking begins.
              const input = form.elements.namedItem("files");
              if (input instanceof HTMLInputElement) input.value = "";
              setNotice(`${queuedCount} dosya cihazdaki kuyruğa kaydedildi. Yüklemeler Ziyaretler ekranından izlenebilir.`);
              if (navigator.onLine) void syncOfflineItems({ userId, kinds: ["VISIT_UPLOAD"] });
            }
            if (submission.value.trim()) {
              const request = new FormData();
              request.set("operation", "quick-note");
              request.set("projectId", projectId);
              request.set("ownerUserId", userId);
              request.set("clientItemId", submission.clientItemId);
              request.set("note", submission.value);
              await requestJson<{ ok: true }>("/api/admin/visits", { body: request, method: "POST", redirect: "error" });
            }
            const cleared = draft.acknowledge(submission);
            setNotice(`${submission.value.trim() ? "Not kaydedildi." : ""}${queuedCount ? ` ${queuedCount} dosya cihazdaki kuyrukta; aktarım ve önizleme ayrıca tamamlanır.` : ""}${!cleared ? " Yeni düzenlemeniz taslakta korunuyor." : ""}`.trim());
            if (cleared) setIsOpen(false);
            router.refresh();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "İşlem tamamlanamadı. Not taslağınız korundu.");
          } finally { submitting.current = false; setIsPending(false); }
        }}>
          <label className="flex flex-col gap-2 text-sm font-medium text-navy">
            Not
            <textarea className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
              disabled={!draft.ready} maxLength={20000} name="note" placeholder="Sahadaki gelisme veya proje notu" rows={6}
              value={draft.value} onChange={(event) => draft.setValue(event.target.value)} />
          </label>
          <NoteDraftRecovery drafts={draft.previousDrafts} restore={draft.restoreDraft} disabled={isPending} />
          <label className="flex flex-col gap-2 text-sm font-medium text-navy">
            <span className="flex items-center gap-2"><Camera className="h-4 w-4" /> Fotograf / dosya</span>
            <input accept="image/*,.pdf" className="w-full cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-primary/35 file:bg-primary/10 file:px-3 file:py-2 file:font-semibold file:text-primary file:shadow-sm file:transition hover:file:border-primary/60 hover:file:bg-primary/15"
              disabled={isPending || !draft.ready} multiple name="files" type="file" />
          </label>
          {draft.persistenceError ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{draft.persistenceError}</p> : null}
          {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p> : null}
          <Button disabled={isPending || !draft.ready} type="submit">{isPending ? "Kaydediliyor..." : "Kaydet"}</Button>
        </form>
      </Drawer>
    </>
  );
}
