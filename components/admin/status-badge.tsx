import type { DailyTaskStatus } from "@prisma/client";

const statusStyles: Record<DailyTaskStatus, string> = {
  PLANNED: "border-blue-200 bg-blue-50 text-blue-700",
  ON_SITE: "border-amber-200 bg-amber-50 text-amber-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const statusLabels: Record<DailyTaskStatus, string> = {
  PLANNED: "Planlandi",
  ON_SITE: "Sahada",
  COMPLETED: "Tamamlandi",
};

export function StatusBadge({ status }: { status: DailyTaskStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}

