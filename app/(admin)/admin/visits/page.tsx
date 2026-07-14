import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requireAnyRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function VisitsPage({
  searchParams,
}: {
  searchParams?: Promise<{ customerId?: string; q?: string }>;
}) {
  await requireAnyRole(["ADMIN", "OBSERVER"]);
  const params = await searchParams;
  const customerId = String(params?.customerId ?? "").trim();
  const query = String(params?.q ?? "").trim();
  const where: Prisma.ProjectWhereInput = {
    isActive: true,
    ...(customerId ? { customerId } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { customer: { name: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [customers, projects] = await Promise.all([
    prisma.customer.findMany({ orderBy: { name: "asc" } }),
    prisma.project.findMany({
      where,
      include: { customer: true },
      orderBy: [{ customer: { name: "asc" } }, { name: "asc" }],
    }),
  ]);

  return (
    <main className="p-6 text-navy">
      <div className="mx-auto max-w-6xl">
        <div>
          <h1 className="text-3xl font-semibold">Ziyaret</h1>
          <p className="mt-2 text-muted-foreground">
            Programa bagli olmadan proje ziyareti, not ve fotograf kaydi tut.
          </p>
        </div>

        <form className="mt-6 grid gap-3 rounded-lg border border-navy/10 bg-white p-4 shadow-card md:grid-cols-[1.5fr_1fr_auto]">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
            />
            <input
              className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-navy shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary"
              defaultValue={query}
              name="q"
              placeholder="Proje veya cari ara"
              type="search"
            />
          </div>
          <select
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
            defaultValue={customerId}
            name="customerId"
          >
            <option value="">Tum cariler</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}</option>
            ))}
          </select>
          <Button type="submit" variant="outline">Filtrele</Button>
        </form>

        {projects.length === 0 ? (
          <section className="mt-8 rounded-lg border border-primary/15 bg-white p-8 text-center shadow-card">
            <h2 className="text-lg font-semibold">Proje bulunamadi</h2>
            <p className="mt-2 text-sm text-muted-foreground">Arama veya cari filtresini degistirin.</p>
          </section>
        ) : (
          <section className="mt-6 overflow-hidden rounded-lg border border-navy/10 bg-white shadow-card">
            <div className="divide-y divide-navy/10 md:hidden">
              {projects.map((project) => (
                <article className="flex items-center justify-between gap-3 px-3 py-2.5" key={project.id}>
                  <div className="min-w-0">
                    <Link className="block truncate text-sm font-semibold text-primary" href={`/admin/visits/${project.id}`}>
                      {project.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{project.customer.name}</p>
                  </div>
                  <Button asChild className="h-8 shrink-0 px-2.5" size="sm" variant="outline">
                    <Link href={`/admin/visits/${project.id}`}>Projeyi Ac</Link>
                  </Button>
                </article>
              ))}
            </div>
            <div className="hidden md:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-navy/10 bg-slate-50 text-xs uppercase">
                  <tr><th className="px-4 py-3">Proje</th><th className="px-4 py-3">Cari</th><th className="w-32 px-4 py-3">Islem</th></tr>
                </thead>
                <tbody className="divide-y divide-navy/10">
                  {projects.map((project) => (
                    <tr className="hover:bg-primary/5" key={project.id}>
                      <td className="px-4 py-3"><Link className="font-medium text-primary hover:underline" href={`/admin/visits/${project.id}`}>{project.name}</Link></td>
                      <td className="px-4 py-3">{project.customer.name}</td>
                      <td className="px-4 py-3"><Button asChild size="sm" variant="outline"><Link href={`/admin/visits/${project.id}`}>Projeyi Ac</Link></Button></td>
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
