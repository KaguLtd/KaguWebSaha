import Link from "next/link";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDisplayDate } from "@/lib/dates/format";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
  }>;
}) {
  const params = await searchParams;
  const query = String(params?.q ?? "").trim();
  const projects = await prisma.project.findMany({
    where: {
      isActive: true,
      ...(query
        ? {
          OR: [
            {
              name: {
                contains: query,
                mode: "insensitive",
              },
            },
            {
              customer: {
                name: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
          ],
        }
        : {}),
    },
    include: {
      customer: true,
      _count: {
        select: {
          files: true,
          timelineEvents: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  return (
    <main className="p-6 text-navy">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-navy">Projeler</h1>
            <p className="mt-2 text-muted-foreground">
              Proje dosyalarini ara ve gecmis timeline kayitlarini goruntule.
            </p>
          </div>
          <Button asChild>
            <Link href="/admin/projects/new">Yeni proje</Link>
          </Button>
        </div>

        <form className="mt-6 flex max-w-lg gap-2">
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
            />
            <input
              className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
              defaultValue={query}
              name="q"
              placeholder="Proje veya cari ara"
              type="search"
            />
          </div>
          <Button type="submit" variant="outline">
            Ara
          </Button>
        </form>

        {projects.length === 0 ? (
          <section className="mt-8 rounded-lg border border-primary/15 bg-white p-8 text-center shadow-card">
            <h2 className="text-lg font-semibold">Proje bulunamadi</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Arama kriterini degistir veya yeni proje olustur.
            </p>
          </section>
        ) : (
          <section className="mt-8 overflow-hidden rounded-lg border border-navy/10 bg-white shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead className="bg-navy text-xs uppercase text-white/75">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Proje</th>
                    <th className="px-4 py-3 font-semibold">Cari / Firma</th>
                    <th className="px-4 py-3 font-semibold">Acilis Tarihi</th>
                    <th className="px-4 py-3 font-semibold">Dosya</th>
                    <th className="px-4 py-3 font-semibold">Timeline</th>
                    <th className="px-4 py-3 font-semibold">Islem</th>
                  </tr>
                </thead>
                <tbody className="divide-y text-navy">
                  {projects.map((project) => (
                    <tr className="transition hover:bg-primary/5" key={project.id}>
                      <td className="px-4 py-4">
                        <p className="font-medium text-navy">{project.name}</p>
                      </td>
                      <td className="px-4 py-4">{project.customer.name}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {formatDisplayDate(project.createdAt)}
                      </td>
                      <td className="px-4 py-4">{project._count.files}</td>
                      <td className="px-4 py-4">
                        {project._count.timelineEvents} kayit
                      </td>
                      <td className="px-4 py-4">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/projects/${project.id}`}>
                            Gecmisi Incele
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
