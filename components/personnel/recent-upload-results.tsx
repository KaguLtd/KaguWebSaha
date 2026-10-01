"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDisplayDate, formatDisplayTime } from "@/lib/dates/format";
import { JsonRequestError, requestJson } from "@/lib/client/json-request";
import { listSuccessfulUploads, refreshSuccessfulUploads } from "@/lib/offline/queue";
import type { RecentUploadResult } from "@/lib/uploads/recent-results";

type Result = Omit<RecentUploadResult, "status"> & { status: RecentUploadResult["status"] | "DELIVERED" };
type Payload = { ok: true; userId: string; results: RecentUploadResult[] };
type ViewState = { ownerId: string; results: Result[]; loading: boolean; message: string };

const labels = { READY: "Dosya hazır", PROCESSING: "Dosya hazırlanıyor", FAILED: "Dosya hazırlama başarısız", DELIVERED: "Sunucuya teslim edildi" };

export function RecentUploadResults({ userId }: { userId: string }) {
  const [view, setView] = useState<ViewState>({ ownerId: userId, results: [], loading: true, message: "" });
  const running = useRef<symbol | null>(null);
  const scopeController = useRef<AbortController | null>(null);
  const receiptRefresh = useRef(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    if (running.current) return;
    const requestToken = Symbol();
    running.current = requestToken;
    const cutoff = Date.now() - 7 * 86_400_000;
    let local: Result[] = [];
    function publish(results: Result[], message = "") {
      if (!signal?.aborted) setView({ ownerId: userId, results, loading: false, message });
    }
    try {
      const receipts = await listSuccessfulUploads(userId).catch(() => []);
      local = receipts.filter((receipt) => receipt.uploadedByUserId === userId && Date.parse(receipt.completedAt) >= cutoff)
        .map((receipt) => ({ uploadId: receipt.uploadId, originalName: receipt.originalName, completedAt: receipt.completedAt,
          projectFileId: null, status: "DELIVERED", canRead: false }));
      if (signal?.aborted) return;
      if (!navigator.onLine) {
        publish(local, "İnternet yok. Bu cihazdaki teslim kayıtları gösteriliyor; dosya durumu bağlantıda doğrulanacak."); return;
      }
      const payload = await requestJson<Payload>("/api/personnel/uploads/recent", { signal }, 15_000);
      if (signal?.aborted) return;
      if (payload.userId !== userId) throw new JsonRequestError("Hesap değişti.", 401, "AUTH");
      if (!Array.isArray(payload.results)) throw new JsonRequestError("Gönderim sonuçları okunamadı.", 503, "INVALID_RESPONSE");
      const combined = new Map(local.map((result) => [result.uploadId, result]));
      for (const result of payload.results) combined.set(result.uploadId, result);
      publish([...combined.values()].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, 100));
    } catch (error) {
      if (error instanceof JsonRequestError && [401, 403].includes(error.status)) {
        publish([], "Oturum veya hesap değişti. Sonuçları görmek için tekrar giriş yapın.");
      } else {
        publish(local, "Sunucu sonuçları şu anda okunamadı. Bu cihazdaki teslim kayıtları korunuyor.");
      }
    } finally {
      if (running.current === requestToken) running.current = null;
    }
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    scopeController.current = controller;
    running.current = null;
    setView({ ownerId: userId, results: [], loading: true, message: "" });
    const refresh = () => { if (document.visibilityState === "visible") void reload(controller.signal); };
    void reload(controller.signal);
    window.addEventListener("kagu-queue-changed", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 20_000);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("kagu-queue-changed", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [reload, userId]);

  function refresh() {
    if (!scopeController.current) return;
    void reload(scopeController.current.signal);
    if (receiptRefresh.current) return;
    receiptRefresh.current = true;
    void refreshSuccessfulUploads(userId).finally(() => { receiptRefresh.current = false; }).catch(() => {});
  }

  // Gate during render: an old account must not flash before passive effects reset state.
  const currentOwner = view.ownerId === userId;
  const results = currentOwner ? view.results : [];
  const loading = !currentOwner || view.loading;
  const message = currentOwner ? view.message : "";

  return <section className="rounded-lg border bg-white p-5 shadow-sm" id="son-gonderimler">
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Son dosya gönderimlerim</h2><p className="mt-1 text-sm text-muted-foreground">Son 7 günde sunucuya teslim edilen dosyalar. Hazırlama sonucu ve açma bağlantısı burada güncellenir.</p></div><Button onClick={refresh} size="sm" type="button" variant="outline">Yenile</Button></div>
    {loading ? <p className="mt-4 text-sm text-muted-foreground">Gönderim sonuçları okunuyor...</p> : results.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">Gösterilecek dosya gönderimi yok.</p> : <ol className="mt-4 space-y-3">{results.map((result) => <li className="rounded-md border p-3" key={result.uploadId}>
      <p className="break-all text-sm font-medium">{result.originalName}</p><p className={`mt-1 text-xs ${result.status === "FAILED" ? "text-red-700" : "text-muted-foreground"}`}>{labels[result.status]} · {formatDisplayDate(new Date(result.completedAt))} {formatDisplayTime(new Date(result.completedAt))}</p>
      {result.status === "FAILED" ? <p className="mt-2 text-sm text-red-700">Dosya sunucuda korunuyor. Hazırlama işlemi için yöneticinize bildirin.</p> : null}
      {result.status === "READY" && !result.canRead ? <p className="mt-2 text-xs text-muted-foreground">Dosya kaydedildi; güncel görev erişiminiz bulunmuyor.</p> : null}
      {result.canRead && result.projectFileId ? <a className="mt-2 inline-block text-sm text-primary underline" href={`/api/files/${encodeURIComponent(result.projectFileId)}`} rel="noreferrer" target="_blank">Dosyayı aç</a> : null}
    </li>)}</ol>}
    {message ? <p className="mt-3 text-sm text-muted-foreground" role="status">{message}</p> : null}
  </section>;
}
