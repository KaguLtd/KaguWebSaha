import { notFound } from "next/navigation";
import { FileText, MapPin } from "lucide-react";

import { LocationFields } from "@/components/personnel/location-fields";
import {
  OfflineArriveForm,
  OfflineLeaveForm,
  OfflineNoteForm,
} from "@/components/personnel/offline-task-forms";
import {
  formatDisplayDate,
  formatDisplayDateOnly,
  formatDisplayTime,
} from "@/lib/dates/format";
import { getTodayDateOnly } from "@/lib/dates/today";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function PersonnelTaskDetailPage({
  params,
}: {
  params: Promise<{
    taskId: string;
  }>;
}) {
  const user = await requireRole("PERSONNEL");
  const { taskId } = await params;
  const today = getTodayDateOnly();
  const [task, activeOnSiteTask] = await Promise.all([
    prisma.dailyTask.findFirst({
      where: {
        id: taskId,
        taskDate: today,
        assignees: {
          some: {
            userId: user.id,
          },
        },
      },
      include: {
        project: {
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
              take: 30,
            },
          },
        },
      },
    }),
    prisma.dailyTask.findFirst({
      where: {
        taskDate: today,
        status: "ON_SITE",
        assignees: {
          some: {
            userId: user.id,
          },
        },
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (!task) {
    notFound();
  }

  const tomorrow = new Date(today);
  tomorrow.setUTCDate(today.getUTCDate() + 1);
  const todayNoteEvent = await prisma.projectTimelineEvent.findFirst({
    where: {
      projectId: task.projectId,
      dailyTaskId: task.id,
      userId: user.id,
      eventType: "NOTE_ADDED",
      createdAt: {
        gte: today,
        lt: tomorrow,
      },
    },
    select: {
      id: true,
    },
  });

  const mapsUrl = getProjectMapsUrl({
    googleMapsUrl: task.project.googleMapsUrl,
    latitude: task.project.latitude ? String(task.project.latitude) : null,
    location: task.project.location,
    longitude: task.project.longitude ? String(task.project.longitude) : null,
  });
  const visibleTimelineEvents = task.project.timelineEvents.filter((event) =>
    ["FILE_ADDED", "NOTE_ADDED"].includes(event.eventType),
  );
  const hasTodayNote = Boolean(todayNoteEvent);
  const activeOtherOnSiteTask = Boolean(
    activeOnSiteTask && activeOnSiteTask.id !== task.id,
  );

  return (
    <main className="p-6">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <section className="rounded-lg border bg-white p-5 text-center shadow-sm">
          <h1 className="text-2xl font-semibold">{task.project.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {task.project.customer.name}
          </p>

          <div className="mt-8 flex justify-center">
            {task.status === "PLANNED" ? (
              <OfflineArriveForm
                disabled={activeOtherOnSiteTask}
                disabledMessage="Önce aktif sahadaki görevi kapatmalısın."
                taskId={task.id}
              >
                <LocationFields />
                <button
                  className="flex h-44 w-44 items-center justify-center rounded-full bg-emerald-600 px-6 text-center text-2xl font-semibold leading-tight text-white shadow-lg transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none"
                  disabled={activeOtherOnSiteTask}
                  type="submit"
                >
                  Sahaya Ulaştım
                </button>
              </OfflineArriveForm>
            ) : null}

            {task.status === "ON_SITE" ? (
              <div className="flex w-full flex-col items-center gap-5">
                <OfflineLeaveForm hasTodayNote={hasTodayNote} taskId={task.id}>
                  <LocationFields />
                </OfflineLeaveForm>
              </div>
            ) : null}

            {task.status === "COMPLETED" ? (
              <div className="flex h-44 w-44 items-center justify-center rounded-full bg-slate-300 px-6 text-center text-2xl font-semibold leading-tight text-slate-700">
                Tamamlandı
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Bugünkü Not / Dosya Ekle</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Fotoğraf, PDF, Excel, DWG veya başka dosyalar eklenebilir.
          </p>
          <OfflineNoteForm taskId={task.id}>
            <div className="mt-4 flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="note">
                Not
              </label>
              <textarea
                className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
                id="note"
                name="note"
                required
                rows={5}
              />
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="files">
                Dosya / fotoğraf
              </label>
              <input
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm file:mr-3 file:rounded-md file:border file:border-navy/20 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-navy file:shadow-sm hover:file:bg-primary/10"
                id="files"
                multiple
                name="files"
                type="file"
              />
            </div>
            <button
              className="mt-5 w-full rounded-md border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              type="submit"
            >
              Kaydet
            </button>
          </OfflineNoteForm>
        </section>

        <section className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Proje Bilgileri</h2>
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <Info label="Tarih" value={formatDisplayDateOnly(task.taskDate)} />
            <LocationInfo location={task.project.location} mapsUrl={mapsUrl} />
            <Info label="Açıklama" value={task.project.description || "-"} />
            {task.managerNote ? (
              <Info label="Yönetici Notu" value={task.managerNote} />
            ) : null}
          </div>
        </section>

        {task.project.files.length > 0 ? (
          <section className="rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Dosyalar</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {task.project.files.slice(0, 10).map((file) => (
                <li key={file.id}>
                  <a
                    className="inline-flex max-w-full items-center gap-2 text-sm font-medium text-primary hover:underline"
                    href={`/api/files/${file.id}`}
                  >
                    <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{file.originalName}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Proje Geçmişi</h2>
          {visibleTimelineEvents.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Ek not veya dosya yok.
            </p>
          ) : (
            <ol className="mt-4 flex flex-col gap-3">
              {visibleTimelineEvents.map((event) => (
                <li className="rounded-md border p-3" key={event.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{event.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {event.user?.fullName || "Sistem"} ·{" "}
                        {formatDisplayDate(event.createdAt)}{" "}
                        {formatDisplayTime(event.createdAt)}
                      </p>
                    </div>
                  </div>
                  {event.description &&
                  event.description !== event.file?.originalName ? (
                    <p className="mt-3 text-sm leading-6">{event.description}</p>
                  ) : null}
                  {event.file ? (
                    <a
                      className="mt-3 inline-flex max-w-full min-w-0 items-center gap-2 text-sm font-medium text-primary hover:underline"
                      href={`/api/files/${event.file.id}`}
                    >
                      <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate">
                        {event.file.originalName}
                      </span>
                    </a>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 leading-6">{value}</p>
    </div>
  );
}

function LocationInfo({
  location,
  mapsUrl,
}: {
  location: string | null;
  mapsUrl: string | null;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">
        Konum
      </p>
      {mapsUrl ? (
        <a
          className="mt-1 inline-flex max-w-full items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 font-medium text-primary transition hover:bg-primary/15"
          href={mapsUrl}
          rel="noreferrer"
          target="_blank"
        >
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {location || "Google Maps'te Aç"}
          </span>
        </a>
      ) : (
        <p className="mt-1 leading-6">{location || "-"}</p>
      )}
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
