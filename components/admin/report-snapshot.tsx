import Link from "next/link";
import { formatReportValue as formatReportCell } from "@/lib/reports/format";
import type { SavedReportSnapshot } from "@/lib/reports/snapshot";
export { formatReportValue as formatReportCell } from "@/lib/reports/format";

type Table = { headers?: string[]; rows?: Array<Array<number | string>>; rowLinks?: Array<{ href: string; label: string } | null> };
export type DisplaySnapshot = SavedReportSnapshot;

export function ReportSnapshotContent({ snapshot }: { snapshot: DisplaySnapshot }) {
  return <div className="mt-4 space-y-4">
    {snapshot.schemaVersion ? <p className="text-xs text-muted-foreground">Hesaplama: {snapshot.calculationVersion} · {snapshot.generatedAt ? formatReportCell(snapshot.generatedAt) : ""}</p> : <p className="text-xs text-muted-foreground">Eski rapor · kaydedildiği andaki hesaplama korunmuştur.</p>}
    {snapshot.filterLabels ? <p className="text-xs text-muted-foreground">{Object.entries(snapshot.filterLabels).map(([label, value]) => `${label}: ${value}`).join(" · ")}</p> : null}
    {snapshot.warnings?.length ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{snapshot.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
    {snapshot.totals && Object.keys(snapshot.totals).length ? <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(snapshot.totals).map(([label, value]) => <div key={label} className="rounded-md border border-navy/10 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}</dl> : null}
    <ReportTable table={snapshot} />
    {snapshot.details ? <details className="report-details rounded-md border border-navy/10 p-3"><summary className="cursor-pointer text-sm font-semibold">Görev / ziyaret ayrıntıları</summary><div className="mt-3"><ReportTable table={snapshot.details} /></div></details> : null}
    {snapshot.definitions?.length ? <details className="report-definitions rounded-md border border-navy/10 p-3"><summary className="cursor-pointer text-sm font-semibold">Sayıların anlamı ve eksik veri</summary><div className="mt-3 space-y-2 text-sm text-muted-foreground">{snapshot.definitions.map((definition) => <p key={definition}>{definition}</p>)}</div></details> : null}
  </div>;
}

export function ReportTable({ table }: { table: Table }) {
  const headers = table.headers ?? [];
  const rows = table.rows ?? [];
  const linked = Boolean(table.rowLinks?.some(Boolean));
  return <div className="overflow-x-auto rounded-md border border-navy/10"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-slate-50"><tr>{headers.map((header, index) => <th className="px-3 py-2 align-top" key={index}>{header}</th>)}{linked ? <th className="px-3 py-2">Detay</th> : null}</tr></thead><tbody className="divide-y">{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td className="whitespace-normal px-3 py-2 align-top" key={cellIndex}>{formatReportCell(cell)}</td>)}{linked ? <td className="px-3 py-2 align-top">{table.rowLinks?.[index]?.href.startsWith("/admin/") ? <Link className="text-primary underline" href={table.rowLinks[index]!.href}>{table.rowLinks[index]!.label}</Link> : null}</td> : null}</tr>) : <tr><td className="px-3 py-4 text-muted-foreground" colSpan={Math.max(headers.length + (linked ? 1 : 0), 1)}>Bu kriterlerde kayıt yok.</td></tr>}</tbody></table></div>;
}
