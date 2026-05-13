import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { ScheduleDrawerCalendar } from "@/components/admin/schedule-drawer-calendar";
import { Button } from "@/components/ui/button";
import {
  addMonths,
  getMonthCalendarDays,
  parseDateOnly,
  toDateInputValue,
} from "@/lib/dates/calendar";
import { getTodayDateOnly } from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{
    date?: string;
    month?: string;
  }>;
}) {
  const params = await searchParams;
  const today = getTodayDateOnly();
  const selectedDate = parseDateOnly(params?.date) ?? today;
  const monthDate = parseDateOnly(`${params?.month ?? ""}-01`) ?? selectedDate;
  const calendarDays = getMonthCalendarDays(monthDate);
  const monthStart = calendarDays[0];
  const monthEnd = calendarDays[calendarDays.length - 1];
  const previousMonth = toDateInputValue(addMonths(monthDate, -1)).slice(0, 7);
  const nextMonth = toDateInputValue(addMonths(monthDate, 1)).slice(0, 7);

  const [tasks, projects, personnel] = await Promise.all([
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
      },
      orderBy: {
        fullName: "asc",
      },
    }),
  ]);

  return (
    <main className="p-6 text-navy">
      <div className="mx-auto max-w-7xl">
        <section className="rounded-lg border border-primary/15 bg-white shadow-card">
          <div className="flex flex-col gap-4 border-b border-primary/15 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-navy">Gunluk Programlama</h1>
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
              <span className="min-w-32 text-center text-sm font-semibold text-primary">
                {monthDate.toLocaleDateString("tr-TR", {
                  month: "long",
                  timeZone: "UTC",
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
        </section>

        <ScheduleDrawerCalendar
          days={calendarDays.map((date) => ({
            date: toDateInputValue(date),
            dayNumber: date.getUTCDate(),
            isCurrentMonth: date.getUTCMonth() === monthDate.getUTCMonth(),
          }))}
          personnel={personnel.map((person) => ({
            fullName: person.fullName,
            id: person.id,
          }))}
          projects={projects.map((project) => ({
            customerName: project.customer.name,
            id: project.id,
            name: project.name,
          }))}
          tasks={tasks.map((task) => ({
            assignees: task.assignees.map((assignee) => ({
              fullName: assignee.user.fullName,
              id: assignee.userId,
            })),
            id: task.id,
            managerNote: task.managerNote ?? "",
            projectId: task.projectId,
            projectName: task.project.name,
            status: task.status,
            taskDate: toDateInputValue(task.taskDate),
          }))}
        />
      </div>
    </main>
  );
}
