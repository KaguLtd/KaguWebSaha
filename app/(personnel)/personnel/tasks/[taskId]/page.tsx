import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, MapPin } from "lucide-react";

import { LocationFields } from "@/components/personnel/location-fields";
import {
  OfflineArriveForm,
  OfflineLeaveForm,
} from "@/components/personnel/offline-task-forms";
import { Button } from "@/components/ui/button";
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
  const task = await prisma.dailyTask.findFirst({
    where: {
      id: taskId,
      taskDate: getTodayDateOnly(),
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
  });

  if (!task) {
    notFound();
  }

  const mapsUrl =
    task.project.googleMapsUrl ||
    (task.project.latitude && task.project.longitude
      ? `https://www.google.com/maps?q=${task.project.latitude},${task.project.longitude}`
      : null);

  return (
    <main className="p-6">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <Link
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
          href="/personnel"
        >
          Bugunku islere don
        </Link>

        <section className="rounded-lg border bg-white p-5 text-center shadow-sm">
          <h1 className="text-2xl font-semibold">{task.project.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {task.project.customer.name}
          </p>

          <div className="mt-8 flex justify-center">
            {task.status === "PLANNED" ? (
              <OfflineArriveForm taskId={task.id}>
                <LocationFields />
                <button
                  className="flex h-44 w-44 items-center justify-center rounded-full bg-emerald-600 px-6 text-center text-2xl font-semibold leading-tight text-white shadow-lg transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200"
                  type="submit"
                >
                  Sahaya Ulastim
                </button>
              </OfflineArriveForm>
            ) : null}

            {task.status === "ON_SITE" ? (
              <div className="flex w-full flex-col items-center gap-5">
                <div className="flex h-44 w-44 items-center justify-center rounded-full bg-red-600 px-6 text-center text-2xl font-semibold leading-tight text-white shadow-lg">
                  Sahadan Ayrildim
                </div>
                <OfflineLeaveForm taskId={task.id}>
                  <LocationFields />
                  <div className="flex flex-col gap-2">
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
                      Dosya / fotograf
                    </label>
                    <input
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
                      id="files"
                      multiple
                      name="files"
                      type="file"
                    />
                  </div>
                  <Button className="mt-5 w-full" type="submit">
                    Gorevi kapat
                  </Button>
                </OfflineLeaveForm>
              </div>
            ) : null}

            {task.status === "COMPLETED" ? (
              <div className="flex h-44 w-44 items-center justify-center rounded-full bg-slate-300 px-6 text-center text-2xl font-semibold leading-tight text-slate-700">
                Tamamlandi
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Proje Bilgileri</h2>
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <Info label="Tarih" value={formatDisplayDateOnly(task.taskDate)} />
            <Info label="Konum" value={task.project.location || "-"} />
            {mapsUrl ? (
              <a
                className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
                href={mapsUrl}
                rel="noreferrer"
                target="_blank"
              >
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Google Maps'te ac
              </a>
            ) : null}
            <Info label="Aciklama" value={task.project.description || "-"} />
            {task.managerNote ? (
              <Info label="Yonetici Notu" value={task.managerNote} />
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
          <h2 className="text-lg font-semibold">Proje Gecmisi</h2>
          {task.project.timelineEvents.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Timeline kaydi yok.
            </p>
          ) : (
            <ol className="mt-4 flex flex-col gap-3">
              {task.project.timelineEvents.map((event) => (
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
                  {event.description ? (
                    <p className="mt-3 text-sm leading-6">{event.description}</p>
                  ) : null}
                  {event.file ? (
                    <a
                      className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                      href={`/api/files/${event.file.id}`}
                    >
                      <FileText className="h-4 w-4" aria-hidden="true" />
                      {event.file.originalName}
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
