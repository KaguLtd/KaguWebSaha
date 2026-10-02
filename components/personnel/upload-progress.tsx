"use client";
import { LoaderCircle } from "lucide-react";

export function UploadProgress({ value, label = "Dosyalar sunucuya gönderiliyor" }: { value: number; label?: string }) {
  const percentage = Math.min(100, Math.max(0, Math.floor(value)));
  return <div className="mt-3" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
    <div className="mb-1 flex justify-between gap-2 text-xs"><span className="flex items-center gap-2"><LoaderCircle aria-hidden="true" className="h-3 w-3 shrink-0 motion-safe:animate-spin" />{label}</span><span className="shrink-0 tabular-nums">%{percentage}</span></div>
    <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-safe:animate-pulse" style={{ width: `${percentage}%` }} /></div>
    <p className="mt-2 text-xs text-muted-foreground">Gönderim tamamlanana kadar bu ekranı açık tutun. Yüzde sabitken dosya hazırlanıyor veya sunucu yanıtı bekleniyor. Tamamlandığında ekranı kapatabilirsiniz.</p>
  </div>;
}
