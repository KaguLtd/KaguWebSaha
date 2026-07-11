import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { History, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { QuickProjectNote } from "@/components/admin/quick-project-note";
import { requireAnyRole } from "@/lib/auth/session";
import { formatDisplayDate } from "@/lib/dates/format";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    customerId?: string;
    q?: string;
    status?: string;
  }>;
}) {
  const user = await requireAnyRole(["ADMIN", "OBSERVER"]);
  const params = await searchParams;
  const query = String(params?.q ?? "").trim();
  const status =
    user.role === "ADMIN" && ["active", "archived", "all"].includes(params?.status ?? "")
      ? String(params?.status)
      : "active";
  const customerId = String(params?.customerId ?? "").trim();
  const where: Prisma.ProjectWhereInput = {
    ...(status === "active" ? { isActive: true } : {}),
    ...(status === "archived" ? { isActive: false } : {}),
    ...(customerId ? { customerId } : {}),
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
  };
  const [customers, projects] = await Promise.all([
    prisma.customer.findMany({
      orderBy: {
        name: "asc",
      },
    }),
    prisma.project.findMany({
      where,
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
    }),
  ]);

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
          {user.role === "ADMIN" ? (
            <Button asChild>
              <Link href="/admin/projects/new">Yeni proje</Link>
            </Button>
          ) : null}
        </div>

        <form className="mt-6 grid gap-3 rounded-lg border border-navy/10 bg-white p-4 shadow-card md:grid-cols-[1.5fr_1fr_1fr_auto]">
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
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
            defaultValue={customerId}
            name="customerId"
          >
            <option value="">Tum cariler</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          {user.role === "ADMIN" ? (
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
              defaultValue={status}
              name="status"
            >
              <option value="active">Aktif projeler</option>
              <option value="archived">Arsiv projeler</option>
              <option value="all">Tum projeler</option>
            </select>
          ) : null}
          <Button type="submit" variant="outline">
            Filtrele
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
            <div className="divide-y divide-navy/10 md:hidden">
              {projects.map((project) => (
                <article
                  className={`px-3 py-3 ${
                    project.isActive ? "bg-white" : "bg-slate-50 opacity-70"
                  }`}
                  key={project.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        className="block truncate text-sm font-semibold text-primary underline-offset-2 hover:underline"
                        href={`/admin/projects/${project.id}`}
                      >
                        {project.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {project.customer.name}{project.isActive ? "" : " · Arsiv"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button asChild className="h-8 w-8 p-0" size="icon" title="Gecmisi Incele" variant="outline">
                        <Link aria-label={`${project.name} gecmisini incele`} href={`/admin/projects/${project.id}`}>
                          <History aria-hidden="true" className="h-4 w-4" />
                          <span className="sr-only">Gecmisi Incele</span>
                        </Link>
                      </Button>
                      <QuickProjectNote iconOnly projectId={project.id} projectName={project.name} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead className="border-b border-navy/10 bg-white text-xs uppercase text-slate-950">
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
                        <Link
                          className="font-medium text-primary underline-offset-2 hover:underline"
                          href={`/admin/projects/${project.id}`}
                        >
                          {project.name}
                        </Link>
                        {!project.isActive ? (
                          <p className="mt-1 text-xs text-muted-foreground">Arsiv</p>
                        ) : null}
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
                        <div className="flex flex-wrap gap-2">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/admin/projects/${project.id}`}>Gecmisi Incele</Link>
                          </Button>
                          <QuickProjectNote projectId={project.id} projectName={project.name} />
                        </div>
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
