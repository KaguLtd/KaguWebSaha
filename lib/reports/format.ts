import { APP_TIME_ZONE } from "../dates/today";
import { parseDateOnly } from "../dates/calendar";
const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: APP_TIME_ZONE });

/** ISO-looking IDs, names and note contents must stay literal text. */
export function isReportTemporalLabel(label: string | undefined) {
  const field = label?.replace(/^Filtre değeri:\s*/i, "").trim().toLocaleLowerCase("tr-TR") ?? "";
  return /^(?:tarih|gün|zaman|saat|program günü|kayıt zamanı|kayıt tarihi|olay zamanı|olay tarihi|ziyaret zamanı|ziyaret tarihi|yükleme zamanı|yükleme tarihi|varış|ayrılış|proje oluşturma|son ziyaret|oluşturma|oluşturma tarihi|son güncelleme|başlangıç tarihi|bitiş tarihi|veri okuma zamanı|üretim zamanı|date|time|datetime|visitedat|createdat|updatedat|startdate|enddate)$/.test(field);
}

export function formatReportValue(value: string | number, allowDate = true) {
  if (!allowDate || typeof value === "number") return value;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) && parseDateOnly(text.slice(0, 10)) && !Number.isNaN(new Date(text).getTime())) return dateTimeFormatter.format(new Date(text));
  if (parseDateOnly(text)) return text.split("-").reverse().join(".");
  return value;
}
