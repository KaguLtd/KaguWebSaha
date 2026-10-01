"use client";

import Link from "next/link";
import { BarChart3, BriefcaseBusiness, Building2, MapPinCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { ReportSnapshotContent, formatReportCell } from "@/components/admin/report-snapshot";
import type { DisplaySnapshot } from "@/components/admin/report-snapshot";

type Project = { customerName: string; id: string; name: string; isActive: boolean };
type Option = { id: string; name: string };
type SavedReport = { createdAt: string; createdBy: string; endDate: string; id: string; reportType: string; snapshot: DisplaySnapshot; startDate: string; title: string };
const reportTypes = [
  { icon: BriefcaseBusiness, label: "Proje", value: "PROJECT" },
  { icon: Users, label: "Personel / ekip", value: "PERSONNEL" },
  { icon: Building2, label: "Cari", value: "CUSTOMER" },
  { icon: MapPinCheck, label: "Ziyaret", value: "VISIT" },
] as const;
const inputClass = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";

type Props = { projects: Project[]; customers: Option[]; personnel: Option[]; teams: Option[]; reports: SavedReport[]; today: string; weekStart: string; query: string; selectedType: string; page: number; pages: number; total: number };

export function ReportsDashboard({ projects, customers, personnel, teams, reports, today, weekStart, query, selectedType, page, pages, total }: Props) {
  const [reportType, setReportType] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ title: string; snapshot: DisplaySnapshot } | null>(null);
  const router = useRouter();
  const filteredProjects = useMemo(() => { const q = projectSearch.trim().toLocaleLowerCase("tr-TR"); return projects.filter((project) => !q || `${project.name} ${project.customerName}`.toLocaleLowerCase("tr-TR").includes(q)); }, [projects, projectSearch]);
  const pageHref = (target: number) => `/admin/reports?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(selectedType ? { type: selectedType } : {}), page: String(target) })}`;
  const isVisit = reportType === "VISIT";
  return <>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {reportTypes.map(({ icon: Icon, label, value }) => <button className="flex items-center gap-3 rounded-lg border border-primary/15 bg-white p-5 text-left shadow-card transition hover:border-primary hover:bg-primary/5" key={value} onClick={() => { setReportType(value); setError(""); setPreview(null); }} type="button"><span className="rounded-md bg-primary/10 p-3 text-primary"><Icon className="h-5 w-5" /></span><span><span className="block font-semibold text-navy">{label} Raporu</span><span className="mt-1 block text-xs text-muted-foreground">Önizle ve kaydet</span></span></button>)}
    </section>
    <section className="mt-6 overflow-hidden rounded-lg border border-navy/10 bg-white shadow-card">
      <div className="flex items-center gap-3 border-b border-navy/10 bg-primary/5 p-4"><BarChart3 className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Kaydedilmiş Raporlar</h2><p className="text-xs text-muted-foreground">Raporlar oluşturuldukları andaki veriyi korur. {total} kayıt.</p></div></div>
      <form className="grid gap-3 border-b border-navy/10 p-4 sm:grid-cols-[1fr_200px_auto]" method="get"><input aria-label="Kayıtlı rapor ara" className={inputClass} name="q" defaultValue={query} placeholder="Rapor başlığında ara" /><select aria-label="Rapor tipi" className={inputClass} name="type" defaultValue={selectedType}><option value="">Tüm raporlar</option>{reportTypes.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}</select><Button type="submit" variant="outline">Ara</Button></form>
      {reports.length ? <div className="divide-y divide-navy/10">{reports.map((report) => <details className="group p-4" key={report.id}><summary className="cursor-pointer list-none"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-navy">{report.title}</p><p className="mt-1 text-xs text-muted-foreground">{formatReportCell(report.startDate.slice(0, 10))} – {formatReportCell(report.endDate.slice(0, 10))} · {report.createdBy} · {formatReportCell(report.createdAt)}</p></div><span className="rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-xs font-medium text-primary">İncele</span></div></summary><div className="mt-3 flex flex-wrap gap-4 text-sm text-primary"><Link className="underline" href={`/admin/reports/${encodeURIComponent(report.id)}`}>Aç / yazdır / PDF</Link><a className="underline" href={`/api/admin/reports/${encodeURIComponent(report.id)}/export`}>Excel uyumlu CSV</a></div><ReportSnapshotContent snapshot={report.snapshot} /></details>)}</div> : <p className="p-8 text-center text-sm text-muted-foreground">Bu aramada kayıtlı rapor bulunamadı.</p>}
      <nav className="flex items-center justify-between border-t border-navy/10 p-4 text-sm" aria-label="Rapor sayfaları">{page > 1 ? <Link className="text-primary underline" href={pageHref(page - 1)}>Önceki</Link> : <span /> }<span>{page} / {pages}</span>{page < pages ? <Link className="text-primary underline" href={pageHref(page + 1)}>Sonraki</Link> : <span />}</nav>
    </section>
    <Drawer description="Filtreleri seçin, hesabı önizleyin ve kaydedin. Kaydetme anındaki güncel veri rapora alınır." isOpen={Boolean(reportType)} onClose={() => { if (!pending) setReportType(null); }} title={`${reportTypes.find((item) => item.value === reportType)?.label ?? ""} Raporu Oluştur`}>
      <form key={reportType} className="flex flex-col gap-4" onChange={() => setPreview(null)} onSubmit={async (event) => { event.preventDefault(); const submitter = (event.nativeEvent as SubmitEvent).submitter; const operation = submitter instanceof HTMLButtonElement ? submitter.value : "preview"; const data = new FormData(event.currentTarget); data.set("operation", operation); setPending(true); setError(""); try { const response = await fetch("/api/admin/reports", { body: data, method: "POST" }); const payload = await response.json() as { error?: string; title?: string; snapshot?: DisplaySnapshot }; if (!response.ok) throw new Error(payload.error || "Rapor oluşturulamadı."); if (operation === "preview" && payload.snapshot) setPreview({ title: payload.title ?? "Önizleme", snapshot: payload.snapshot }); else { setReportType(null); setPreview(null); router.refresh(); } } catch (e) { setError(e instanceof Error ? e.message : "Rapor oluşturulamadı."); } finally { setPending(false); } }}>
        <input name="reportType" type="hidden" value={reportType ?? ""} />
        <div className="grid grid-cols-2 gap-3"><DateField defaultValue={weekStart} label="Başlangıç" name="startDate" /><DateField defaultValue={today} label="Bitiş" name="endDate" /></div>
        <label className="text-sm font-medium">Proje arama<input className={`${inputClass} mt-2`} type="search" placeholder="Proje veya cari ara" value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} /></label>
        <SelectField label="Proje" name="projectId" options={filteredProjects.map((project) => ({ id: project.id, name: `${project.name} — ${project.customerName}${project.isActive ? "" : " (arşiv)"}` }))} all="Tüm projeler" />
        <SelectField label="Cari" name="customerId" options={customers} all="Tüm cariler" />
        <SelectField label={isVisit ? "Ziyaret eden" : "Personel / temsilci"} name="personnelId" options={personnel} all="Tüm kullanıcılar" />
        {!isVisit ? <><SelectField label="Taşeron ekip" name="teamId" options={teams} all="Tüm ekipler" /><label className="text-sm font-medium">İşgücü türü<select className={`${inputClass} mt-2`} name="workforce"><option value="ALL">Tümü</option><option value="PERSONNEL">Personel</option><option value="CONTRACTOR">Taşeron ekip</option><option value="OBSERVER">Saha kontrol</option><option value="UNKNOWN">Eski / sınıfı bilinmeyen</option></select></label><label className="text-sm font-medium">Görev durumu<select className={`${inputClass} mt-2`} name="status"><option value="ALL">Tümü</option><option value="PLANNED">Planlandı</option><option value="ON_SITE">Sahada</option><option value="COMPLETED">Tamamlandı</option></select></label></> : null}
        <label className="text-sm font-medium">Proje kapsamı<select className={`${inputClass} mt-2`} name="projectState"><option value="ALL">Aktif ve arşiv projeler</option><option value="ACTIVE">Yalnız aktif</option><option value="ARCHIVED">Yalnız arşiv</option></select></label>
        {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <div className="flex gap-3"><Button disabled={pending} name="operation" value="preview" type="submit" variant="outline">{pending ? "Hazırlanıyor..." : "Önizle"}</Button><Button disabled={pending || !preview} name="operation" value="save" type="submit">Raporu kaydet</Button></div>
      </form>
      {preview ? <section className="mt-6"><h3 className="font-semibold">{preview.title}</h3><ReportSnapshotContent snapshot={preview.snapshot} /></section> : null}
    </Drawer>
  </>;
}

function DateField({ defaultValue, label, name }: { defaultValue: string; label: string; name: string }) { return <label className="text-sm font-medium">{label}<input className={`${inputClass} mt-2`} defaultValue={defaultValue} name={name} required type="date" /></label>; }
function SelectField({ label, name, options, all }: { label: string; name: string; options: Option[]; all: string }) { return <label className="text-sm font-medium">{label}<select className={`${inputClass} mt-2`} name={name} defaultValue=""><option value="">{all}</option>{options.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>; }
