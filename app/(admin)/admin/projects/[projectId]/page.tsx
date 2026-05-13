import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDisplayDate, formatDisplayTime } from "@/lib/dates/format";
import { formatFileSize } from "@/lib/files/storage";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{
    projectId: string;
  }>;
}) {
  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
    include: {
      customer: true,
      files: {
        orderBy: {
          createdAt: "desc",
        },
      },
      timelineEvents: {
        include: {
          user: true,
          file: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

  const groupedTimeline = groupTimelineByDate(project.timelineEvents);
  const mapsUrl =
    project.googleMapsUrl ||
    (project.latitude && project.longitude
      ? `https://www.google.com/maps?q=${project.latitude},${project.longitude}`
      : null);

  return (
    <main className="p-6 text-navy">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
              href="/admin/projects"
            >
              Projelere don
            </Link>
            <h1 className="mt-3 text-3xl font-semibold">{project.name}</h1>
            <p className="mt-2 text-muted-foreground">{project.customer.name}</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/admin/projects/new">Yeni proje</Link>
          </Button>
        </div>

        <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <article className="rounded-lg border border-primary/15 bg-white p-5 shadow-card">
            <h2 className="rounded-md bg-primary/5 px-3 py-2 text-lg font-semibold text-navy">
              Proje Bilgileri
            </h2>
            <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
              <Info label="Cari / Firma" value={project.customer.name} />
              <Info
                label="Proje Acilis Tarihi"
                value={formatDisplayDate(project.createdAt)}
              />
              <Info label="Proje Konumu" value={project.location || "-"} />
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">Google Maps</dt>
                <dd>
                  {mapsUrl ? (
                    <a
                      className="inline-flex items-center gap-2 text-primary hover:underline"
                      href={mapsUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                      Haritada ac
                    </a>
                  ) : (
                    "-"
                  )}
                </dd>
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <dt className="text-muted-foreground">Proje Aciklamasi</dt>
                <dd className="leading-6">{project.description || "-"}</dd>
              </div>
            </dl>
          </article>

          <article className="rounded-lg border border-navy/10 bg-white p-5 shadow-card">
            <h2 className="rounded-md bg-navy/5 px-3 py-2 text-lg font-semibold text-navy">
              Proje Dosyalari
            </h2>
            {project.files.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">Dosya yok.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {project.files.map((file) => (
                  <li
                    className="flex items-start justify-between gap-3 rounded-md border border-primary/15 p-3 transition hover:bg-primary/5"
                    key={file.id}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium text-navy">
                        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{file.originalName}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatFileSize(file.sizeBytes)} ·{" "}
                        {formatDisplayDate(file.createdAt)}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <a download href={`/api/files/${file.id}`}>
                        Indir
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>

        <section className="rounded-lg border border-navy/10 bg-white p-5 shadow-card">
          <h2 className="rounded-md bg-primary/5 px-3 py-2 text-lg font-semibold text-navy">Timeline</h2>
          {groupedTimeline.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Timeline kaydi yok.
            </p>
          ) : (
            <div className="mt-5 flex flex-col gap-6">
              {groupedTimeline.map((group) => (
                <div key={group.date}>
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    {group.date}
                  </h3>
                  <ol className="mt-3 flex flex-col gap-3">
                    {group.events.map((event) => (
                      <li className="rounded-md border border-navy/10 p-4 transition hover:bg-primary/5" key={event.id}>
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-xs font-semibold uppercase text-primary">{event.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {event.user?.fullName || "Sistem"} tarafindan yapildi
                            </p>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="uppercase">{event.eventType}</span>
                            <span>{formatDisplayTime(event.createdAt)}</span>
                          </div>
                        </div>
                        <p className="hidden">
                          {event.user?.fullName || "Sistem"} · {event.eventType}
                        </p>
                        {event.description && event.description !== event.file?.originalName ? (
                          <p className="mt-3 rounded-md bg-white px-3 py-2 text-base leading-7 text-navy">
                            {event.description}
                          </p>
                        ) : !event.file ? (
                          <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm leading-6 text-muted-foreground">
                            Not girilmedi.
                          </p>
                        ) : null}
                        {event.file ? (
                          <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2">
                            <span className="min-w-0 truncate text-sm font-medium text-navy">
                              {event.file.originalName}
                            </span>
                            <Button asChild size="sm" variant="outline">
                              <a download href={`/api/files/${event.file.id}`}>
                                Indir
                              </a>
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function groupTimelineByDate<
  T extends {
    createdAt: Date;
  },
>(events: T[]) {
  const groups = new Map<string, T[]>();

  for (const event of events) {
    const date = formatDisplayDate(event.createdAt);
    groups.set(date, [...(groups.get(date) ?? []), event]);
  }

  return Array.from(groups, ([date, items]) => ({
    date,
    events: items,
  }));
}
