import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";

import { StatusBadge } from "@/components/admin/status-badge";
import { CompactFilePreview } from "@/components/files/compact-file-preview";
import { formatDisplayDateOnly, formatDisplayTime } from "@/lib/dates/format";
import {
  APP_TIME_ZONE_LABEL,
  getDateOnlyRangeInAppTimeZone,
  getTodayDateOnly,
} from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";
import { requireAnyRole } from "@/lib/auth/session";

type DashboardTask = Prisma.DailyTaskGetPayload<{
  include: {
    assignees: {
      include: {
        user: true;
      };
    };
    project: {
      include: {
        customer: true;
      };
    };
    timelineEvents: {
      include: {
        file: true;
        user: true;
      };
    };
  };
}>;

export default async function AdminPage() {
  const user = await requireAnyRole(["ADMIN", "OBSERVER"]);
  if (user.role === "OBSERVER") {
    redirect("/admin/visits");
  }
  const today = getTodayDateOnly();
  const yesterday = addDateOnlyDays(today, -1);
  const tasksPromise = prisma.dailyTask.findMany({
    where: {
      taskDate: {
        gte: today,
      },
    },
    include: {
      assignees: {
        include: {
          user: true,
        },
        orderBy: {
          user: {
            fullName: "asc",
          },
        },
      },
      project: {
        include: {
          customer: true,
        },
      },
      timelineEvents: {
        where: {
          eventType: {
            in: ["NOTE_ADDED", "FILE_ADDED"],
          },
        },
        include: {
          file: true,
          user: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
    orderBy: [{ taskDate: "asc" }, { createdAt: "asc" }],
  });
  const yesterdayTasksPromise = prisma.dailyTask.findMany({
    where: {
      taskDate: yesterday,
    },
    include: {
      assignees: {
        include: {
          user: true,
        },
        orderBy: {
          user: {
            fullName: "asc",
          },
        },
      },
      project: {
        include: {
          customer: true,
        },
      },
      timelineEvents: {
        where: {
          eventType: {
            in: ["NOTE_ADDED", "FILE_ADDED"],
          },
        },
        include: {
          file: true,
          user: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  return (
    <main className="p-6 text-navy">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-navy">Yonetici Dashboard</h1>
            <p className="mt-2 text-muted-foreground">
              Bugunun ve gelecek gunlerin planlanmis saha isleri.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Bugun: {formatDisplayDateOnly(getTodayDateOnly())} ({APP_TIME_ZONE_LABEL})
          </p>
        </div>

        <TaskTable tasksPromise={tasksPromise} />
        <YesterdaySection tasksPromise={yesterdayTasksPromise} yesterday={yesterday} />
      </div>
    </main>
  );
}

async function TaskTable({
  tasksPromise,
}: {
  tasksPromise: Promise<DashboardTask[]>;
}) {
  const tasks = await tasksPromise;
  const today = getTodayDateOnly();
  const groupedTasks = groupTasksByDay(tasks, today);

  if (tasks.length === 0) {
    return (
      <section className="mt-6 rounded-lg border border-primary/15 bg-white p-8 text-center shadow-card">
        <h2 className="text-lg font-semibold">Planlanmis is yok</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Bugun veya gelecek tarihler icin henuz saha gorevi olusturulmamis.
          Gecmis isler dashboard'da gosterilmez; proje timeline'inda incelenir.
        </p>
      </section>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-5">
      {groupedTasks.map((group) => (
        <section
          className="overflow-hidden rounded-lg border border-navy/10 bg-white shadow-card"
          key={group.key}
        >
          <div className="flex flex-col gap-1 border-b border-navy/10 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-lg font-semibold text-navy">{group.title}</h2>
            <p className="text-xs font-medium text-muted-foreground">
              {formatDisplayDateOnly(group.date)}
            </p>
          </div>
          <div className="grid gap-3 p-3 md:hidden">
            {group.tasks.map((task) => (
              <DashboardTaskCard task={task} key={task.id} />
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead className="border-b border-navy/10 bg-slate-50 text-xs uppercase text-slate-950">
                <tr>
                  <th className="w-[28%] px-4 py-3 font-semibold">Proje / Cari</th>
                  <th className="w-[22%] px-4 py-3 font-semibold">Atanan Personeller</th>
                  <th className="w-[34%] px-4 py-3 font-semibold">Bugun Yapilanlar</th>
                  <th className="w-[16%] px-4 py-3 font-semibold">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y text-navy">
                {group.tasks.map((task) => (
                  <tr className="align-top transition hover:bg-primary/5" key={task.id}>
                    <td className="px-4 py-4">
                      <Link
                        className="font-semibold leading-5 text-primary underline-offset-2 hover:underline"
                        href={`/admin/projects/${task.projectId}`}
                      >
                        {task.project.name}
                      </Link>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        {task.project.customer.name}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {task.assignees.length > 0 ? (
                          task.assignees.map((assignee) => (
                            <span
                              className="rounded-md border border-navy/10 bg-white px-2 py-1 text-xs font-medium text-navy"
                              key={assignee.id}
                            >
                              {assignee.user.fullName}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">Atama yok</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <TodayWork task={task} />
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge status={task.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

async function YesterdaySection({
  tasksPromise,
  yesterday,
}: {
  tasksPromise: Promise<DashboardTask[]>;
  yesterday: Date;
}) {
  const tasks = await tasksPromise;
  const { end, start } = getDateOnlyRangeInAppTimeZone(yesterday);
  const events = tasks.flatMap((task) =>
    task.timelineEvents.filter(
      (event) => event.createdAt >= start && event.createdAt < end,
    ),
  );
  const notes = events.filter(
    (event) => event.eventType === "NOTE_ADDED" && event.description,
  );
  const files = events.filter((event) => event.eventType === "FILE_ADDED" && event.file);
  const completedCount = tasks.filter((task) => task.status === "COMPLETED").length;
  const unfinishedCount = tasks.filter((task) => task.status !== "COMPLETED").length;
  const tasksWithoutNotes = tasks.filter((task) => {
    const taskNotes = task.timelineEvents.filter(
      (event) =>
        event.eventType === "NOTE_ADDED" &&
        event.description &&
        event.createdAt >= start &&
        event.createdAt < end,
    );

    return taskNotes.length === 0;
  });

  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-navy/10 bg-white shadow-card">
      <div className="flex flex-col gap-1 border-b border-navy/10 bg-slate-50 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-navy">Dun Yapilanlar</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDisplayDateOnly(yesterday)} operasyon ozeti
          </p>
        </div>
        <p className="text-xs font-medium text-muted-foreground">
          {tasks.length} gorev, {completedCount} tamamlandi
        </p>
      </div>

      {tasks.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">
          Dun icin kayitli saha gorevi yok.
        </p>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-[280px_1fr]">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-2">
            <SummaryMetric label="Gorev" value={tasks.length} />
            <SummaryMetric label="Tamamlanan" value={completedCount} />
            <SummaryMetric label="Not" value={notes.length} />
            <SummaryMetric label="Dosya" value={files.length} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {tasks.map((task) => (
              <article
                className="rounded-md border border-navy/10 bg-white p-3"
                key={task.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      className="font-semibold text-primary underline-offset-2 hover:underline"
                      href={`/admin/projects/${task.projectId}`}
                    >
                      {task.project.name}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {task.project.customer.name}
                    </p>
                  </div>
                  <StatusBadge status={task.status} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {task.assignees.length > 0
                    ? task.assignees.map((assignee) => assignee.user.fullName).join(", ")
                    : "Atama yok"}
                </p>
              </article>
            ))}
          </div>
          {unfinishedCount > 0 || tasksWithoutNotes.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 lg:col-span-2">
              {unfinishedCount > 0 ? `${unfinishedCount} gorev tamamlanmamis. ` : ""}
              {tasksWithoutNotes.length > 0
                ? `${tasksWithoutNotes.length} gorevde dun tarihli not bulunmuyor.`
                : ""}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-navy/10 bg-primary/5 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-navy">{value}</p>
    </div>
  );
}

function DashboardTaskCard({ task }: { task: DashboardTask }) {
  return (
    <article className="rounded-md border border-navy/10 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            className="font-semibold text-primary underline-offset-2 hover:underline"
            href={`/admin/projects/${task.projectId}`}
          >
            {task.project.name}
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">
            {task.project.customer.name}
          </p>
        </div>
        <StatusBadge status={task.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {task.assignees.length > 0 ? (
          task.assignees.map((assignee) => (
            <span
              className="rounded-md border border-navy/10 bg-white px-2 py-1 text-xs font-medium text-navy"
              key={assignee.id}
            >
              {assignee.user.fullName}
            </span>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">Atama yok</span>
        )}
      </div>
      <div className="mt-3">
        <TodayWork task={task} />
      </div>
    </article>
  );
}

function TodayWork({ task }: { task: DashboardTask }) {
  const { end, start } = getDateOnlyRangeInAppTimeZone(task.taskDate);
  const events = task.timelineEvents.filter(
    (event) => event.createdAt >= start && event.createdAt < end,
  );
  const notes = events.filter(
    (event) => event.eventType === "NOTE_ADDED" && event.description,
  );
  const files = events.filter((event) => event.eventType === "FILE_ADDED" && event.file);

  if (notes.length === 0 && files.length === 0) {
    return <span className="text-sm text-muted-foreground">Henuz not veya dosya yok</span>;
  }

  return (
    <div className="flex flex-col gap-2">
      {notes.slice(0, 2).map((event) => (
        <div
          className="rounded-md border border-navy/10 bg-slate-50 px-2.5 py-2"
          key={event.id}
        >
          <p className="line-clamp-2 text-xs leading-5 text-navy">{event.description}</p>
          <p className="mt-1 text-[11px] font-medium text-muted-foreground">
            {event.user?.fullName || "Sistem"} &middot; {formatDisplayTime(event.createdAt)}
          </p>
        </div>
      ))}
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {files.slice(0, 6).map((event) =>
            event.file ? <CompactFilePreview file={event.file} key={event.id} /> : null,
          )}
        </div>
      ) : null}
      {notes.length + files.length > 8 ? (
        <p className="text-xs text-muted-foreground">
          +{notes.length + files.length - 8} kayit daha
        </p>
      ) : null}
    </div>
  );
}

function groupTasksByDay(tasks: DashboardTask[], today: Date) {
  const groups = new Map<string, { date: Date; key: string; tasks: DashboardTask[]; title: string }>();

  for (const task of tasks) {
    const dayOffset = Math.max(
      0,
      Math.round((task.taskDate.getTime() - today.getTime()) / 86_400_000),
    );
    const key = task.taskDate.toISOString();
    const existing = groups.get(key);
    const group =
      existing ??
      {
        date: task.taskDate,
        key,
        tasks: [],
        title: dayOffset === 0 ? "Bugun" : `${dayOffset} Gun Sonra`,
      };

    group.tasks.push(task);
    groups.set(key, group);
  }

  return Array.from(groups.values());
}

function addDateOnlyDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);

  return next;
}
