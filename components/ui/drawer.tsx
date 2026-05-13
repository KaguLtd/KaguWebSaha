"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

type DrawerProps = {
  children: React.ReactNode;
  description?: string;
  isOpen: boolean;
  onClose: () => void;
  title: string;
};

export function Drawer({
  children,
  description,
  isOpen,
  onClose,
  title,
}: DrawerProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Drawer'i kapat"
        className="absolute inset-0 bg-slate-950/35"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-modal="true"
        className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-navy/10 bg-white text-navy shadow-drawer"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4 border-b border-primary/15 bg-primary/5 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <Button
            aria-label="Kapat"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}
