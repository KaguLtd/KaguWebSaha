"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Search } from "lucide-react";

import {
  createDailyTaskAction,
  removeDailyTaskAction,
  updateDailyTaskAction,
} from "@/app/(admin)/admin/schedule/actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { TeamAssigneeFields } from "@/components/admin/team-assignee-fields";
import type { AssignmentTeamView } from "@/components/admin/team-assignee-fields";

export type ScheduleProject = {
  customerName: string;
  id: string;
  name: string;
};

export type SchedulePerson = {
  fullName: string;
  id: string;
  teamId?: string | null;
  teamNameSnapshot?: string | null;
  headcountSnapshot?: number | null;
};

export type ScheduleTask = {
  assignees: SchedulePerson[];
  id: string;
  managerNote: string;
  projectId: string;
  projectName: string;
  status: "PLANNED" | "ON_SITE" | "COMPLETED";
  taskDate: string;
};

export type ScheduleDay = {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
};

type DrawerState =
  | {
      date: string;
      mode: "create";
    }
  | {
      mode: "edit";
      taskId: string;
    }
  | null;

type ScheduleDrawerCalendarProps = {
  currentUserId: string;
  currentUserRole: "ADMIN" | "OBSERVER" | "PERSONNEL";
  days: ScheduleDay[];
  initialSelectedDate: string;
  personnel: SchedulePerson[];
  teams: AssignmentTeamView[];
  projects: ScheduleProject[];
  tasks: ScheduleTask[];
};

const weekDays = ["Pzt", "Sali", "Cars", "Pers", "Cuma", "Cmt", "Paz"];

