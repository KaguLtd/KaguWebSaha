"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { UploadProgress } from "@/components/personnel/upload-progress";
import {
  countLegacyOfflineItems, deleteOfflineItem, listOfflineItems, replaceOfflineItemFiles, retryOfflineItem, syncOfflineItems,
  readLegacyOfflineItemsForRecovery, type LegacyOfflineRecord, type OfflineQueueItem, type OfflineQueueKind,
  clearLegacyOfflineItems, stopOfflineSync, dismissOfflineNotifications, showOfflineNotifications, getOfflineSyncProgress, type OfflineSyncProgress,
} from "@/lib/offline/queue";

function itemLabel(item: OfflineQueueItem) {
  if (item.type === "VISIT_FILE") return "Ziyaret dosyası";
  if (item.type === "PERSONNEL_FILE") return "Saha dosyası";
  return item.eventType === "NOTE" ? "Saha notu" : item.eventType === "ARRIVED_SITE" ? "Sahaya ulaşma kaydı" : "Sahadan ayrılma kaydı";
}

export function OfflineQueueManager({ userId, kind, canRecoverLegacy = false }: { userId: string; kind: OfflineQueueKind; canRecoverLegacy?: boolean }) {
  const [items, setItems] = useState<OfflineQueueItem[]>([]);
  const [legacyCount, setLegacyCount] = useState(0);
  const [legacyRecords, setLegacyRecords] = useState<LegacyOfflineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<OfflineSyncProgress | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const reload = useCallback(async () => {
    const [owned, legacy] = await Promise.all([listOfflineItems([kind], userId), countLegacyOfflineItems()]);
    setItems(owned);
    setLegacyCount(legacy);
    setLoading(false);
  }, [kind, userId]);

  useEffect(() => {
    const refresh = () => setProgress(getOfflineSyncProgress(userId, kind));
    refresh();
    window.addEventListener("kagu-sync-progress", refresh);
    return () => window.removeEventListener("kagu-sync-progress", refresh);
  }, [kind, userId]);

  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        const [owned, legacy] = await Promise.all([listOfflineItems([kind], userId), countLegacyOfflineItems()]);
        if (!disposed) { setItems(owned); setLegacyCount(legacy); setLoading(false); }
      } catch { if (!disposed) { setError("Cihaz kayıtları okunamadı; depolama izinlerini kontrol edin."); setLoading(false); } }
    }
    void refresh();
    window.addEventListener("kagu-queue-changed", refresh);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15_000);
    return () => { disposed = true; window.removeEventListener("kagu-queue-changed", refresh); window.clearInterval(interval); };
  }, [kind, userId]);

  async function sync(retry = false) {
    if (syncing) return;
    setSyncing(true); setError(""); setMessage("");
    try {
      if (retry) {
        await stopOfflineSync(userId, kind);
        for (const item of await listOfflineItems([kind], userId)) await retryOfflineItem(item.id, userId);
      }
      showOfflineNotifications(userId, kind);
      if (kind === "PERSONNEL") await syncOfflineItems({ userId, kinds: [kind], eventsOnly: true, force: true });
      const result = await syncOfflineItems({ userId, kinds: [kind], force: true });
      setMessage(result.remaining === 0 ? "Gönderim tamamlandı. Bu ekranı kapatabilirsiniz." : `${result.remaining} kayıt henüz gönderilemedi. Tekrar deneyin; sonuç değişmezse dosyaları cihaza kaydedip yüklenemeyen kayıtları temizleyerek yeniden seçin.`);
      if (result.error) setError(result.error);
      if (result.synced > 0) router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Gönderim tamamlanamadı; kayıtlar cihazda korunuyor."); }
    finally { setSyncing(false); await reload().catch(() => {}); }
  }

  async function clearUnsent() {
    if (!window.confirm("Bu hesaptaki bekleyen dosyalar ve hatalı kayıtlar ile bu tarayıcıdaki önceki sürümden kalan, sahibi bilinmeyen tüm kayıtlar silinecek. Gönderilmemiş dosya ve notlar kaybolur. Gerekli dosyaları önce cihaza kaydedin. Temizlemek istiyor musunuz?")) return;
    setBusyId("cleanup"); setError(""); setMessage("");
    try {
      await stopOfflineSync(userId, kind);
      for (const item of await listOfflineItems([kind], userId)) {
        if (item.type !== "PERSONNEL_EVENT" || item.status === "FAILED" || item.lastError) await deleteOfflineItem(item.id, userId, { includeDependents: item.type === "PERSONNEL_EVENT" });
      }
      await clearLegacyOfflineItems(); setLegacyRecords([]);
      dismissOfflineNotifications(userId, kind);
      setMessage("Yüklenemeyen kayıtlar temizlendi. Dosyaları yükleme ekranından yeniden seçebilirsiniz.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kayıtlar temizlenemedi."); }
    finally { setBusyId(""); await reload().catch(() => {}); }
  }

  async function change(item: OfflineQueueItem, operation: () => Promise<void>, success: string) {
    setBusyId(item.id); setError(""); setMessage("");
    try { await stopOfflineSync(userId, kind); await operation(); setMessage(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Kayıt güncellenemedi."); }
    finally { setBusyId(""); await reload().catch(() => {}); }
  }

  function saveFile(file: File, index: number) {
    if (!(file instanceof Blob)) { setError("Dosya cihazda bulunamadı; yeniden seçmeniz gerekiyor."); return; }
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url; link.download = file.name || `saha-dosyasi-${index + 1}`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <section className="mt-6 rounded-lg border border-navy/10 bg-white p-5 shadow-sm" id="bekleyen-kayitlar">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Cihazdaki bekleyen kayıtlar</h2><p className="mt-1 text-sm text-muted-foreground">Bu hesap için {items.length} kayıt. Sunucuya teslim edilene kadar bu tarayıcıda saklanır.</p></div>
        <Button disabled={Boolean(busyId) || syncing || items.length === 0} onClick={() => { void sync(true); }} size="sm" type="button" variant="outline">{syncing ? "Gönderiliyor..." : "Bekleyenleri gönder"}</Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={Boolean(busyId) || syncing || items.length === 0} onClick={() => { void sync(true); }} size="sm" type="button" variant="outline">Yüklenemeyenleri tekrar yüklemeyi dene</Button>
        <Button disabled={Boolean(busyId) || (items.length === 0 && legacyCount === 0)} onClick={() => { void clearUnsent(); }} size="sm" type="button" variant="outline">Eski yüklenemeyen kayıtları temizle</Button>
        {progress || syncing ? <Button onClick={async () => { await stopOfflineSync(userId, kind); setMessage("Gönderim durduruldu. Tekrar deneyebilir veya yüklenemeyen kayıtları temizleyebilirsiniz."); }} size="sm" type="button" variant="outline">Gönderimi durdur</Button> : null}
        <Button onClick={() => { dismissOfflineNotifications(userId, kind); setMessage("Bildirimler kaldırıldı. Bekleyen dosyalar cihazda korunuyor."); }} size="sm" type="button" variant="outline">Bildirimleri kaldır</Button>
      </div>
      {progress ? <UploadProgress value={progress.overallProgress} label={`${progress.current}/${progress.total} kayıt gönderiliyor`} /> : null}
      {loading ? <p className="mt-4 text-sm text-muted-foreground">Cihaz kayıtları okunuyor...</p> : items.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">Bu hesap için bekleyen kayıt yok.</p> : (
        <div className="mt-4 space-y-3">
          {items.map((item) => {
            const sending = (item.sendingUntil ?? 0) > Date.now();
            const disabled = Boolean(busyId) || syncing;
            return (
              <article className="rounded-md border border-navy/10 p-3" key={item.id}>
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{itemLabel(item)}</p><span className="text-xs text-muted-foreground">{sending ? "Gönderiliyor" : item.status === "FAILED" ? "İşlem gerekiyor" : "Bekliyor"}</span></div>
                {item.note ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.note}</p> : null}
                {item.lastError ? <p className="mt-2 text-sm text-red-700">{item.lastError}</p> : null}
                {progress?.itemId === item.id ? <UploadProgress value={progress.progress} /> : sending ? <p className="mt-2 text-xs text-muted-foreground">Gönderim başka sekmede sürüyor olabilir. Takıldıysa tekrar deneyin; diğer sekme açıkken önce oradaki gönderimi kapatın.</p> : null}
                {(item.files ?? []).map((file, index) => <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs" key={index}><span className="break-all">{file.name || `Dosya ${index + 1}`} · {(file.size / (1024 * 1024)).toFixed(1)} MB</span><button className="text-primary underline" onClick={() => saveFile(file, index)} type="button">Dosyayı cihaza kaydet</button></div>)}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button disabled={disabled} onClick={() => { void change(item, async () => { await retryOfflineItem(item.id, userId); showOfflineNotifications(userId, kind); await syncOfflineItems({ userId, kinds: [kind], force: true }); }, "Yeniden deneme tamamlandı. Kalan kayıtları kontrol edin."); }} size="sm" type="button" variant="outline">Tekrar dene</Button>
                  <Button disabled={disabled} onClick={() => {
                    const text = item.type === "PERSONNEL_EVENT" ? "Bu saha kaydı ve ona bağlı bekleyen dosyalar bu cihazdan silinecek. Sunucuya gönderilmemiş kayıtlar kaybolur. Silmek istiyor musunuz?" : "Bu dosyanın cihazdaki bekleyen kaydı silinecek. Gerekirse önce dosyayı cihaza kaydedin. Silmek istiyor musunuz?";
                    if (window.confirm(text)) void change(item, () => deleteOfflineItem(item.id, userId, { includeDependents: item.type === "PERSONNEL_EVENT" }), "Bekleyen kayıt cihazdan silindi.");
                  }} size="sm" type="button" variant="outline">Sil</Button>
                </div>
                {item.type !== "PERSONNEL_EVENT" ? <label className="mt-3 block text-xs text-muted-foreground">Dosyayı yeniden seç
                  <input className="mt-1 block max-w-full text-xs" disabled={disabled} multiple={(item.files?.length ?? 0) > 1} onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = "";
                    if (files.length > 0) void change(item, () => replaceOfflineItemFiles(item.id, files, { userId, resetUpload: true, prepared: false }), "Yeni dosya cihazda saklandı; yükleme yeniden başlayacak.");
                  }} type="file" />
                </label> : null}
              </article>
            );
          })}
        </div>
      )}
      {legacyCount > 0 ? <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p>Önceki sürümden kalan, hesap sahipliği doğrulanmamış {legacyCount} kayıt korunuyor. Otomatik gönderilmez veya silinmez. Yönetici bu tarayıcıda Ziyaret sayfasından not ve dosyaları kurtarabilir.</p>
        {canRecoverLegacy ? <button className="mt-2 underline" type="button" onClick={async () => { try { setError(""); setLegacyRecords(await readLegacyOfflineItemsForRecovery()); } catch (cause) { setLegacyRecords([]); setError(cause instanceof Error ? cause.message : "Eski kayıtlar okunamadı."); } }}>Eski kayıtları kurtarma için incele</button> : null}
        {legacyRecords.length > 0 ? <div className="mt-3 space-y-3"><p>Özgün proje, görev ve sahibi doğrulandıktan sonra doğru hesaptan yeniden ekleyin. Eski varış/ayrılış kayıtları otomatik uygulanmaz; kaynak kayıtlar burada korunur.</p>{legacyRecords.map((record, recordIndex) => <article className="rounded-md border border-amber-200 bg-white p-3" key={`${record.id}-${recordIndex}`}><p className="break-all text-xs">{record.type} · {record.createdAt} · kayıt {record.id}</p><p className="mt-1 break-all text-xs">Proje: {record.projectId || "belirsiz"} · görev: {record.taskId || "yok"}</p>{record.note ? <textarea aria-label="Kurtarılacak eski not" className="mt-2 w-full rounded border p-2" readOnly rows={3} value={record.note} /> : null}{record.files.map((file, index) => <button className="mt-2 block underline" key={index} type="button" onClick={() => saveFile(file, index)}>{file.name || `Dosya ${index + 1}`} · dosyayı cihaza kaydet</button>)}{record.files.length < record.expectedFileCount ? <p className="mt-2 text-red-700">Bazı dosyalar cihaz deposunda bulunmuyor; özgün cihazdan yeniden seçilmeli.</p> : null}</article>)}</div> : null}
      </div> : null}
      {message ? <p className="mt-3 text-sm text-emerald-700" role="status">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
    </section>
  );
}
