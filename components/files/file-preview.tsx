"use client";

import { Download, FileText, Maximize2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export type PreviewFile = {
  id: string;
  mimeType: string;
  originalName: string;
};

export function FilePreviewGrid({ files }: { files: PreviewFile[] }) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {files.map((file) => (
        <FilePreviewCard file={file} key={file.id} />
      ))}
    </div>
  );
}

export function FilePreviewCard({ file }: { file: PreviewFile }) {
  const [isOpen, setIsOpen] = useState(false);
  const fileUrl = `/api/files/${file.id}`;
  const downloadUrl = `/api/files/${file.id}?download=1`;
  const kind = getPreviewKind(file.mimeType);

  return (
    <>
      <div className="overflow-hidden rounded-md border border-primary/15 bg-white shadow-sm">
        <button
          className="group block aspect-[4/3] w-full overflow-hidden bg-slate-100 text-left"
          onClick={() => setIsOpen(true)}
          type="button"
        >
          <PreviewSurface file={file} kind={kind} src={fileUrl} />
          <span className="sr-only">Onizle</span>
        </button>
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <button
            className="min-w-0 flex-1 truncate text-left text-xs font-medium text-navy hover:text-primary"
            onClick={() => setIsOpen(true)}
            type="button"
            title={file.originalName}
          >
            {file.originalName}
          </button>
          <a
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-navy/10 text-navy transition hover:border-primary/30 hover:text-primary"
            href={downloadUrl}
            title="Indir"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Indir</span>
          </a>
        </div>
      </div>

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

function PreviewSurface({
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
        className="h-full w-full object-cover transition group-hover:scale-[1.02]"
        src={src}
      />
    );
  }

  if (kind === "pdf") {
    return (
      <iframe
        className="pointer-events-none h-full w-full border-0 bg-white"
        src={`${src}#toolbar=0&navpanes=0&scrollbar=0`}
        title={file.originalName}
      />
    );
  }

  if (kind === "video") {
    return <video className="h-full w-full object-cover" muted preload="metadata" src={src} />;
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-500">
      <FileText className="h-8 w-8" aria-hidden="true" />
      <span className="inline-flex items-center gap-1 text-xs font-medium">
        <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
        Onizle
      </span>
    </div>
  );
}

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

type PreviewKind = "file" | "image" | "pdf" | "video";

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
