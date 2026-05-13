"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createDailyTaskAction,
  updateDailyTaskAction,
} from "@/app/(admin)/admin/schedule/actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";

export type ScheduleProject = {
  customerName: string;
  id: string;
  name: string;
};

export type SchedulePerson = {
  fullName: string;
  id: string;
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
  days: ScheduleDay[];
  personnel: SchedulePerson[];
  projects: ScheduleProject[];
  tasks: ScheduleTask[];
};

const weekDays = ["Pzt", "Sali", "Cars", "Pers", "Cuma", "Cmt", "Paz"];

export function ScheduleDrawerCalendar({
  days,
  personnel,
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
      await action(formData);
      setDrawer(null);
      setMessage(successMessage);
      router.refresh();
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

      <section className="mt-4 overflow-hidden rounded-lg border bg-white shadow-card">
        <div className="grid grid-cols-7 border-b bg-navy text-center text-xs font-medium uppercase text-white/75">
          {weekDays.map((day) => (
            <div className="px-2 py-3" key={day}>
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const dayTasks = tasksByDate.get(day.date) ?? [];

            return (
              <div
                className={`min-h-32 cursor-pointer border-b border-r p-2 transition hover:bg-primary/5 ${
                  day.isCurrentMonth ? "bg-white" : "bg-slate-50 text-muted-foreground"
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
                <span className="text-sm font-semibold text-navy">{day.dayNumber}</span>
                <div className="mt-2 flex flex-col gap-1">
                  {dayTasks.slice(0, 4).map((task) => (
                    <button
                      className="truncate rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-left text-xs font-medium text-navy underline-offset-2 transition hover:border-primary/40 hover:bg-primary/15 hover:underline"
                      key={task.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDrawer({ mode: "edit", taskId: task.id });
                      }}
                      type="button"
                    >
                      {task.projectName}
                    </button>
                  ))}
                  {dayTasks.length > 4 ? (
                    <span className="text-xs text-muted-foreground">
                      +{dayTasks.length - 4} is
                    </span>
                  ) : null}
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
        {drawer?.mode === "create" ? (
          <CreateTaskForm
            date={drawer.date}
            isPending={isPending}
            onSubmit={(formData) =>
              submit(formData, createDailyTaskAction, "Gunluk gorev kaydedildi.")
            }
            personnel={getAvailablePersonnel(drawer.date, personnel, tasks)}
            projects={projects}
          />
        ) : null}

        {drawer?.mode === "edit" && selectedTask ? (
          <EditTaskForm
            isPending={isPending}
            onSubmit={(formData) =>
              submit(formData, updateDailyTaskAction, "Gunluk gorev guncellendi.")
            }
            personnel={personnel}
            task={selectedTask}
          />
        ) : null}
      </Drawer>
    </>
  );
}

function CreateTaskForm({
  date,
  isPending,
  onSubmit,
  personnel,
  projects,
}: {
  date: string;
  isPending: boolean;
  onSubmit: (formData: FormData) => void;
  personnel: SchedulePerson[];
  projects: ScheduleProject[];
}) {
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
      <TextArea label="O gune ait yonetici notu" name="managerNote" rows={4} />
      <FileInput label="O gune ait dosya" />
      <AssigneeFields personnel={personnel} selectedIds={new Set()} />
      <Button disabled={isPending || projects.length === 0} type="submit">
        {isPending ? "Kaydediliyor..." : "Kaydet"}
      </Button>
    </form>
  );
}

function EditTaskForm({
  isPending,
  onSubmit,
  personnel,
  task,
}: {
  isPending: boolean;
  onSubmit: (formData: FormData) => void;
  personnel: SchedulePerson[];
  task: ScheduleTask;
}) {
  const canEditAssignees = task.status === "PLANNED";
  const selectedIds = new Set(task.assignees.map((assignee) => assignee.id));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      <input name="taskId" type="hidden" value={task.id} />
      <div className="rounded-md border bg-muted/80 p-3 shadow-sm">
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
      <TextArea
        defaultValue={task.managerNote}
        label="Yonetici notu"
        name="managerNote"
        rows={4}
      />
      <TextArea label="Timeline'a yeni not ekle" name="timelineNote" rows={3} />
      <FileInput label="Dosya ekle" />
      <AssigneeFields
        disabled={!canEditAssignees}
        personnel={personnel}
        selectedIds={selectedIds}
      />
      <Button disabled={isPending} type="submit">
        {isPending ? "Kaydediliyor..." : "Kaydet"}
      </Button>
    </form>
  );
}

function ProjectSelect({ projects }: { projects: ScheduleProject[] }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="projectId">
        Proje
      </label>
      <select
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
        disabled={projects.length === 0}
        id="projectId"
        name="projectId"
        required
      >
        <option value="">Proje sec</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name} - {project.customerName}
          </option>
        ))}
      </select>
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
    <fieldset className="flex flex-col gap-3 rounded-md border bg-white p-3 shadow-sm">
      <legend className="px-1 text-sm font-medium">Personel</legend>
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
      <label className="text-sm font-medium" htmlFor="files">
        {label}
      </label>
      <input
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm file:mr-3 file:rounded-md file:border file:border-primary/20 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
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
      <label className="text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <textarea
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
        defaultValue={defaultValue}
        id={name}
        name={name}
        rows={rows}
      />
    </div>
  );
}

function getAvailablePersonnel(
  date: string,
  personnel: SchedulePerson[],
  tasks: ScheduleTask[],
) {
  const busyIds = new Set(
    tasks
      .filter(
        (task) =>
          task.taskDate === date &&
          (task.status === "PLANNED" || task.status === "ON_SITE"),
      )
      .flatMap((task) => task.assignees.map((assignee) => assignee.id)),
  );

  return personnel.filter((person) => !busyIds.has(person.id));
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-");

  return `${day}/${month}/${year}`;
}
