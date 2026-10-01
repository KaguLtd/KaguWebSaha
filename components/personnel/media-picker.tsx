"use client";
import { Camera, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { validateUploadSelection } from "@/lib/offline/queue";

export function PersonnelMediaPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  function add(selected: FileList | null) {
    const next = [...files, ...Array.from(selected ?? [])];
    try { validateUploadSelection(next); onChange(next); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Dosya eklenemedi."); }
  }
  return <div className="mt-4 flex flex-col gap-3">
    <span className="text-sm font-medium">Fotoğraf / video / dosya</span>
    <div className="flex flex-wrap gap-2">
      <button className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm" type="button" onClick={() => camera.current?.click()}><Camera className="h-4 w-4" />Fotoğraf çek</button>
      <button className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm" type="button" onClick={() => gallery.current?.click()}><Paperclip className="h-4 w-4" />Galeriden / dosyadan seç</button>
    </div>
    <input ref={camera} className="sr-only" accept="image/*" capture="environment" type="file" aria-label="Fotoğraf çek" onChange={(event) => { add(event.target.files); event.target.value = ""; }} />
    <input ref={gallery} className="sr-only" multiple type="file" aria-label="Galeriden veya dosyadan seç" onChange={(event) => { add(event.target.files); event.target.value = ""; }} />
    {files.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-3 rounded-md border p-2">
      <SelectedPreview file={file} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm" title={file.name}>{file.name}</p><p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p></div>
      <button type="button" aria-label={`${file.name} dosyasını kaldır`} className="rounded-md p-2" onClick={() => onChange(files.filter((_, i) => i !== index))}><X className="h-4 w-4" /></button>
    </div>)}
    {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
    <p className="text-xs text-muted-foreground">Not önce kaydedilir; dosyalar bağlantıda ayrı yüklenir. Dosya başına en fazla 100 MB.</p>
  </div>;
}
function SelectedPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file.type.startsWith("image/") || /hei[cf]/i.test(file.type)) return;
    const next = URL.createObjectURL(file); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img alt={file.name} className="h-12 w-12 rounded object-cover" src={url} /> : <Paperclip className="h-8 w-8 shrink-0 text-muted-foreground" />;
}
