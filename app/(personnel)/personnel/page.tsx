import Link from "next/link";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatDisplayDateOnly } from "@/lib/dates/format";
import { getTodayDateOnly } from "@/lib/dates/today";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export default function PersonnelPage() {
  const tasksPromise = getPersonnelTasks();

  return (
    <main className="p-6">
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold">Bugunku Isler</h1>
        <p className="mt-2 text-muted-foreground">
          {formatDisplayDateOnly(getTodayDateOnly())}
        </p>

        <TaskCards tasksPromise={tasksPromise} />
      </div>
    </main>
  );
}

async function getPersonnelTasks() {
  const user = await requireRole("PERSONNEL");

  return prisma.dailyTask.findMany({
    where: {
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
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
}

async function TaskCards({
  tasksPromise,
}: {
  tasksPromise: ReturnType<typeof getPersonnelTasks>;
}) {
  const tasks = await tasksPromise;

  if (tasks.length === 0) {
    return (
      <section className="mt-8 rounded-lg border bg-white p-8 text-center shadow-sm">
        <h2 className="text-lg font-semibold">Bugun atanmis is yok</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Sana atanmis bugunku gorevler burada gorunur.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 flex flex-col gap-4">
      {tasks.map((task) => {
        const completed = task.status === "COMPLETED";

        return (
          <Link
            className={`rounded-lg border bg-white p-5 shadow-sm transition hover:border-primary ${
              completed ? "opacity-55" : ""
            }`}
            href={`/personnel/tasks/${task.id}`}
            key={task.id}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold leading-tight">
                  {task.project.name}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {task.project.customer.name}
                </p>
              </div>
              <StatusBadge status={task.status} />
            </div>
          </Link>
        );
      })}
    </section>
  );
}
