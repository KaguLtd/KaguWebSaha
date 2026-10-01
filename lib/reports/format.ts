import { APP_TIME_ZONE } from "../dates/today";

export function formatReportValue(value: string | number) {
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text) && !Number.isNaN(new Date(text).getTime())) return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: APP_TIME_ZONE }).format(new Date(text));
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.split("-").reverse().join(".");
  return value;
}
