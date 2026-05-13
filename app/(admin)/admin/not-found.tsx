import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function AdminNotFound() {
  return (
    <main className="p-6">
      <section className="mx-auto max-w-2xl rounded-lg border bg-white p-6 text-center shadow-sm">
        <h1 className="text-2xl font-semibold">Kayit bulunamadi</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Aradigin kayit silinmis, pasif hale gelmis veya bu alandan acilamiyor.
        </p>
        <Button asChild className="mt-5">
          <Link href="/admin">Dashboard'a don</Link>
        </Button>
      </section>
    </main>
  );
}

