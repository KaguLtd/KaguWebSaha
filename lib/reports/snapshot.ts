import type { ReportMetadata, ReportSection, ReportTrend } from "./model";
import { parseDateOnly } from "../dates/calendar";

type Table = { headers?: string[]; rows?: Array<Array<number | string>>; rowLinks?: Array<{ href: string; label: string } | null> };
export type SavedReportSnapshot = Table & { schemaVersion?: number; calculationVersion?: string; generatedAt?: string; totals?: Record<string, number>; definitions?: string[]; warnings?: string[]; filters?: Record<string, string>; filterLabels?: Record<string, string>; details?: Table; metadata?: ReportMetadata; sections?: ReportSection[]; trend?: ReportTrend[]; excludedMetrics?: string[] };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function textRecord(value: unknown) {
  const entries = object(value);
  return entries ? Object.fromEntries(Object.entries(entries).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : undefined;
}
export function isSafeReportLink(href: string) {
  const match = /^\/(?:admin\/(?:projects|schedule\/tasks|visits)|api\/files)\/([A-Za-z0-9_%\-]+)$/.exec(href);
  if (!match) return false;
  try { const id = decodeURIComponent(match[1]); return id.length > 0 && !/[\/\\\u0000-\u001f]/.test(id) && id !== "." && id !== ".."; } catch { return false; }
}
function table(source: Record<string, unknown>): Table {
  const rows: Array<Array<string | number>> = [];
  const originalIndexes: number[] = [];
  if (Array.isArray(source.rows)) source.rows.forEach((row, index) => {
    if (!Array.isArray(row)) return;
    originalIndexes.push(index);
    rows.push(row.map((cell) => typeof cell === "string" || typeof cell === "number" && Number.isFinite(cell) ? cell : "Bilinmiyor"));
  });
  const sourceLinks = source.rowLinks;
  const rowLinks = Array.isArray(sourceLinks) ? originalIndexes.map((index) => { const link = object(sourceLinks[index]); return link && typeof link.href === "string" && isSafeReportLink(link.href) && typeof link.label === "string" ? { href: link.href, label: link.label } : null; }) : undefined;
  return { headers: strings(source.headers), rows, ...(rowLinks ? { rowLinks } : {}) };
}

function hasValidTableShape(value: unknown) {
  const source = object(value);
  if (!source || !Array.isArray(source.headers) || source.headers.some((header) => typeof header !== "string") || !Array.isArray(source.rows)) return false;
  const columns = source.headers.length;
  return source.rows.every((row) => Array.isArray(row) && row.length === columns && row.every((cell) => typeof cell === "string" || typeof cell === "number" && Number.isFinite(cell)));
}

function metadata(value: unknown): ReportMetadata | undefined {
  const source = object(value);
  const required = ["reportType", "startDate", "endDate", "timeZone", "dateBasis", "readAt"] as const;
  if (!source || required.some((key) => typeof source[key] !== "string")) return undefined;
  const result = Object.fromEntries(required.map((key) => [key, source[key]])) as ReportMetadata;
  for (const key of ["reportId", "title", "createdByUserId", "createdByName"] as const) if (typeof source[key] === "string") result[key] = source[key];
  return result;
}

function sections(value: unknown): ReportSection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => { const source = object(item); if (!source || typeof source.id !== "string" || typeof source.title !== "string") return []; const parsed = table(source); return [{ id: source.id, title: source.title, headers: parsed.headers ?? [], rows: parsed.rows ?? [], ...(parsed.rowLinks ? { rowLinks: parsed.rowLinks } : {}), ...(typeof source.description === "string" ? { description: source.description } : {}) }]; });
}

function trend(value: unknown): ReportTrend[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const metrics = ["tasks", "arrived", "closed", "minutes", "notes", "files", "visits"] as const;
  return value.flatMap((item) => { const source = object(item); if (!source || typeof source.date !== "string" || !parseDateOnly(source.date) || metrics.some((key) => typeof source[key] !== "number" || !Number.isFinite(source[key]) || source[key] < 0)) return []; return [{ date: source.date, ...Object.fromEntries(metrics.map((key) => [key, source[key]])) } as ReportTrend]; });
}

/** Decode old and V1.1 JSON without ever recalculating or writing the saved report. */
export function parseSavedReportSnapshot(value: unknown): SavedReportSnapshot {
  const source = object(value);
  if (!source) return { headers: [], rows: [], warnings: ["Raporun kayıt biçimi okunamadı. Orijinal rapor kaydı korunmuştur."] };
  const totals = object(source.totals);
  const details = object(source.details);
  const parsedMetadata = metadata(source.metadata);
  const parsedSections = sections(source.sections);
  const parsedTrend = trend(source.trend);
  const warnings = strings(source.warnings);
  if (!Array.isArray(source.headers) || !Array.isArray(source.rows) || source.rows.some((row) => !Array.isArray(row))) warnings.push("Raporun bazı tablo alanları beklenen kayıt biçiminde değil. Orijinal rapor kaydı korunmuştur; bu alanlar yeniden hesaplanmadı.");
  if (Array.isArray(source.sections) && source.sections.some((item) => !hasValidTableShape(item))) warnings.push("Raporun bazı bölüm tabloları beklenen kayıt biçiminde değil. Okunabilen hücreler gösterildi; orijinal rapor kaydı korunmuştur ve yeniden hesaplanmadı.");
  if (source.metadata !== undefined && !parsedMetadata || source.sections !== undefined && (!parsedSections || !Array.isArray(source.sections) || parsedSections.length !== source.sections.length) || source.trend !== undefined && (!parsedTrend || !Array.isArray(source.trend) || parsedTrend.length !== source.trend.length)) warnings.push("Raporun bazı metadata, bölüm veya eğilim alanları okunamadı. Orijinal rapor kaydı korunmuştur.");
  return {
    ...table(source),
    ...(typeof source.schemaVersion === "number" ? { schemaVersion: source.schemaVersion } : {}),
    ...(typeof source.calculationVersion === "string" ? { calculationVersion: source.calculationVersion } : {}),
    ...(typeof source.generatedAt === "string" ? { generatedAt: source.generatedAt } : {}),
    ...(totals ? { totals: Object.fromEntries(Object.entries(totals).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))) } : {}),
    definitions: strings(source.definitions), warnings,
    filters: textRecord(source.filters), filterLabels: textRecord(source.filterLabels),
    ...(details ? { details: table(details) } : {}),
    ...(parsedMetadata ? { metadata: parsedMetadata } : {}),
    ...(parsedSections ? { sections: parsedSections } : {}),
    ...(parsedTrend ? { trend: parsedTrend } : {}),
    ...(Array.isArray(source.excludedMetrics) ? { excludedMetrics: strings(source.excludedMetrics) } : {}),
  };
}
