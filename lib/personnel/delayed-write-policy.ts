import { getTodayDateOnly } from "@/lib/dates/today";

export const MAX_DELAYED_TASK_AGE_DAYS = 7;
export const DELAYED_TASK_WRITE_ERROR = "Görev günü üzerinden 7 günden fazla geçti. Kayıt cihazda korundu; yönetici kontrolü gerekiyor.";

// taskDate/today are database date-only values, not instants in the device zone.
export function taskAgeDays(taskDate: Date, today = getTodayDateOnly()) {
  if (!Number.isFinite(taskDate.getTime()) || !Number.isFinite(today.getTime())) return null;
  const taskDay = Date.UTC(taskDate.getUTCFullYear(), taskDate.getUTCMonth(), taskDate.getUTCDate());
  const currentDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((currentDay - taskDay) / 86_400_000);
}

export function canWriteTaskDay(taskDate: Date, today = getTodayDateOnly()) {
  const age = taskAgeDays(taskDate, today);
  return age !== null && age >= 0 && age <= MAX_DELAYED_TASK_AGE_DAYS;
}
