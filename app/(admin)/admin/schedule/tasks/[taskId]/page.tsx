import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { toDateInputValue } from "@/lib/dates/calendar";
import { formatDisplayDateOnly } from "@/lib/dates/format";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function ScheduleTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{
    taskId: string;
  }>;
  searchParams?: Promise<{
    date?: string;
    month?: string;
  }>;
}) {
  const { taskId } = await params;
  const query = await searchParams;
  const task = await prisma.dailyTask.findUnique({
    where: {
      id: taskId,
    },
    include: {
      project: {
        include: {
          customer: true,
        },
      },
      assignees: {
        include: {
          user: true,
        },
      },
      files: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!task) {
    notFound();
  }

  const selectedAssigneeIds = new Set(
    task.assignees.map((assignee) => assignee.userId),
  );

  const personnel = await prisma.user.findMany({
    where: {
      role: "PERSONNEL",
      isActive: true,
      OR: [
        {
          id: {
            in: Array.from(selectedAssigneeIds),
          },
        },
        {
          taskAssignees: {
            none: {
              dailyTask: {
                id: {
                  not: task.id,
                },
                taskDate: task.taskDate,
                status: {
                  in: ["PLANNED", "ON_SITE"],
                },
              },
            },
          },
        },
      ],
    },
    orderBy: {
      fullName: "asc",
    },
  });

  const canEditAssignees = task.status === "PLANNED";

  const backHref = `/admin/schedule?${new URLSearchParams({
    ...(query?.month ? { month: query.month } : {}),
    date: query?.date ?? toDateInputValue(task.taskDate),
  }).toString()}`;

  return (
    <main className="p-6 text-navy">
      <div className="mx-auto max-w-3xl">
        <Link
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
          href={backHref}
        >
          Takvime don
        </Link>

        <section className="mt-4 rounded-lg border border-primary/15 bg-white p-5 shadow-card">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{task.project.name}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {task.project.customer.name} · {formatDisplayDateOnly(task.taskDate)}
              </p>
            </div>
            <StatusBadge status={task.status} />
          </div>

          <form
            action="/api/admin/daily-tasks"
            className="mt-6 flex flex-col gap-5"
            method="post"
          >
            <input name="operation" type="hidden" value="update" />
            <input name="taskId" type="hidden" value={task.id} />
            <input name="redirectTo" type="hidden" value={backHref} />

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="managerNote">
                Yonetici notu
              </label>
              <textarea
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy outline-none transition focus:ring-2 focus:ring-primary"
                defaultValue={task.managerNote ?? ""}
                id="managerNote"
                name="managerNote"
                rows={4}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="timelineNote">
                Timeline'a yeni not ekle
              </label>
              <textarea
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy outline-none transition focus:ring-2 focus:ring-primary"
                id="timelineNote"
                name="timelineNote"
                rows={3}
              />
            </div>

            <fieldset className="flex flex-col gap-3 rounded-md border border-navy/10 bg-primary/5 p-3">
              <legend className="px-1 text-sm font-medium">
                Atanan personeller
              </legend>
              {!canEditAssignees ? (
                <p className="text-sm text-muted-foreground">
                  Gorev sahada veya tamamlanmis oldugu icin personel degistirilemez.
                </p>
              ) : null}
              {personnel.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Uygun personel yok.
                </p>
              ) : (
                personnel.map((person) => (
                  <label
                    className="flex items-center gap-3 text-sm"
                    htmlFor={`person-${person.id}`}
                    key={person.id}
                  >
                    <input
                      className="h-4 w-4"
                      defaultChecked={selectedAssigneeIds.has(person.id)}
                      disabled={!canEditAssignees}
                      id={`person-${person.id}`}
                      name="assigneeIds"
                      type="checkbox"
                      value={person.id}
                    />
                    {person.fullName}
                  </label>
                ))
              )}
            </fieldset>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="files">
                Dosya ekle
              </label>
              <input
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy file:mr-3 file:rounded-md file:border file:border-primary/20 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
                id="files"
                multiple
                name="files"
                type="file"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <PendingSubmitButton>Kaydet</PendingSubmitButton>
              <Button asChild type="button" variant="outline">
                <Link href={`/admin/projects/${task.projectId}`}>
                  Proje timeline'ini ac
                </Link>
              </Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
