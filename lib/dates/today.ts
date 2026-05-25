export const APP_TIME_ZONE = "Europe/Istanbul";
export const APP_TIME_ZONE_LABEL = "GMT+3";
const APP_TIME_ZONE_OFFSET_MINUTES = 180;

export function getTodayDateOnly() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  return new Date(Date.UTC(year, month - 1, day));
}

export function getDateOnlyRangeInAppTimeZone(date: Date) {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      APP_TIME_ZONE_OFFSET_MINUTES * 60_000,
  );
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);

  return {
    end,
    start,
  };
}
