import type { Prisma } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatDisplayDateOnly } from "@/lib/dates/format";
import { getTodayDateOnly } from "@/lib/dates/today";
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
    },
    orderBy: [{ taskDate: "asc" }, { createdAt: "asc" }],
  });

  return (
    <main className="p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-navy">Yonetici Dashboard</h1>
            <p className="mt-2 text-muted-foreground">
              Bugunun ve gelecek gunlerin planlanmis saha isleri.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Bugun: {formatDisplayDateOnly(getTodayDateOnly())}
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

  if (tasks.length === 0) {
    return (
      <section className="mt-8 rounded-lg border bg-white p-8 text-center shadow-card">
        <h2 className="text-lg font-semibold">Planlanmis is yok</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Bugun veya gelecek tarihler icin henuz saha gorevi olusturulmamis.
          Gecmis isler dashboard'da gosterilmez; proje timeline'inda incelenir.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 overflow-hidden rounded-lg border bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-navy text-xs uppercase text-white/75">
            <tr>
              <th className="px-4 py-3 font-semibold">Tarih</th>
              <th className="px-4 py-3 font-semibold">Proje</th>
              <th className="px-4 py-3 font-semibold">Cari / Firma</th>
              <th className="px-4 py-3 font-semibold">Atanan Personeller</th>
              <th className="px-4 py-3 font-semibold">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {tasks.map((task) => (
              <tr className="transition hover:bg-primary/5" key={task.id}>
                <td className="whitespace-nowrap px-4 py-4 font-medium text-primary">
                  {formatDisplayDateOnly(task.taskDate)}
                </td>
                <td className="px-4 py-4">
                  <div className="font-medium">{task.project.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {task.title}
                  </div>
                </td>
                <td className="px-4 py-4">{task.project.customer.name}</td>
                <td className="px-4 py-4">
                  {task.assignees.length > 0
                    ? task.assignees
                        .map((assignee) => assignee.user.fullName)
                        .join(", ")
                    : "Atama yok"}
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
  );
}
