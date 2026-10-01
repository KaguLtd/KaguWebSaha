import { APP_TIME_ZONE } from "../dates/today";

export type VisitStatus = "CURRENT" | "WARNING" | "OVERDUE" | "NEVER";

function calendarDay(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === name)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}

export function getVisitDayKey(value = new Date()) {
  return new Date(calendarDay(value)).toISOString().slice(0, 10);
}

export function getVisitAgeDays(visitedAt: Date, now = new Date()) {
  return Math.max(0, Math.round((calendarDay(now) - calendarDay(visitedAt)) / 86_400_000));
}

export function getVisitStatus(visitedAt: Date | null | undefined, now = new Date()): VisitStatus {
  if (!visitedAt) return "NEVER";
  const days = getVisitAgeDays(visitedAt, now);
  return days > 30 ? "OVERDUE" : days > 15 ? "WARNING" : "CURRENT";
}

export function getVisitStatusLabel(visitedAt: Date | null | undefined, now = new Date()) {
  if (!visitedAt) return "Henüz ziyaret edilmedi";
  const days = getVisitAgeDays(visitedAt, now);
  return days === 0 ? "Bugün ziyaret edildi" : `${days} gün önce ziyaret edildi`;
}

export type VisitSummaryInput = { projectId: string };

export function summarizeVisits(visits: VisitSummaryInput[]) {
  return { projects: new Set(visits.map((visit) => visit.projectId)).size, visits: visits.length };
}

export function canAttachToVisit(
  role: "ADMIN" | "OBSERVER",
  userId: string,
  visitedByUserId: string,
) {
  return role === "ADMIN" || userId === visitedByUserId;
}
