"use client";

import { Download, FileText, ImageIcon, Maximize2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { PreviewFile } from "@/components/files/file-preview";

export function CompactFilePreview({ file }: { file: PreviewFile }) {
  const [isOpen, setIsOpen] = useState(false);
  const fileUrl = `/api/files/${file.id}`;
  const downloadUrl = `/api/files/${file.id}?download=1`;
  const thumbnailUrl = `/api/files/${file.id}/thumbnail`;
  const kind = getPreviewKind(file.mimeType);
  const hasThumbnail = Boolean(file.thumbnailStoragePath);

  return (
    <>
      <button
        className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-navy/10 bg-slate-100 text-slate-500 transition hover:border-primary/40"
        onClick={() => setIsOpen(true)}
        title={file.originalName}
        type="button"
      >
        {kind === "image" && hasThumbnail ? (
          <img
            alt=""
            className="h-full w-full object-cover transition group-hover:scale-105"
            src={thumbnailUrl}
          />
        ) : kind === "image" ? (
          <span className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-5 w-5" aria-hidden="true" />
          </span>
        ) : kind === "video" ? (
          <video className="h-full w-full object-cover" muted preload="metadata" src={fileUrl} />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <span className="absolute inset-0 hidden items-center justify-center bg-black/30 text-white group-hover:flex">
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="sr-only">{file.originalName} onizle</span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <p className="min-w-0 truncate text-sm font-semibold text-navy">
                {file.originalName}
              </p>
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={downloadUrl}>
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Indir
                  </a>
                </Button>
                <Button
                  onClick={() => setIsOpen(false)}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Kapat</span>
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-slate-100 p-3">
              <LargePreview file={file} kind={kind} src={fileUrl} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

type PreviewKind = "file" | "image" | "pdf" | "video";

function LargePreview({
  file,
  kind,
  src,
}: {
  file: PreviewFile;
  kind: PreviewKind;
  src: string;
}) {
  if (kind === "image") {
    return (
      <img
        alt={file.originalName}
        className="mx-auto max-h-[76vh] max-w-full object-contain"
        src={src}
      />
    );
  }

  if (kind === "pdf") {
    return <iframe className="h-[76vh] w-full border-0 bg-white" src={src} title={file.originalName} />;
  }

  if (kind === "video") {
    return <video className="mx-auto max-h-[76vh] max-w-full" controls src={src} />;
  }

  return (
    <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-center text-muted-foreground">
      <FileText className="h-12 w-12" aria-hidden="true" />
      <p>Bu dosya turu icin site icinde onizleme yok.</p>
    </div>
  );
}

function getPreviewKind(mimeType: string): PreviewKind {
  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType === "application/pdf") {
    return "pdf";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  return "file";
}
