import Link from "next/link";
import { CalendarDays, FolderKanban, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";

const principles = [
  {
    title: "Proje dosyasi",
    description: "Notlar, dosyalar, fotograflar ve olaylar tek timeline'da tutulur.",
    icon: FolderKanban,
  },
  {
    title: "Gunluk program",
    description: "Isler saate degil, sadece gune atanir.",
    icon: CalendarDays,
  },
  {
    title: "Personel ekrani",
    description: "Sahada hizli kullanilacak tek ana aksiyon akisi.",
    icon: UsersRound,
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Kagu Saha
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-foreground md:text-5xl">
            Teknik servis saha takibi icin sade baslangic.
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            Bu iskelet, karar dokumanlarindaki MVP kapsamiyla uyumlu olarak
            bagimsiz Next.js, TypeScript, Prisma ve Tailwind altyapisi icin hazirlandi.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/login">Giris ekranina git</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin">Admin alanini ac</Link>
            </Button>
          </div>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {principles.map((item) => {
            const Icon = item.icon;

            return (
              <article
                key={item.title}
                className="rounded-lg border bg-white p-5 shadow-sm"
              >
                <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
                <h2 className="mt-4 text-base font-semibold">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.description}
                </p>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

