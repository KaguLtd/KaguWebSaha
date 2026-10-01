type Table = { headers?: string[]; rows?: Array<Array<number | string>>; rowLinks?: Array<{ href: string; label: string } | null> };
export type SavedReportSnapshot = Table & { schemaVersion?: number; calculationVersion?: string; generatedAt?: string; totals?: Record<string, number>; definitions?: string[]; warnings?: string[]; filters?: Record<string, string>; filterLabels?: Record<string, string>; details?: Table };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function textRecord(value: unknown) {
  const entries = object(value);
  return entries ? Object.fromEntries(Object.entries(entries).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : undefined;
}
function table(source: Record<string, unknown>): Table {
  const rows = Array.isArray(source.rows) ? source.rows.filter(Array.isArray).map((row: unknown[]) => row.map((cell) => typeof cell === "string" || typeof cell === "number" && Number.isFinite(cell) ? cell : "Bilinmiyor")) : [];
  const rowLinks = Array.isArray(source.rowLinks) ? source.rowLinks.map((item) => { const link = object(item); return link && typeof link.href === "string" && /^\/admin\/(projects|schedule\/tasks|visits)\//.test(link.href) && typeof link.label === "string" ? { href: link.href, label: link.label } : null; }) : undefined;
  return { headers: strings(source.headers), rows, ...(rowLinks ? { rowLinks } : {}) };
}

/** Decode old and V1.1 JSON without ever recalculating or writing the saved report. */
export function parseSavedReportSnapshot(value: unknown): SavedReportSnapshot {
  const source = object(value);
  if (!source) return { headers: [], rows: [], warnings: ["Raporun kayıt biçimi okunamadı. Orijinal rapor kaydı korunmuştur."] };
  const totals = object(source.totals);
  const details = object(source.details);
  return {
    ...table(source),
    ...(typeof source.schemaVersion === "number" ? { schemaVersion: source.schemaVersion } : {}),
    ...(typeof source.calculationVersion === "string" ? { calculationVersion: source.calculationVersion } : {}),
    ...(typeof source.generatedAt === "string" ? { generatedAt: source.generatedAt } : {}),
    ...(totals ? { totals: Object.fromEntries(Object.entries(totals).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))) } : {}),
    definitions: strings(source.definitions), warnings: strings(source.warnings),
    filters: textRecord(source.filters), filterLabels: textRecord(source.filterLabels),
    ...(details ? { details: table(details) } : {}),
  };
}
