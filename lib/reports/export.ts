import { formatReportValue } from "./format";

type Table = { headers?: string[]; rows?: Array<Array<number | string>> };
export type ExportSnapshot = Table & { totals?: Record<string, number>; definitions?: string[]; warnings?: string[]; filterLabels?: Record<string, string>; details?: Table };

function csvCell(value: number | string) {
  let text = String(formatReportValue(value));
  if (typeof value === "string" && /^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function snapshotToCsv(snapshot: ExportSnapshot, title: string) {
  const rows: Array<Array<string | number>> = [[title], ...(snapshot.filterLabels ? Object.entries(snapshot.filterLabels) : []), [], snapshot.headers ?? [], ...(snapshot.rows ?? [])];
  if (snapshot.totals) rows.push([], ["Özet"], ...Object.entries(snapshot.totals));
  if (snapshot.details) rows.push([], ["Ayrıntı"], snapshot.details.headers ?? [], ...(snapshot.details.rows ?? []));
  if (snapshot.definitions?.length) rows.push([], ["Hesap tanımları"], ...snapshot.definitions.map((text) => [text]));
  if (snapshot.warnings?.length) rows.push([], ["Eksik veri / uyarılar"], ...snapshot.warnings.map((text) => [text]));
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}
