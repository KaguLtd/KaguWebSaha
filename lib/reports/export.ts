import { APP_TIME_ZONE } from "../dates/today";
import { parseDateOnly } from "../dates/calendar";
import type { ReportMetadata, ReportSection, ReportTrend } from "./model";
import { isReportTemporalLabel } from "./format";

export type ExportTable = { headers?: string[]; rows?: Array<Array<number | string>> };
export type ExportSnapshot = ExportTable & {
  schemaVersion?: number; calculationVersion?: string; generatedAt?: string;
  totals?: Record<string, number>; definitions?: string[]; warnings?: string[];
  filters?: Record<string, string>; filterLabels?: Record<string, string>;
  metadata?: Partial<ReportMetadata>; sections?: ReportSection[]; trend?: ReportTrend[];
  excludedMetrics?: string[];
  details?: ExportTable;
};
export type ReportExportContext = {
  reportId?: string; startDate?: string; endDate?: string; createdAt?: string;
  createdBy?: string; reportType?: string;
};
export type ExportSheet = { title: string; description?: string; headers: string[]; rows: Array<Array<number | string>> };

export function isTemporalExportCell(sheet: ExportSheet, row: Array<number | string>, column: number) {
  // The metadata sheet holds each field's type in its first column.
  return isReportTemporalLabel(sheet.title === "Rapor bilgisi" && column === 1 ? String(row[0]) : sheet.headers[column]);
}

export function exportTimeZone(snapshot: ExportSnapshot) {
  const zone = snapshot.metadata?.timeZone || APP_TIME_ZONE;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(0); return zone; }
  catch { return APP_TIME_ZONE; }
}

/** Only saved snapshot values and explicit record metadata enter an export. No re-query or recalculation. */
export function prepareReportExport(snapshot: ExportSnapshot, title: string, context: ReportExportContext = {}) {
  const metadata = snapshot.metadata;
  const start = context.startDate ?? metadata?.startDate ?? snapshot.filters?.startDate;
  const end = context.endDate ?? metadata?.endDate ?? snapshot.filters?.endDate;
  const info: Array<Array<number | string>> = [
    ["Rapor", title], ["Rapor kimliği", context.reportId ?? metadata?.reportId ?? "Bilinmiyor"],
    ["Rapor tipi", context.reportType ?? metadata?.reportType ?? snapshot.filters?.reportType ?? "Bilinmiyor"],
    ["Başlangıç tarihi", start ?? "Bilinmiyor"], ["Bitiş tarihi", end ?? "Bilinmiyor"],
    ["Oluşturan", context.createdBy ?? metadata?.createdByName ?? "Bilinmiyor"],
    ...(metadata?.createdByUserId ? [["Oluşturan kullanıcı kimliği", metadata.createdByUserId]] : []),
    ["Kayıt zamanı", context.createdAt ?? "Bilinmiyor"],
    ["Üretim zamanı", snapshot.generatedAt ?? "Bilinmiyor"], ["Veri okuma zamanı", metadata?.readAt ?? "Bilinmiyor"],
    ...(context.createdAt ? [["Kayıt zamanı (kaynak ISO)", `ISO ${context.createdAt}`]] : []),
    ...(snapshot.generatedAt ? [["Üretim zamanı (kaynak ISO)", `ISO ${snapshot.generatedAt}`]] : []),
    ...(metadata?.readAt ? [["Veri okuma zamanı (kaynak ISO)", `ISO ${metadata.readAt}`]] : []),
    ["Saat dilimi", exportTimeZone(snapshot)], ["Tarih temeli", metadata?.dateBasis ?? "Kayıtlı raporun tarih aralığı"],
    ["Hesap sürümü", snapshot.calculationVersion ?? "Eski rapor / sürüm kaydedilmemiş"],
    ["Şema sürümü", snapshot.schemaVersion ?? "Eski rapor / sürüm kaydedilmemiş"],
    ["Tarih / saat hücreleri", "ISO saatler belirtilen saat diliminin yerel saatiyle gösterilir. Excel hücresinde saat dilimi saklanmaz."],
    ...Object.entries(snapshot.filterLabels ?? {}).map(([key, value]) => [`Filtre: ${key}`, value]),
    ...Object.entries(snapshot.filters ?? {}).map(([key, value]) => [`Filtre değeri: ${key}`, value]),
  ];
  const sheets: ExportSheet[] = [
    { title: "Rapor bilgisi", headers: ["Alan", "Değer"], rows: info },
    { title: "Özet", headers: snapshot.headers ?? [], rows: snapshot.rows ?? [] },
  ];
  if (snapshot.totals) sheets.push({ title: "Toplamlar", headers: ["Ölçüt", "Değer"], rows: Object.entries(snapshot.totals) });
  if (snapshot.details) sheets.push({ title: "Ayrıntı", headers: snapshot.details.headers ?? [], rows: snapshot.details.rows ?? [] });
  for (const section of snapshot.sections ?? []) sheets.push({ title: section.title, description: [`Bölüm kimliği: ${section.id}`, section.description].filter(Boolean).join(" · "), headers: section.headers, rows: section.rows });
  if (snapshot.trend?.length) {
    const metrics = [{ key: "tasks", label: "Görev" }, { key: "arrived", label: "Varışlı" }, { key: "closed", label: "Tamamlandı" }, { key: "minutes", label: "Ortak süre (dk)" }, { key: "notes", label: "Not" }, { key: "files", label: "Dosya" }, { key: "visits", label: "Ziyaret" }] as const;
    const available = metrics.filter((item) => !snapshot.excludedMetrics?.includes(item.key));
    sheets.push({ title: "Günlük eğilim", headers: ["Tarih", ...available.map((item) => item.label)], rows: snapshot.trend.map((day) => [day.date, ...available.map((item) => day[item.key])]) });
  }
  if (snapshot.definitions?.length) sheets.push({ title: "Hesap tanımları", headers: ["Tanım"], rows: snapshot.definitions.map((text) => [text]) });
  if (snapshot.warnings?.length) sheets.push({ title: "Eksik veri ve uyarılar", headers: ["Uyarı"], rows: snapshot.warnings.map((text) => [text]) });
  return sheets;
}

function csvCell(value: number | string, formatter: Intl.DateTimeFormat, allowDate = false) {
  let text = String(value);
  if (allowDate && typeof value === "string" && parseDateOnly(value)) text = value.split("-").reverse().join(".");
  else if (allowDate && typeof value === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && parseDateOnly(value.slice(0, 10))) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) text = formatter.format(date);
  }
  // Quoting alone does not prevent spreadsheet formula execution.
  if (typeof value === "string" && /^[\s\u0000-\u001f\u007f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function snapshotToCsv(snapshot: ExportSnapshot, title: string, context: ReportExportContext = {}) {
  const formatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "medium", timeZone: exportTimeZone(snapshot) });
  const line = (row: Array<string | number>, sheet?: ExportSheet) => row.map((value, column) => csvCell(value, formatter, Boolean(sheet && isTemporalExportCell(sheet, row, column)))).join(";");
  const rows = [line([title])];
  for (const sheet of prepareReportExport(snapshot, title, context)) {
    rows.push("", line([sheet.title]), ...(sheet.description ? [line([sheet.description])] : []), line(sheet.headers));
    for (const row of sheet.rows) rows.push(line(row, sheet));
  }
  return `\uFEFF${rows.join("\r\n")}`;
}
