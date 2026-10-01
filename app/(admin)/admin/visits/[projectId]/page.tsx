import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, X } from "lucide-react";

import { VisitInteractionPanel } from "@/components/admin/visit-interaction-panel";
import { CompactFilePreview } from "@/components/files/compact-file-preview";
import { FilePreviewGrid } from "@/components/files/file-preview";
import { LocationDescription } from "@/components/location/location-description";
import { Button } from "@/components/ui/button";
import { requireAnyRole } from "@/lib/auth/session";
import { formatDisplayDate, formatDisplayDateOnly, formatDisplayTime } from "@/lib/dates/format";
import { getDateOnlyRangeInAppTimeZone, getTodayDateOnly } from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";
import { readProjectVisits } from "@/lib/visits/read";
import { getVisitDayKey } from "@/lib/visits/status";

export const dynamic = "force-dynamic";

export default async function VisitProjectDetailPage({
  params,
}: {
  params: Promise<{
    projectId: string;
  }>;
}) {
  const user = await requireAnyRole(["ADMIN", "OBSERVER"]);
  const { projectId } = await params;
  const todayRange = getDateOnlyRangeInAppTimeZone(getTodayDateOnly());
  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
    include: {
      customer: true,
      dailyTasks: {
        orderBy: {
          taskDate: "desc",
        },
        select: {
          status: true,
          taskDate: true,
        },
        take: 1,
      },
      files: {
        orderBy: {
          createdAt: "desc",
        },
        take: 12,
      },
      timelineEvents: {
        where:
          user.role === "OBSERVER"
            ? {
                dailyTaskId: null,
                OR: [{ projectVisitId: { not: null } }, { userId: user.id }],
              }
            : undefined,
        include: {
          file: true,
          user: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 80,
      },
      visits: {
        include: {
          files: {
            orderBy: {
              createdAt: "desc",
            },
          },
          visitedBy: true,
        },
        orderBy: {
          visitedAt: "desc",
        },
        take: 20,
      },
    },
  });

  if (!project || (user.role === "OBSERVER" && !project.isActive)) {
    notFound();
  }

  const mapsUrl = getProjectMapsUrl({
    googleMapsUrl: project.googleMapsUrl,
    latitude: project.latitude ? String(project.latitude) : null,
    location: project.location,
    longitude: project.longitude ? String(project.longitude) : null,
  });
  const [latestVisits, currentUserVisitToday] = await Promise.all([
    readProjectVisits({ projectId: project.id, latestPerProject: true }),
    prisma.projectVisit.findFirst({
      where: { projectId: project.id, visitedByUserId: user.id, visitedAt: { gte: todayRange.start, lt: todayRange.end } },
      orderBy: [{ visitedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
  ]);
  const lastVisit = latestVisits[0];
  const lastTask = project.dailyTasks[0];
  const groupedTimeline = groupTimelineByDate(
    groupTimelineFileEvents(project.timelineEvents),
  );

  return (
    <main className="p-6 text-navy">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-semibold">{project.name}</h1>
            <p className="mt-2 text-muted-foreground">{project.customer.name}</p>
          </div>
          <Button asChild className="h-9 w-9 shrink-0 p-0" size="icon" title="Kapat" variant="outline">
            <Link aria-label="Ziyaret detayini kapat" href="/admin/visits">
              <X aria-hidden="true" className="h-5 w-5" />
              <span className="sr-only">Kapat</span>
            </Link>
          </Button>
        </div>

        <section className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <article className="rounded-lg border border-primary/15 bg-white p-5 shadow-card">
            <h2 className="rounded-md bg-primary/5 px-3 py-2 text-lg font-semibold text-navy">
              Proje Bilgileri
            </h2>
            <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
              <Info label="Cari / Firma" value={project.customer.name} />
              <Info
                label="Son ziyaret"
                value={
                  lastVisit
                    ? `${formatDisplayDate(lastVisit.visitedAt)} - ${lastVisit.userName}`
                    : "Ziyaret yok"
                }
              />
              <Info
                label="Son gorev"
                value={lastTask ? formatDisplayDateOnly(lastTask.taskDate) : "-"}
              />
              <Info label="Proje durumu" value={project.isActive ? "Aktif" : "Arsiv"} />
              <Info label="Konum" value={project.location || "-"} />
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
                <dt className="text-muted-foreground">Aciklama</dt>
                <dd className="leading-6">{project.description || "-"}</dd>
              </div>
            </dl>
          </article>

          <article className="rounded-lg border border-navy/10 bg-white p-5 shadow-card">
            <h2 className="rounded-md bg-navy/5 px-3 py-2 text-lg font-semibold text-navy">
              Son Dosyalar
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

        <VisitInteractionPanel
          initialVisitId={currentUserVisitToday?.id ?? null}
          currentDay={getVisitDayKey()}
          projectId={project.id}
          userId={user.id}
        />

        <section className="rounded-lg border border-navy/10 bg-white p-5 shadow-card">
          <h2 className="rounded-md bg-primary/5 px-3 py-2 text-lg font-semibold text-navy">
            Onceki Ziyaretler
          </h2>
          {project.visits.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Ziyaret kaydi yok.</p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {project.visits.map((visit) => (
                <article
                  className="rounded-md border border-navy/10 bg-white p-4"
                  key={visit.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{visit.visitedBy.fullName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDisplayDate(visit.visitedAt)}{" "}
                        {formatDisplayTime(visit.visitedAt)}
                      </p>
                    </div>
                    <span className="rounded-md border border-navy/10 px-2 py-1 text-xs font-medium">
                      {visit.files.length} dosya
                    </span>
                  </div>
                  {visit.note ? (
                    <p className="mt-3 rounded-md bg-primary/5 px-3 py-2 text-sm leading-6">
                      {visit.note}
                    </p>
                  ) : null}
                  {visit.latitude && visit.longitude ? (
                    <a
                      className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                      href={`https://www.google.com/maps?q=${visit.latitude},${visit.longitude}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                      Ziyaret konumu
                    </a>
                  ) : null}
                  {visit.files.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2 rounded-md border border-navy/10 bg-slate-50 p-2">
                      {visit.files.slice(0, 6).map((file) => (
                        <CompactFilePreview file={file} key={file.id} />
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-navy/10 bg-white p-5 shadow-card">
          <h2 className="rounded-md bg-primary/5 px-3 py-2 text-lg font-semibold text-navy">
            Proje Timeline
          </h2>
          {groupedTimeline.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Timeline kaydi yok.</p>
          ) : (
            <div className="mt-5 flex flex-col gap-6">
              {groupedTimeline.map((group) => (
                <div key={group.date}>
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    {group.date}
                  </h3>
                  <ol className="mt-3 flex flex-col gap-3">
                    {group.events.map((event) => (
                      <li className="rounded-md border border-navy/10 p-4" key={event.id}>
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
                        {event.description && event.files.length === 0 ? (
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

function getProjectMapsUrl({
  googleMapsUrl,
  latitude,
  location,
  longitude,
}: {
  googleMapsUrl: string | null;
  latitude: string | null;
  location: string | null;
  longitude: string | null;
}) {
  if (googleMapsUrl) {
    return googleMapsUrl;
  }

  if (location && isUrl(location)) {
    return location;
  }

  if (latitude && longitude) {
    return `https://www.google.com/maps?q=${latitude},${longitude}`;
  }

  return null;
}

function isUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
  projectVisitId?: string | null;
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
    previous.projectVisitId === current.projectVisitId &&
    previous.title === current.title &&
    previous.userId === current.userId &&
    timeGapMs <= 120_000
  );
}
