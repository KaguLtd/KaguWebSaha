import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { createDailyTaskAction } from "./actions";

import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import {
  addMonths,
  getMonthCalendarDays,
  parseDateOnly,
  toDateInputValue,
} from "@/lib/dates/calendar";
import { formatDisplayDate } from "@/lib/dates/format";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const weekDays = ["Pzt", "Sali", "Cars", "Pers", "Cuma", "Cmt", "Paz"];

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{
    date?: string;
    month?: string;
  }>;
}) {
  const params = await searchParams;
  const today = new Date();
  const selectedDate = parseDateOnly(params?.date) ?? today;
  const monthDate = parseDateOnly(`${params?.month ?? ""}-01`) ?? selectedDate;
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const calendarDays = getMonthCalendarDays(monthDate);
  const previousMonth = toDateInputValue(addMonths(monthDate, -1)).slice(0, 7);
  const nextMonth = toDateInputValue(addMonths(monthDate, 1)).slice(0, 7);

  const [tasks, projects, availablePersonnel] = await Promise.all([
    prisma.dailyTask.findMany({
      where: {
        taskDate: {
          gte: monthStart,
          lte: monthEnd,
        },
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
      },
      orderBy: [{ taskDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.project.findMany({
      where: {
        isActive: true,
      },
      include: {
        customer: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
    prisma.user.findMany({
      where: {
        role: "PERSONNEL",
        isActive: true,
        taskAssignees: {
          none: {
            dailyTask: {
              taskDate: selectedDate,
              status: {
                in: ["PLANNED", "ON_SITE"],
              },
            },
          },
        },
      },
      orderBy: {
        fullName: "asc",
      },
    }),
  ]);

  const tasksByDate = new Map<string, typeof tasks>();

  for (const task of tasks) {
    const key = toDateInputValue(task.taskDate);
    tasksByDate.set(key, [...(tasksByDate.get(key) ?? []), task]);
  }

  return (
    <main className="p-6">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[1fr_420px]">
        <section className="rounded-lg border bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Gunluk Programlama</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Isler saate degil, yalnizca gune atanir.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild size="icon" variant="outline">
                <Link href={`/admin/schedule?month=${previousMonth}`}>
                  <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only">Onceki ay</span>
                </Link>
              </Button>
              <span className="min-w-32 text-center text-sm font-medium">
                {monthDate.toLocaleDateString("tr-TR", {
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <Button asChild size="icon" variant="outline">
                <Link href={`/admin/schedule?month=${nextMonth}`}>
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only">Sonraki ay</span>
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b bg-muted text-center text-xs font-medium uppercase text-muted-foreground">
            {weekDays.map((day) => (
              <div className="px-2 py-3" key={day}>
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {calendarDays.map((date) => {
              const key = toDateInputValue(date);
              const dayTasks = tasksByDate.get(key) ?? [];
              const isCurrentMonth = date.getMonth() === monthDate.getMonth();
              const isSelected = key === toDateInputValue(selectedDate);

              return (
                <Link
                  className={`min-h-32 border-b border-r p-2 transition hover:bg-muted ${
                    isCurrentMonth ? "bg-white" : "bg-slate-50 text-muted-foreground"
                  } ${isSelected ? "ring-2 ring-inset ring-primary" : ""}`}
                  href={`/admin/schedule?month=${toDateInputValue(monthDate).slice(
                    0,
                    7,
                  )}&date=${key}`}
                  key={key}
                >
                  <span className="text-sm font-medium">{date.getDate()}</span>
                  <div className="mt-2 flex flex-col gap-1">
                    {dayTasks.slice(0, 3).map((task) => (
                      <span
                        className="truncate rounded-md bg-muted px-2 py-1 text-xs underline-offset-2 hover:underline"
                        key={task.id}
                      >
                        {task.project.name}
                      </span>
                    ))}
                    {dayTasks.length > 3 ? (
                      <span className="text-xs text-muted-foreground">
                        +{dayTasks.length - 3} is
                      </span>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <aside className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">
            {formatDisplayDate(selectedDate)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Secili gun icin proje ve bos personel ata.
          </p>

          <form
            action={createDailyTaskAction}
            className="mt-6 flex flex-col gap-4"
          >
            <input
              name="taskDate"
              type="hidden"
              value={toDateInputValue(selectedDate)}
            />

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="projectId">
                Proje
              </label>
              <select
                className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
                disabled={projects.length === 0}
                id="projectId"
                name="projectId"
                required
              >
                <option value="">Proje sec</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} - {project.customer.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="managerNote">
                O gune ait yonetici notu
              </label>
              <textarea
                className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
                id="managerNote"
                name="managerNote"
                rows={4}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="files">
                O gune ait dosya
              </label>
              <input
                className="w-full rounded-md border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
                id="files"
                multiple
                name="files"
                type="file"
              />
            </div>

            <fieldset className="flex flex-col gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">
                Bostaki personeller
              </legend>
              {availablePersonnel.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Bu gun icin bos personel yok.
                </p>
              ) : (
                availablePersonnel.map((person) => (
                  <label
                    className="flex items-center gap-3 text-sm"
                    htmlFor={`person-${person.id}`}
                    key={person.id}
                  >
                    <input
                      className="h-4 w-4"
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

            <Button disabled={projects.length === 0} type="submit">
              Kaydet
            </Button>
          </form>

          <section className="mt-8 border-t pt-5">
            <h3 className="font-semibold">Bu gunku isler</h3>
            <div className="mt-3 flex flex-col gap-3">
              {(tasksByDate.get(toDateInputValue(selectedDate)) ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Secili gunde gorev yok.
                </p>
              ) : (
                (tasksByDate.get(toDateInputValue(selectedDate)) ?? []).map(
                  (task) => (
                    <Link
                      className="rounded-md border p-3 transition hover:bg-muted"
                      href={`/admin/schedule/tasks/${task.id}?month=${toDateInputValue(
                        monthDate,
                      ).slice(0, 7)}&date=${toDateInputValue(selectedDate)}`}
                      key={task.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{task.project.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {task.assignees.length > 0
                              ? task.assignees
                                  .map((assignee) => assignee.user.fullName)
                                  .join(", ")
                              : "Atama yok"}
                          </p>
                        </div>
                        <StatusBadge status={task.status} />
                      </div>
                    </Link>
                  ),
                )
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
