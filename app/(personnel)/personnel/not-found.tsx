import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function PersonnelNotFound() {
  return (
    <main className="p-6">
      <section className="mx-auto max-w-md rounded-lg border bg-white p-6 text-center shadow-sm">
        <h1 className="text-2xl font-semibold">Gorev bulunamadi</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Bu gorev bugun sana atanmis olmayabilir.
        </p>
        <Button asChild className="mt-5 w-full">
          <Link href="/personnel">Bugunku islere don</Link>
        </Button>
      </section>
    </main>
  );
}

