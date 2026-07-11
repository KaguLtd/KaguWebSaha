"use client";

import { BarChart3, BriefcaseBusiness, Building2, MapPinCheck, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";

type Project = { customerName: string; id: string; name: string };
type Snapshot = { headers?: string[]; rows?: Array<Array<number | string>>; totals?: Record<string, number> };
type SavedReport = { createdAt: string; createdBy: string; endDate: string; id: string; projectName: string | null; reportType: string; snapshot: Snapshot; startDate: string; title: string };
const reportTypes = [
  { icon: BriefcaseBusiness, label: "Proje", value: "PROJECT" },
  { icon: Users, label: "Personel", value: "PERSONNEL" },
  { icon: Building2, label: "Cari", value: "CUSTOMER" },
  { icon: MapPinCheck, label: "Ziyaret", value: "VISIT" },
] as const;

export function ReportsDashboard({ projects, reports, today, weekStart }: { projects: Project[]; reports: SavedReport[]; today: string; weekStart: string }) {
  const [reportType, setReportType] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const filteredProjects = useMemo(() => { const q = query.trim().toLocaleLowerCase("tr-TR"); return projects.filter((project) => !q || `${project.name} ${project.customerName}`.toLocaleLowerCase("tr-TR").includes(q)); }, [projects, query]);
  return <>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {reportTypes.map(({ icon: Icon, label, value }) => <button className="flex items-center gap-3 rounded-lg border border-primary/15 bg-white p-5 text-left shadow-card transition hover:border-primary hover:bg-primary/5" key={value} onClick={() => { setReportType(value); setError(""); }} type="button"><span className="rounded-md bg-primary/10 p-3 text-primary"><Icon className="h-5 w-5" /></span><span><span className="block font-semibold text-navy">{label} Raporu</span><span className="mt-1 block text-xs text-muted-foreground">Rapor olustur</span></span></button>)}
    </section>
    <section className="mt-6 overflow-hidden rounded-lg border border-navy/10 bg-white shadow-card">
      <div className="flex items-center gap-3 border-b border-navy/10 bg-primary/5 p-4"><BarChart3 className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Daha Once Olusturulan Raporlar</h2><p className="text-xs text-muted-foreground">Kaydedilen raporlar olusturuldugu andaki veriyi korur.</p></div></div>
      {reports.length ? <div className="divide-y divide-navy/10">{reports.map((report) => <details className="group p-4" key={report.id}><summary className="cursor-pointer list-none"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-navy">{report.title}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(report.startDate)} - {formatDate(report.endDate)} · {report.createdBy} · {formatDateTime(report.createdAt)}</p></div><span className="rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-xs font-medium text-primary">Incele</span></div></summary><SnapshotTable snapshot={report.snapshot} /></details>)}</div> : <p className="p-8 text-center text-sm text-muted-foreground">Henuz kaydedilmis rapor yok.</p>}
    </section>
    <Drawer description="Tarih araligini ve istege bagli projeyi secin. Sonuc kaydedilip ana listede saklanir." isOpen={Boolean(reportType)} onClose={() => setReportType(null)} title={`${reportTypes.find((item) => item.value === reportType)?.label ?? ""} Raporu Olustur`}>
      <form className="flex flex-col gap-4" onSubmit={async (event) => { event.preventDefault(); setPending(true); setError(""); try { const response = await fetch("/api/admin/reports", { body: new FormData(event.currentTarget), method: "POST" }); const payload = (await response.json().catch(() => ({}))) as { error?: string }; if (!response.ok) throw new Error(payload.error || "Rapor kaydedilemedi."); setReportType(null); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Rapor kaydedilemedi."); } finally { setPending(false); } }}>
        <input name="reportType" type="hidden" value={reportType ?? ""} />
        <div className="grid grid-cols-2 gap-3"><DateField defaultValue={weekStart} label="Baslangic" name="startDate" /><DateField defaultValue={today} label="Bitis" name="endDate" /></div>
        <label className="flex flex-col gap-2 text-sm font-medium">Proje <span className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm" onChange={(event) => setQuery(event.target.value)} placeholder="Proje veya cari ara" type="search" value={query} /></span></label>
        <select className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" name="projectId" onChange={(event) => setProjectId(event.target.value)} value={projectId}><option value="">Tum projeler</option>{filteredProjects.map((project) => <option key={project.id} value={project.id}>{project.name} - {project.customerName}</option>)}</select>
        {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}<Button disabled={pending} type="submit">{pending ? "Olusturuluyor..." : "Raporu Kaydet"}</Button>
      </form>
    </Drawer>
  </>;
}

function DateField({ defaultValue, label, name }: { defaultValue: string; label: string; name: string }) { return <label className="flex flex-col gap-2 text-sm font-medium">{label}<input className="rounded-md border border-slate-300 px-3 py-2 text-sm" defaultValue={defaultValue} name={name} required type="date" /></label>; }
function SnapshotTable({ snapshot }: { snapshot: Snapshot }) { const headers = snapshot.headers ?? []; const rows = snapshot.rows ?? []; return <div className="mt-4 overflow-x-auto rounded-md border border-navy/10"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50"><tr>{headers.map((header) => <th className="px-3 py-2" key={header}>{header}</th>)}</tr></thead><tbody className="divide-y">{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td className="px-3 py-2" key={cellIndex}>{/^\d{4}-\d{2}-\d{2}T/.test(String(cell)) ? formatDateTime(String(cell)) : cell}</td>)}</tr>) : <tr><td className="px-3 py-4 text-muted-foreground" colSpan={Math.max(headers.length, 1)}>Bu kriterlerde kayit yok.</td></tr>}</tbody></table></div>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
