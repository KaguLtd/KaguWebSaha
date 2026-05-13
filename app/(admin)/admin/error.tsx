"use client";

import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="p-6">
      <section className="mx-auto max-w-2xl rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Islem tamamlanamadi</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {error.message || "Beklenmeyen bir hata olustu."}
        </p>
        <Button className="mt-5" onClick={reset} type="button">
          Tekrar dene
        </Button>
      </section>
    </main>
  );
}

