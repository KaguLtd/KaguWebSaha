"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatReportValue as formatReportCell } from "@/lib/reports/format";
import { isReportTemporalLabel } from "@/lib/reports/format";
import type { SavedReportSnapshot } from "@/lib/reports/snapshot";
import { isSafeReportLink } from "@/lib/reports/snapshot";
import type { ReportTrend } from "@/lib/reports/model";
export { formatReportValue as formatReportCell } from "@/lib/reports/format";

type Table = { headers?: string[]; rows?: Array<Array<number | string>>; rowLinks?: Array<{ href: string; label: string } | null> };
export type DisplaySnapshot = SavedReportSnapshot;
const inputClass = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
const emptyRows: Array<Array<string | number>> = [];
const emptyHeaders: string[] = [];
const ReportPrintingContext = createContext(false);

export function ReportSnapshotContent({ snapshot }: { snapshot: DisplaySnapshot }) {
  const [selectedSection, setSelectedSection] = useState("");
  const [printing, setPrinting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const originalDetails = new Map<HTMLDetailsElement, boolean>();
    const restore = () => { for (const [item, open] of originalDetails) item.open = open; originalDetails.clear(); };
    const prepare = () => {
      flushSync(() => setPrinting(true));
      contentRef.current?.querySelectorAll<HTMLDetailsElement>("details").forEach((item) => { if (!originalDetails.has(item)) originalDetails.set(item, item.open); item.open = true; });
    };
    const finish = () => { restore(); setPrinting(false); };
    window.addEventListener("beforeprint", prepare); window.addEventListener("afterprint", finish);
    return () => { restore(); window.removeEventListener("beforeprint", prepare); window.removeEventListener("afterprint", finish); };
  }, []);
  const sectionPrefix = useId();
  const sections = snapshot.sections ?? [];
  const activeSection = sections.some((section) => section.id === selectedSection) ? selectedSection : sections[0]?.id;
  const totals = Object.entries(snapshot.totals ?? {});
  const highlights = highlightTotals(snapshot.metadata?.reportType ?? snapshot.filters?.reportType, totals);
  return <ReportPrintingContext.Provider value={printing}><div ref={contentRef} className="report-snapshot mt-4 space-y-5">
    <div className="space-y-2 text-xs text-muted-foreground">
      {snapshot.schemaVersion ? <p>Hesaplama: {snapshot.calculationVersion ?? "Sürüm belirtilmemiş"} · {snapshot.generatedAt ? formatReportCell(snapshot.generatedAt) : ""}</p> : <p>Eski rapor · kaydedildiği andaki hesaplama korunmuştur.</p>}
      {snapshot.metadata ? <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {snapshot.metadata.reportId ? <div><dt className="inline font-medium">Rapor kimliği: </dt><dd className="inline break-all">{snapshot.metadata.reportId}</dd></div> : null}
        <div><dt className="inline font-medium">Dönem: </dt><dd className="inline">{formatReportCell(snapshot.metadata.startDate)} – {formatReportCell(snapshot.metadata.endDate)}</dd></div>
        <div><dt className="inline font-medium">Saat dilimi: </dt><dd className="inline">{snapshot.metadata.timeZone}</dd></div>
        <div><dt className="inline font-medium">Dönem alanı: </dt><dd className="inline">{snapshot.metadata.dateBasis}</dd></div>
        <div><dt className="inline font-medium">Veri okuma zamanı: </dt><dd className="inline">{formatReportCell(snapshot.metadata.readAt)}</dd></div>
        {snapshot.metadata.createdByName ? <div><dt className="inline font-medium">Üreten: </dt><dd className="inline">{snapshot.metadata.createdByName}</dd></div> : null}
      </dl> : null}
      {snapshot.filterLabels ? <p className="break-words">{Object.entries(snapshot.filterLabels).map(([label, value]) => `${label}: ${value}`).join(" · ")}</p> : null}
    </div>
    {snapshot.warnings?.length ? <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Verinin kapsamı ve eksikler</p>{snapshot.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div> : null}
    {snapshot.totals && Object.keys(snapshot.totals).length ? <section aria-label="Rapor toplamları" className="space-y-3">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{highlights.map(([label, value]) => <div key={label} className="rounded-md border border-navy/10 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{new Intl.NumberFormat("tr-TR").format(value)}</dd></div>)}</dl>
      {totals.length > highlights.length ? <details className="report-details rounded-md border border-navy/10 p-3"><summary className="cursor-pointer text-sm font-medium">Tüm ölçüler ({totals.length})</summary><div className="mt-3"><ReportTable table={{ headers: ["Ölçü", "Değer"], rows: totals }} label="Tüm ölçüler" /></div></details> : null}
      <p className="text-xs text-muted-foreground">Görev, atama, kişi/gün ve ekip/gün farklı ölçülerdir. Ortak görev süresi personel satırlarında tekrar görünebilir; satırları toplamak genel toplamı vermeyebilir. Hesap kuralları aşağıda açıklanır.</p>
    </section> : null}
    {snapshot.trend?.length ? <ReportTrendChart trend={snapshot.trend} reportType={snapshot.metadata?.reportType ?? snapshot.filters?.reportType} excludedMetrics={snapshot.excludedMetrics} /> : null}
    {(snapshot.headers?.length || snapshot.rows?.length) ? <section className="report-section" aria-label="Rapor özeti"><h3 className="mb-3 font-semibold">Özet tablosu</h3><ReportTable table={snapshot} label="Özet tablosu" /></section> : null}
    {sections.length ? <section className="space-y-3">
      <div className="report-no-print flex flex-wrap gap-2" role="tablist" aria-label="Rapor ayrıntı bölümleri">{sections.map((section, index) => <button type="button" role="tab" id={`${sectionPrefix}-tab-${section.id}`} aria-controls={`${sectionPrefix}-panel-${section.id}`} aria-selected={activeSection === section.id} tabIndex={activeSection === section.id ? 0 : -1} key={section.id} className={`rounded-md border px-3 py-2 text-sm ${activeSection === section.id ? "border-primary bg-primary/10 font-semibold text-primary" : "border-slate-200"}`} onClick={() => setSelectedSection(section.id)} onKeyDown={(event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % sections.length : event.key === "ArrowLeft" ? (index + sections.length - 1) % sections.length : event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : null;
        if (next === null) return; event.preventDefault(); setSelectedSection(sections[next].id); document.getElementById(`${sectionPrefix}-tab-${sections[next].id}`)?.focus();
      }}>{section.title} <span className="text-xs">({section.rows.length})</span></button>)}</div>
      {sections.map((section) => <section className="report-section space-y-3" data-report-section key={section.id} id={`${sectionPrefix}-panel-${section.id}`} role="tabpanel" aria-labelledby={`${sectionPrefix}-tab-${section.id}`} hidden={!printing && section.id !== activeSection}>
        {(section.id === activeSection || printing) ? <><h3 className="font-semibold">{section.title}</h3>{section.description ? <p className="text-sm text-muted-foreground">{section.description}</p> : null}<ReportTable table={section} label={section.title} /></> : null}
      </section>)}
    </section> : null}
    {snapshot.details ? <details className="report-details report-section rounded-md border border-navy/10 p-3"><summary className="cursor-pointer text-sm font-semibold">Görev / ziyaret ayrıntıları</summary><div className="mt-3"><ReportTable table={snapshot.details} label="Görev / ziyaret ayrıntıları" /></div></details> : null}
    {snapshot.definitions?.length ? <details className="report-definitions report-section rounded-md border border-navy/10 p-3" open><summary className="cursor-pointer text-sm font-semibold">Sayıların anlamı ve eksik veri</summary><div className="mt-3 space-y-2 text-sm text-muted-foreground">{snapshot.definitions.map((definition, index) => <p key={index}>{definition}</p>)}</div></details> : null}
  </div></ReportPrintingContext.Provider>;
}

/** Screen filtering never removes records from the full print table. */
export function ReportTable({ table, label = "Rapor tablosu", printAll = false }: { table: Table; label?: string; printAll?: boolean }) {
  const printing = useContext(ReportPrintingContext) || printAll;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ column: number; direction: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const headers = table.headers ?? emptyHeaders;
  const rows = table.rows ?? emptyRows;
  const columnKinds = useMemo(() => headers.map((header, column) => {
    if (/\bID\b|kimli/i.test(header)) return "id";
    if (isReportTemporalLabel(header)) return rows.some((row) => typeof row[column] === "string" && /^\d{4}-\d{2}-\d{2}T/.test(String(row[column]))) ? "datetime" : "date";
    if (rows.some((row) => typeof row[column] === "number")) return "number";
    if (/durum/i.test(header)) return "status";
    return /not|açıklama|içerik/i.test(header) ? "prose" : "text";
  }), [headers, rows]);
  const linked = Boolean(table.rowLinks?.some((link) => link && isSafeReportLink(link.href)));
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("tr-TR");
    const result = rows.map((row, index) => ({ row, index })).filter(({ row }) => !search || row.some((cell, column) => String(formatReportCell(cell, isReportTemporalLabel(table.headers?.[column]))).toLocaleLowerCase("tr-TR").includes(search)));
    if (sort) result.sort((a, b) => {
      const left = a.row[sort.column] ?? "", right = b.row[sort.column] ?? "";
      const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "tr", { numeric: true });
      return (sort.direction === "asc" ? compared : -compared) || a.index - b.index;
    });
    return result;
  }, [rows, query, sort, table.headers]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function renderRows(items: Array<{ row: Array<string | number>; index: number }>) {
    return items.length ? items.map(({ row, index }) => <tr key={index}>{row.map((cell, cellIndex) => <td className="whitespace-normal break-words px-3 py-2 align-top" data-report-column={columnKinds[cellIndex]} key={cellIndex}>{formatReportCell(cell, isReportTemporalLabel(headers[cellIndex]))}</td>)}{linked ? <td className="px-3 py-2 align-top" data-report-column="source">{table.rowLinks?.[index] && isSafeReportLink(table.rowLinks[index]!.href) ? <Link className="text-primary underline" href={table.rowLinks[index]!.href}>{table.rowLinks[index]!.label}</Link> : null}</td> : null}</tr>) : <tr><td className="px-3 py-4 text-muted-foreground" colSpan={Math.max(headers.length + (linked ? 1 : 0), 1)}>{query ? "Aramanızla eşleşen kayıt yok." : "Bu kriterlerde kayıt yok."}</td></tr>;
  }
  return <div className="space-y-3">
    <div className="report-no-print flex flex-wrap items-center gap-3">
      <label className="flex-1 text-xs">Tabloda ara<input className={`${inputClass} mt-1 w-full`} aria-label={`${label}: tabloda ara`} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Görünen değerlerde ara" /></label>
      <label className="text-xs">Sayfa boyutu<select className={`${inputClass} mt-1 block`} aria-label={`${label}: sayfa boyutu`} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      <p className="text-xs text-muted-foreground" aria-live="polite">{filtered.length} / {rows.length} kayıt</p>
    </div>
    <div className="report-screen-table overflow-x-auto rounded-md border border-navy/10"><table aria-label={label} className="w-full min-w-[620px] text-left text-xs"><thead className="bg-slate-50"><tr>{headers.map((header, index) => <th className="px-3 py-2 align-top" key={index} scope="col" aria-sort={sort?.column === index ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button className="text-left font-semibold" type="button" aria-label={`${header}: sırala`} onClick={() => { setSort({ column: index, direction: sort?.column === index && sort.direction === "asc" ? "desc" : "asc" }); setPage(1); }}>{header}<span aria-hidden="true">{sort?.column === index ? sort.direction === "asc" ? " ↑" : " ↓" : " ↕"}</span></button></th>)}{linked ? <th className="px-3 py-2" scope="col">Kaynak</th> : null}</tr></thead><tbody className="divide-y">{renderRows(visible)}</tbody></table></div>
    <nav className="report-no-print flex flex-wrap items-center justify-between gap-2 text-xs" aria-label={`${label}: sayfalar`}><button className="rounded-md border px-3 py-2 disabled:opacity-40" type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Önceki sayfa</button><span>{currentPage} / {pages} · Baskı ve çıktı tüm rapor kayıtlarını içerir.</span><button className="rounded-md border px-3 py-2 disabled:opacity-40" type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Sonraki sayfa</button></nav>
    {printing ? <div className="report-print-only" style={{ display: "none" }} aria-hidden="true"><table className="w-full text-left text-xs"><caption className="text-left font-semibold">{label} · {rows.length} kayıt</caption><thead><tr>{headers.map((header, index) => <th data-report-column={columnKinds[index]} key={index} scope="col">{header}</th>)}{linked ? <th scope="col" data-report-column="source">Kaynak</th> : null}</tr></thead><tbody>{renderRows(rows.map((row, index) => ({ row, index })))}</tbody></table></div> : null}
  </div>;
}

const trendMetrics = [
  { key: "tasks", label: "Görev" }, { key: "arrived", label: "Varış kayıtlı görev" }, { key: "closed", label: "Tamamlandı durumu" },
  { key: "minutes", label: "Ortak görev süresi (dk)" }, { key: "notes", label: "Not faaliyeti" }, { key: "files", label: "Dosya" }, { key: "visits", label: "Ziyaret" },
] as const;

function highlightTotals(type: string | undefined, entries: Array<[string, number]>) {
  const priority: Record<string, string[]> = {
    VISIT: ["Ziyaret", "Ziyaret edilen şantiye", "16–30 gün", "31+ gün", "Hiç ziyaret yok", "Bağlı ziyaret notu", "Ziyaret eki", "Veri kalitesi bulgusu"],
    MEDIA: ["Dönemde yüklenen dosya", "Dosya (program kapsamı)", "Dosya bayt", "Sunucu medya işi", "Veri kalitesi bulgusu", "Hata bulgusu"],
    QUALITY: ["Veri kalitesi bulgusu", "Hata bulgusu", "Mevcudu/sınıfı bilinmeyen atama", "Süresi eksik başlayan görev", "Fiili beyanı eksik ekip ataması", "Bilgisi eksik ekip/gün", "Değişen ekip/gün", "Ataması olmayan görev"],
    PERSONNEL: ["Atama kaydı", "Hesaplı kişi/gün (atama)", "Ekip/gün (atama)", "Plan katılımı (bilinen)", "Ekip mevcudu/gün (plan)", "Ekip mevcudu/gün (fiili beyan)", "Mevcudu/sınıfı bilinmeyen atama", "Fiili beyanı eksik ekip ataması"],
  };
  const keys = priority[type ?? ""] ?? ["Görev", "Varış kaydı olan", "Ayrılışı kayıtlı görev", "Tamamlandı durumu", "Ölçülmüş ortak görev süresi (dk)", "Dönemdeki kanonik not", "Dönemde yüklenen dosya", "Veri kalitesi bulgusu"];
  const found = keys.flatMap((key) => { const entry = entries.find(([label]) => label === key); return entry ? [entry] : []; });
  return found.length ? found : entries.slice(0, 8);
}

function ReportTrendChart({ trend, reportType, excludedMetrics }: { trend: ReportTrend[]; reportType?: string; excludedMetrics?: string[] }) {
  const availableMetrics = trendMetrics.filter((item) => !excludedMetrics?.includes(item.key));
  const [metric, setMetric] = useState<typeof trendMetrics[number]["key"]>(reportType === "VISIT" ? "visits" : reportType === "MEDIA" ? "files" : "tasks");
  if (!availableMetrics.length) return null;
  const selectedMetric = availableMetrics.find((item) => item.key === metric) ?? availableMetrics[0];
  const metricLabel = selectedMetric.label;
  const maximum = Math.max(1, ...trend.map((day) => day[selectedMetric.key]));
  const points = trend.map((day, index) => ({ x: trend.length === 1 ? 330 : 50 + index * 560 / (trend.length - 1), y: 150 - day[selectedMetric.key] * 120 / maximum, day }));
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  return <section className="report-section space-y-3" aria-label="Günlük dağılım">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Günlük dağılım</h3><label className="report-no-print text-xs">Grafik ölçüsü<select className={`${inputClass} ml-2`} aria-label="Grafik ölçüsü" value={selectedMetric.key} onChange={(event) => setMetric(event.target.value as typeof metric)}>{availableMetrics.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>
    <figure className="rounded-md border border-navy/10 p-3"><figcaption className="mb-2 text-sm">{metricLabel} · {trend.length} gün</figcaption><svg viewBox="0 0 640 180" role="img" aria-label={`${metricLabel} günlük dağılımı; tam değerler aşağıdaki tabloda`} className="w-full text-primary"><line x1="50" y1="150" x2="610" y2="150" stroke="#cbd5e1" /><line x1="50" y1="30" x2="610" y2="30" stroke="#e2e8f0" /><text x="42" y="154" fontSize="11" textAnchor="end" fill="#475569">0</text><text x="42" y="34" fontSize="11" textAnchor="end" fill="#475569">{maximum}</text><path d={path} fill="none" stroke="currentColor" strokeWidth="2" />{points.map(({ x, y, day }) => <circle key={day.date} cx={x} cy={y} r="3" fill="currentColor"><title>{formatReportCell(day.date)}: {day[selectedMetric.key]}</title></circle>)}<text x="50" y="174" fontSize="11" fill="#475569">{formatReportCell(trend[0].date)}</text><text x="610" y="174" textAnchor="end" fontSize="11" fill="#475569">{formatReportCell(trend[trend.length - 1].date)}</text></svg></figure>
    <details className="report-details rounded-md border border-navy/10 p-3"><summary className="cursor-pointer text-sm font-medium">Günlük değerler ve grafik kaynağı</summary><div className="mt-3"><ReportTable label="Günlük değerler" table={{ headers: ["Tarih", ...availableMetrics.map((item) => item.label)], rows: trend.map((day) => [day.date, ...availableMetrics.map((item) => day[item.key])]) }} /></div></details>
  </section>;
}
