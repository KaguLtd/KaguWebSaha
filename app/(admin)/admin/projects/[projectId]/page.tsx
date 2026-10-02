import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";

import { CompactFilePreview } from "@/components/files/compact-file-preview";
import { FilePreviewGrid } from "@/components/files/file-preview";
import { LocationDescription } from "@/components/location/location-description";
import { Button } from "@/components/ui/button";
import { requireAnyRole } from "@/lib/auth/session";
import { formatDisplayDate, formatDisplayTime } from "@/lib/dates/format";
import { prisma } from "@/lib/db/prisma";
import { observerTimelineWhere } from "@/lib/timeline/access";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{
    projectId: string;
  }>;
}) {
  const user = await requireAnyRole(["ADMIN", "OBSERVER"]);
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
        where: user.role === "OBSERVER" ? observerTimelineWhere(user.id) : undefined,
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

  if (!project || (user.role === "OBSERVER" && !project.isActive)) {
    notFound();
  }

  const groupedTimeline = groupTimelineByDate(
    groupTimelineFileEvents(project.timelineEvents),
  );
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
          {user.role === "ADMIN" ? (
            <Button asChild variant="outline">
              <Link href="/admin/projects/new">Yeni proje</Link>
            </Button>
          ) : null}
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
              <Info label="Sehir" value={project.city || "-"} />
              <Info label="Ilgili Kisi" value={project.contactName || "-"} />
              <Info label="Ilgili Telefon" value={project.contactPhone || "-"} />
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
              <div className="mt-4">
                <FilePreviewGrid files={project.files} />
              </div>
            )}
          </article>
        </section>

        <section className="rounded-lg border border-navy/10 bg-white p-5 shadow-card">
          <h2 className="rounded-md bg-primary/5 px-3 py-2 text-lg font-semibold text-navy">
            Timeline
          </h2>
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
                      <li
                        className="rounded-md border border-navy/10 p-4 transition hover:bg-primary/5"
                        key={event.id}
                      >
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-xs font-semibold uppercase text-primary">
                              {event.title}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {event.user?.fullName || "Sistem"} tarafindan yapildi
                            </p>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="uppercase">{event.eventType}</span>
                            <span>{formatDisplayTime(event.createdAt)}</span>
                          </div>
                        </div>
                        {event.description &&
                        event.files.length === 0 ? (
                          <p className="mt-3 rounded-md bg-white px-3 py-2 text-base leading-7 text-navy">
                            <LocationDescription description={event.description} />
                          </p>
                        ) : event.files.length === 0 ? (
                          <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm leading-6 text-muted-foreground">
                            Not girilmedi.
                          </p>
                        ) : null}
                        {event.files.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2 rounded-md border border-navy/10 bg-slate-50 p-2">
                            {event.files.map((file) => (
                              <CompactFilePreview file={file} key={file.id} />
                            ))}
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

type TimelineFile = {
  id: string;
  mimeType: string;
  originalName: string;
  thumbnailStoragePath?: string | null;
};

type TimelineEventWithFile = {
  createdAt: Date;
  dailyTaskId?: string | null;
  eventType: string;
  file?: TimelineFile | null;
  id: string;
  title: string;
  userId?: string | null;
};

function groupTimelineFileEvents<T extends TimelineEventWithFile>(events: T[]) {
  const grouped: Array<Omit<T, "file"> & { files: TimelineFile[] }> = [];

  for (const event of events) {
    if (event.eventType !== "FILE_ADDED" || !event.file) {
      const { file: _file, ...rest } = event;
      grouped.push({ ...rest, files: [] });
      continue;
    }

    const previous = grouped[grouped.length - 1];

    if (previous && shouldGroupFileEvent(previous, event)) {
      previous.files.push(event.file);
      continue;
    }

    const { file: _file, ...rest } = event;
    grouped.push({ ...rest, files: [event.file] });
  }

  return grouped;
}

function shouldGroupFileEvent(
  previous: TimelineEventWithFile & { files: TimelineFile[] },
  current: TimelineEventWithFile,
) {
  const timeGapMs = Math.abs(
    previous.createdAt.getTime() - current.createdAt.getTime(),
  );

  return (
    previous.eventType === "FILE_ADDED" &&
    previous.dailyTaskId === current.dailyTaskId &&
    previous.title === current.title &&
    previous.userId === current.userId &&
    timeGapMs <= 120_000
  );
}