export function ScheduleDrawerCalendar({
  currentUserId,
  currentUserRole,
  days,
  initialSelectedDate,
  personnel,
  teams,
  projects,
  tasks,
}: ScheduleDrawerCalendarProps) {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const tasksByDate = useMemo(() => {
    const map = new Map<string, ScheduleTask[]>();

    for (const task of tasks) {
      map.set(task.taskDate, [...(map.get(task.taskDate) ?? []), task]);
    }

    return map;
  }, [tasks]);
  const selectedTask =
    drawer?.mode === "edit"
      ? tasks.find((task) => task.id === drawer.taskId)
      : undefined;
  const selectedDate = drawer?.mode === "create" ? drawer.date : selectedTask?.taskDate;

  async function submit(
    formData: FormData,
    action: (formData: FormData) => Promise<void>,
    successMessage: string,
  ) {
    setIsPending(true);
    setMessage("");

    try {
      if (action === createDailyTaskAction || action === updateDailyTaskAction) {
        if (!formData.has("operation")) {
          formData.set("operation", action === createDailyTaskAction ? "create" : "update");
        }
        await appendCurrentLocation(formData);
        const response = await fetch("/api/admin/daily-tasks", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error || "Gunluk gorev kaydedilemedi.");
        }
      } else {
        await action(formData);
      }
      setDrawer(null);
      setMessage(successMessage);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Görev kaydedilemedi.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      {message ? (
        <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <MobileScheduleList
        days={days}
        hideAssignees={currentUserRole === "OBSERVER"}
        initialSelectedDate={initialSelectedDate}
        onCreate={(date) => setDrawer({ date, mode: "create" })}
        onEdit={(taskId) => setDrawer({ mode: "edit", taskId })}
        tasksByDate={tasksByDate}
      />

      <section className="mt-4 hidden overflow-hidden rounded-lg border bg-white shadow-card md:block">
        <div className="grid grid-cols-7 border-b border-navy/10 bg-white text-center text-xs font-medium uppercase text-slate-950">
          {weekDays.map((day) => (
            <div className="px-2 py-3" key={day}>
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 bg-white text-navy">
          {days.map((day) => {
            const dayTasks = tasksByDate.get(day.date) ?? [];

            return (
              <div
                  className={`h-48 min-w-0 cursor-pointer border-b border-r p-2 transition hover:bg-primary/5 ${
                  day.isCurrentMonth ? "bg-white" : "bg-navy/5 text-muted-foreground"
                }`}
                key={day.date}
                onClick={() => setDrawer({ date: day.date, mode: "create" })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setDrawer({ date: day.date, mode: "create" });
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="block text-sm font-semibold text-navy">
                  {day.dayNumber}
                </span>
                <div className="mt-2 flex h-36 flex-col gap-1 overflow-y-auto overscroll-contain pr-1" onClick={(event) => event.stopPropagation()}>
                  {dayTasks.map((task) => (
                    <button
                      className="min-h-8 shrink-0 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-left text-xs font-medium leading-4 text-navy underline-offset-2 transition hover:border-primary/40 hover:bg-primary/15 hover:underline"
                      key={task.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDrawer({ mode: "edit", taskId: task.id });
                      }}
                      type="button"
                      title={task.projectName}
                    >
                      <span className="line-clamp-2 break-words">{task.projectName}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <Drawer
        description={
          selectedDate
            ? `${formatDateOnly(selectedDate)} icin saha gorevi`
            : undefined
        }
        isOpen={drawer !== null}
        onClose={() => setDrawer(null)}
        title={drawer?.mode === "edit" ? "Gunluk Gorevi Duzenle" : "Gune Gorev Ata"}
      >
        {message ? <p role="status" className="mb-3 text-sm text-primary">{message}</p> : null}
        {drawer?.mode === "create" ? (
          <CreateTaskForm
            key={drawer.date}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            date={drawer.date}
            isPending={isPending}
            onSubmit={(formData) =>
              submit(formData, createDailyTaskAction, "Gunluk gorev kaydedildi.")
            }
            personnel={personnel}
            teams={teams}
            projects={getAvailableProjects(drawer.date, projects, tasks)}
          />
        ) : null}

        {drawer?.mode === "edit" && selectedTask ? (
          <EditTaskForm
            key={selectedTask.id}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            isPending={isPending}
            onSubmit={(formData) =>
              submit(formData, updateDailyTaskAction, "Gunluk gorev guncellendi.")
            }
            onRemove={(formData) =>
              submit(formData, removeDailyTaskAction, "Gunluk gorev gunden kaldirildi.")
            }
            personnel={personnel}
            teams={teams}
            task={selectedTask}
          />
        ) : null}
      </Drawer>
    </>
  );
}

function CreateTaskForm({
  currentUserId,
  currentUserRole,
  date,
  isPending,
  onSubmit,
  personnel,
  teams,
  projects,
}: {
  currentUserId: string;
  currentUserRole: "ADMIN" | "OBSERVER" | "PERSONNEL";
  date: string;
  isPending: boolean;
  onSubmit: (formData: FormData) => void;
  personnel: SchedulePerson[];
  teams: AssignmentTeamView[];
  projects: ScheduleProject[];
}) {
  const isObserver = currentUserRole === "OBSERVER";

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      <input name="taskDate" type="hidden" value={date} />
      <ProjectSelect projects={projects} />
      <TextArea
        label={isObserver ? "Ziyaret notu" : "O gune ait yonetici notu"}
        name={isObserver ? "timelineNote" : "managerNote"}
        rows={4}
      />
      <FileInput label={isObserver ? "Ziyaret dosyasi" : "O gune ait dosya"} />
      {isObserver ? (
        <input name="assigneeIds" type="hidden" value={currentUserId} />
      ) : (
        <TeamAssigneeFields personnel={personnel} teams={teams} taskDate={date} />
      )}
      {projects.length === 0 ? (
        <p className="rounded-md border border-primary/15 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
          Bu gune eklenebilecek aktif proje kalmadi.
        </p>
      ) : null}
      <Button disabled={isPending || projects.length === 0} type="submit">
        {isPending ? "Kaydediliyor..." : "Kaydet"}
      </Button>
    </form>
  );
}

function EditTaskForm({
  currentUserId,
  currentUserRole,
  isPending,
  onRemove,
  onSubmit,
  personnel,
  teams,
  task,
}: {
  currentUserId: string;
  currentUserRole: "ADMIN" | "OBSERVER" | "PERSONNEL";
  isPending: boolean;
  onRemove: (formData: FormData) => void;
  onSubmit: (formData: FormData) => void;
  personnel: SchedulePerson[];
  teams: AssignmentTeamView[];
  task: ScheduleTask;
}) {
  const isObserver = currentUserRole === "OBSERVER";
  const canEditAssignees = task.status === "PLANNED";

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      <input name="taskId" type="hidden" value={task.id} />
      {isObserver ? <input name="assigneeIds" type="hidden" value={currentUserId} /> : null}
      <div className="rounded-md border border-primary/15 bg-primary/5 p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{task.projectName}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDateOnly(task.taskDate)}
            </p>
          </div>
          <StatusBadge status={task.status} />
        </div>
      </div>
      {isObserver ? (
        <div className="rounded-md border border-primary/15 bg-primary/5 p-3 text-sm text-muted-foreground">
          Saha kontrol kullanicisi bu gorevin durumunu veya personel atamalarini
          degistirmez; bu ekrandan yalnizca programa bagli not ve dosya kaydi ekler.
          Bagimsiz ziyaret kaydi icin Ziyaret modulunu kullanir.
        </div>
      ) : (
        <>
          <TextArea
            defaultValue={task.managerNote}
            label="Yonetici notu"
            name="managerNote"
            rows={4}
          />
          <TeamAssigneeFields
            disabled={!canEditAssignees}
            personnel={personnel}
            teams={teams}
            assignments={task.assignees}
            taskDate={task.taskDate}
          />
        </>
      )}
      <TextArea
        label={isObserver ? "Ziyaret / kontrol notu" : "Timeline'a yeni not ekle"}
        name="timelineNote"
        rows={3}
      />
      <FileInput label={isObserver ? "Not / dosya ekle" : "Dosya ekle"} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-3">
          <Button disabled={isPending} type="submit">
            {isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </div>
        {!isObserver && task.status === "PLANNED" ? (
          <Button
            disabled={isPending}
            onClick={() => {
              if (!window.confirm("Bu gorevi gunden kaldirmak istiyor musunuz?")) {
                return;
              }

              const formData = new FormData();
              formData.set("taskId", task.id);
              onRemove(formData);
            }}
            type="button"
            variant="outline"
          >
            Bu gorevi gunden kaldir
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function appendCurrentLocation(formData: FormData) {
  if (!("geolocation" in navigator)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        formData.set("latitude", String(position.coords.latitude));
        formData.set("longitude", String(position.coords.longitude));
        resolve();
      },
      () => resolve(),
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 8000,
      },
    );
  });
}

function ProjectSelect({ projects }: { projects: ScheduleProject[] }) {
  const [query, setQuery] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");
  const customers = useMemo(
    () => Array.from(new Set(projects.map((project) => project.customerName))).sort(),
    [projects],
  );
  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return projects.filter((project) => {
      const matchesCustomer = !customerFilter || project.customerName === customerFilter;
      const matchesQuery =
        !normalizedQuery ||
        project.name.toLowerCase().includes(normalizedQuery) ||
        project.customerName.toLowerCase().includes(normalizedQuery);

      return matchesCustomer && matchesQuery;
    });
  }, [customerFilter, projects, query]);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-navy" htmlFor="projectId">
        Proje
      </label>
      <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
          />
          <input
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-navy shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Proje veya cari ara"
            type="search"
            value={query}
          />
        </div>
        <select
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
          onChange={(event) => setCustomerFilter(event.target.value)}
          value={customerFilter}
        >
          <option value="">Tum cariler</option>
          {customers.map((customerName) => (
            <option key={customerName} value={customerName}>
              {customerName}
            </option>
          ))}
        </select>
      </div>
      <input name="projectId" type="hidden" value={selectedProjectId} />
      {selectedProject ? (
        <p className="rounded-md bg-primary/10 px-3 py-2 text-xs text-navy">
          <span className="font-semibold">Secili:</span> {selectedProject.name} · {selectedProject.customerName}
        </p>
      ) : null}
      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span>{filteredProjects.length} proje bulundu</span>
        {filteredProjects.length > 0 ? (
          <span>Listeyi kaydirarak tumunu gorebilirsiniz</span>
        ) : null}
      </div>
      <div className="h-64 divide-y divide-navy/10 overflow-y-auto overscroll-contain rounded-md border border-navy/10 bg-white">
        {filteredProjects.map((project) => {
          const isSelected = selectedProjectId === project.id;
          return (
            <button
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition ${
                isSelected
                  ? "bg-primary/10"
                  : "bg-white hover:bg-primary/5"
              }`}
              key={project.id}
              onClick={() => setSelectedProjectId(project.id)}
              type="button"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-navy">{project.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{project.customerName}</span>
              </span>
              {isSelected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
            </button>
          );
        })}
      </div>
      {!selectedProjectId && filteredProjects.length > 0 ? (
        <p className="text-xs text-muted-foreground">Eklemek istediginiz projeye dokunun.</p>
      ) : null}
      {projects.length > 0 && filteredProjects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Bu arama ve cari filtresiyle eslesen proje yok.
        </p>
      ) : null}
    </div>
  );
}

function AssigneeFields({
  disabled,
  personnel,
  selectedIds,
}: {
  disabled?: boolean;
  personnel: SchedulePerson[];
  selectedIds: Set<string>;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-3 text-navy shadow-sm">
      <legend className="px-1 text-sm font-medium text-navy">Personel</legend>
      {disabled ? (
        <p className="text-sm text-muted-foreground">
          Gorev sahada veya tamamlanmis oldugu icin personel degistirilemez.
        </p>
      ) : null}
      {personnel.length === 0 ? (
        <p className="text-sm text-muted-foreground">Uygun personel yok.</p>
      ) : (
        personnel.map((person) => (
          <label className="flex items-center gap-3 text-sm" key={person.id}>
            <input
              className="h-4 w-4"
              defaultChecked={selectedIds.has(person.id)}
              disabled={disabled}
              name="assigneeIds"
              type="checkbox"
              value={person.id}
            />
            {person.fullName}
          </label>
        ))
      )}
    </fieldset>
  );
}

function FileInput({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-navy" htmlFor="files">
        {label}
      </label>
      <input
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm file:mr-3 file:rounded-md file:border file:border-primary/20 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
        id="files"
        multiple
        name="files"
        type="file"
      />
    </div>
  );
}

function TextArea({
  defaultValue,
  label,
  name,
  rows,
}: {
  defaultValue?: string;
  label: string;
  name: string;
  rows: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-navy" htmlFor={name}>
        {label}
      </label>
      <textarea
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
        defaultValue={defaultValue}
        id={name}
        name={name}
        rows={rows}
      />
    </div>
  );
}

function getAvailableProjects(
  date: string,
  projects: ScheduleProject[],
  tasks: ScheduleTask[],
) {
  const usedProjectIds = new Set(
    tasks.filter((task) => task.taskDate === date).map((task) => task.projectId),
  );

  return projects.filter((project) => !usedProjectIds.has(project.id));
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-");

  return `${day}/${month}/${year}`;
}

function MobileScheduleList({
  days,
  hideAssignees,
  initialSelectedDate,
  onCreate,
  onEdit,
  tasksByDate,
}: {
  days: ScheduleDay[];
  hideAssignees: boolean;
  initialSelectedDate: string;
  onCreate: (date: string) => void;
  onEdit: (taskId: string) => void;
  tasksByDate: Map<string, ScheduleTask[]>;
}) {
  const [weekIndex, setWeekIndex] = useState(() => {
    const todayIndex = days.findIndex((day) => day.date === initialSelectedDate);
    const firstMonthIndex = days.findIndex((day) => day.isCurrentMonth);
    return Math.floor((todayIndex >= 0 ? todayIndex : Math.max(firstMonthIndex, 0)) / 7);
  });
  const week = days.slice(weekIndex * 7, weekIndex * 7 + 7);
  const [selectedDate, setSelectedDate] = useState(() => {
    const currentWeek = days.slice(weekIndex * 7, weekIndex * 7 + 7);
    return currentWeek.some((day) => day.date === initialSelectedDate)
      ? initialSelectedDate
      : currentWeek.find((day) => day.isCurrentMonth)?.date ?? currentWeek[0]?.date ?? "";
  });
  const selectedDay = days.find((day) => day.date === selectedDate) ?? week[0];
  const selectedTasks = selectedDay ? tasksByDate.get(selectedDay.date) ?? [] : [];

  function changeWeek(nextIndex: number) {
    const bounded = Math.max(0, Math.min(Math.ceil(days.length / 7) - 1, nextIndex));
    const nextWeek = days.slice(bounded * 7, bounded * 7 + 7);
    setWeekIndex(bounded);
    setSelectedDate(nextWeek.find((day) => day.isCurrentMonth)?.date ?? nextWeek[0]?.date ?? "");
  }

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-navy/10 bg-white shadow-card md:hidden">
      <div className="flex items-center justify-between border-b border-navy/10 bg-primary/5 p-2">
        <Button disabled={weekIndex === 0} onClick={() => changeWeek(weekIndex - 1)} size="icon" type="button" variant="outline">
          <ChevronLeft className="h-4 w-4" /><span className="sr-only">Onceki hafta</span>
        </Button>
        <p className="text-sm font-semibold text-navy">Haftalik Program</p>
        <Button disabled={(weekIndex + 1) * 7 >= days.length} onClick={() => changeWeek(weekIndex + 1)} size="icon" type="button" variant="outline">
          <ChevronRight className="h-4 w-4" /><span className="sr-only">Sonraki hafta</span>
        </Button>
      </div>
      <div className="grid grid-cols-7 border-b border-navy/10">
        {week.map((day, index) => {
          const count = (tasksByDate.get(day.date) ?? []).length;
          const isSelected = day.date === selectedDate;
          return (
            <button
              className={`min-w-0 border-r px-1 py-2 text-center transition last:border-r-0 ${isSelected ? "bg-orange-100 text-orange-950 ring-2 ring-inset ring-orange-300" : day.isCurrentMonth ? "bg-white text-navy" : "bg-slate-50 text-muted-foreground"}`}
              key={day.date}
              onClick={() => setSelectedDate(day.date)}
              type="button"
            >
              <span className="block text-[10px] font-medium uppercase">{weekDays[index]}</span>
              <span className="mt-1 block text-base font-semibold">{day.dayNumber}</span>
              <span className={`mx-auto mt-1 block h-1.5 w-1.5 rounded-full ${count ? (isSelected ? "bg-orange-600" : "bg-primary") : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
      {selectedDay ? (
        <div className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-sm font-semibold">{formatDateOnly(selectedDay.date)}</p><p className="text-xs text-muted-foreground">{selectedTasks.length} gorev</p></div>
            <Button onClick={() => onCreate(selectedDay.date)} size="sm" type="button">Gorev ekle</Button>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {selectedTasks.length ? selectedTasks.map((task) => (
              <button className="rounded-md border border-primary/20 bg-primary/10 px-3 py-3 text-left text-sm font-medium" key={task.id} onClick={() => onEdit(task.id)} type="button">
                <span className="block">{task.projectName}</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">{hideAssignees ? "Atama bilgisi gizli" : task.assignees.length ? task.assignees.map((assignee) => assignee.fullName).join(", ") : "Atama yok"}</span>
              </button>
            )) : <p className="rounded-md border border-dashed border-navy/15 p-4 text-center text-sm text-muted-foreground">Bu gun icin gorev yok.</p>}
          </div>
        </div>
      ) : null}
    </section>
  );
}
