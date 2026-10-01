import { MapPinCheck } from "lucide-react";

import { formatDisplayDate } from "@/lib/dates/format";
import { getVisitStatus, getVisitStatusLabel } from "@/lib/visits/status";

export function VisitStatusIcon({ visitedAt, userName }: { visitedAt?: Date | null; userName?: string }) {
  const status = getVisitStatus(visitedAt);
  const label = [getVisitStatusLabel(visitedAt), visitedAt ? formatDisplayDate(visitedAt) : "", userName ?? ""].filter(Boolean).join(" · ");
  const color = status === "OVERDUE" ? "text-red-600" : status === "WARNING" ? "text-orange-500" : status === "NEVER" ? "text-slate-400" : "text-emerald-600";
  return <span aria-label={label} className={`inline-flex shrink-0 ${color}`} role="img" title={label}><MapPinCheck aria-hidden="true" className="h-4 w-4" /></span>;
}
