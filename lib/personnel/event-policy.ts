import { APP_TIME_ZONE } from "@/lib/dates/today";
import { InputError } from "../offline/input-error";

export function appDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function eventOccurredAt(value: unknown, taskDate: Date, now: Date) {
  const date = value ? new Date(String(value)) : now;
  if (!Number.isFinite(date.getTime()) || date.getTime() > now.getTime() + 60_000 ||
      appDateKey(date) !== taskDate.toISOString().slice(0, 10)) {
    throw new InputError("Saha kaydının tarihi görev günüyle eşleşmiyor.");
  }
  return date;
}

export function canReplayArrival(status: string, isToday: boolean) {
  // A delayed arrival must never reopen a completed/rolled-over task.
  return isToday && status !== "COMPLETED";
}
