import type { Prisma } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import { CompactFilePreview } from "@/components/files/compact-file-preview";
import { formatDisplayDateOnly, formatDisplayTime } from "@/lib/dates/format";
import {
  APP_TIME_ZONE_LABEL,
  getDateOnlyRangeInAppTimeZone,
  getTodayDateOnly,
} from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";

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

export default function AdminPage() {
  const tasksPromise = prisma.dailyTask.findMany({
    where: {
      taskDate: {
        gte: getTodayDateOnly(),
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
      <section className="mt-8 rounded-lg border border-primary/15 bg-white p-8 text-center shadow-card">
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
          <div className="overflow-x-auto">
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
                      <div className="font-semibold leading-5">{task.project.name}</div>
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
