"use client";

import Link from "next/link";
import { BarChart3, BriefcaseBusiness, Building2, ClipboardList, FileStack, GitCompareArrows, MapPinCheck, ShieldCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { ReportSnapshotContent, formatReportCell } from "@/components/admin/report-snapshot";
import type { DisplaySnapshot } from "@/components/admin/report-snapshot";
import { parseSavedReportSnapshot } from "@/lib/reports/snapshot";

type Project = { customerName: string; id: string; name: string; isActive: boolean };
type Option = { id: string; name: string };
type SavedReport = { createdAt: string; createdBy: string; endDate: string; id: string; reportType: string; startDate: string; title: string };
const reportTypes = [
  { icon: ClipboardList, label: "Operasyon özeti", value: "OPERATIONS", description: "Plan, saha kayıtları ve günlük faaliyet" },
  { icon: BriefcaseBusiness, label: "Proje faaliyetleri", value: "PROJECT", description: "Görevler, notlar, ziyaretler ve ekler" },
  { icon: Users, label: "Personel / ekip", value: "PERSONNEL", description: "Atama, ekip beyanı ve gün-proje dağılımı" },
  { icon: Building2, label: "Cari saha özeti", value: "CUSTOMER", description: "Cariye bağlı projelerin faaliyetleri" },
  { icon: MapPinCheck, label: "Ziyaret ve kontrol", value: "VISIT", description: "Ziyaret geçmişi ve kontrol aralıkları" },
  { icon: ShieldCheck, label: "Veri kalitesi", value: "QUALITY", description: "Eksik süre, atama bilgisi ve beyanlar" },
  { icon: FileStack, label: "Medya / belge", value: "MEDIA", description: "Dosya envanteri ve kayıt bağlamı" },
  { icon: GitCompareArrows, label: "Dönem karşılaştırması", value: "COMPARISON", description: "Aynı kapsamın önceki dönemle farkı" },
] as const;
type ReportType = typeof reportTypes[number]["value"];
type Criteria = { startDate: string; endDate: string; projectId: string; customerId: string; personnelId: string; teamId: string; workforce: string; status: string; projectState: string; includeInactiveRows: boolean };
type Preview = { title: string; snapshot: DisplaySnapshot; fingerprint: string };
type ApiPayload = { ok?: boolean; id?: string; error?: string; title?: string; snapshot?: unknown; fingerprint?: string };
const inputClass = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
type Props = { projects: Project[]; customers: Option[]; personnel: Option[]; teams: Option[]; reports: SavedReport[]; today: string; weekStart: string; query: string; selectedType: string; page: number; pages: number; total: number; archiveStart?: string; archiveEnd?: string; archiveCreator?: string };

export function ReportsDashboard({ projects, customers, personnel, teams, reports, today, weekStart, query, selectedType, page, pages, total, archiveStart = "", archiveEnd = "", archiveCreator = "" }: Props) {
  const [reportType, setReportType] = useState<ReportType | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [pending, setPending] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const defaults = (): Criteria => ({ startDate: weekStart, endDate: today, projectId: "", customerId: "", personnelId: "", teamId: "", workforce: "ALL", status: "ALL", projectState: "ALL", includeInactiveRows: false });
  const [criteria, setCriteria] = useState<Criteria>(defaults);
  const router = useRouter();
  const filteredProjects = useMemo(() => { const q = projectSearch.trim().toLocaleLowerCase("tr-TR"); return projects.filter((project) => !q || project.id === criteria.projectId || `${project.name} ${project.customerName}`.toLocaleLowerCase("tr-TR").includes(q)); }, [projects, projectSearch, criteria.projectId]);
  const pageHref = (target: number) => `/admin/reports?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(selectedType ? { type: selectedType } : {}), ...(archiveStart ? { start: archiveStart } : {}), ...(archiveEnd ? { end: archiveEnd } : {}), ...(archiveCreator ? { creator: archiveCreator } : {}), page: String(target) })}`;
  const isVisit = reportType === "VISIT";
  const isMedia = reportType === "MEDIA";
  const showTaskFilters = !isVisit && !isMedia;
  const selectedReport = reportTypes.find((item) => item.value === reportType);
  const previousPeriod = comparePeriod(criteria.startDate, criteria.endDate);
  function update<K extends keyof Criteria>(key: K, value: Criteria[K]) { setCriteria((before) => ({ ...before, [key]: value })); setPreview(null); setError(""); }
  function dateShortcut(startDate: string, endDate: string) { setCriteria((before) => ({ ...before, startDate, endDate })); setPreview(null); setError(""); }
  function showReport(type: ReportType) { setReportType(type); setCriteria(defaults()); setProjectSearch(""); setError(""); setPreview(null); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const operation = submitter instanceof HTMLButtonElement && submitter.value === "save" ? "save" : "preview";
    if (criteria.startDate > criteria.endDate) { setError("Başlangıç tarihi bitiş tarihinden sonra olamaz."); return; }
    if (operation === "save" && !preview) { setError("Kaydetmeden önce raporu önizleyin."); return; }
    const data = new FormData(event.currentTarget);
    data.set("operation", operation);
    if (operation === "save" && preview) data.set("previewFingerprint", preview.fingerprint);
    setPending(operation); setError("");
    try {
      const response = await fetch("/api/admin/reports", { body: data, method: "POST", redirect: "error" });
      if (response.redirected) throw new Error("Rapor yanıtı doğrulanamadı. Oturumunuzu kontrol edip tekrar deneyin.");
      const payload = await response.json() as ApiPayload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Rapor yanıtı okunamadı. Tekrar deneyin.");
      const hasPreview = payload.snapshot && typeof payload.snapshot === "object" && !Array.isArray(payload.snapshot) && typeof payload.fingerprint === "string" && payload.fingerprint.length > 0;
      if (response.status === 409 && hasPreview) {
        setPreview({ title: payload.title ?? "Güncel önizleme", snapshot: parseSavedReportSnapshot(payload.snapshot), fingerprint: payload.fingerprint! });
        setError(payload.error ?? "Veriler değişti. Güncel önizlemeyi inceleyip yeniden kaydedin.");
        return;
      }
      if (!response.ok || payload.ok !== true) throw new Error(payload.error || "Rapor oluşturulamadı. Tekrar deneyin.");
      if (operation === "preview") {
        if (!hasPreview) throw new Error("Önizleme doğrulanamadı. Tekrar deneyin.");
        setPreview({ title: payload.title ?? "Önizleme", snapshot: parseSavedReportSnapshot(payload.snapshot), fingerprint: payload.fingerprint! });
      } else {
        if (typeof payload.id !== "string" || !payload.id.trim()) throw new Error("Rapor kaydı doğrulanamadı. Önizleme korundu; tekrar deneyin.");
        setReportType(null); setPreview(null); router.refresh();
      }
    } catch (failure) { setError(failure instanceof SyntaxError ? "Sunucu yanıtı okunamadı. Seçiminiz korundu; tekrar deneyin." : failure instanceof Error ? failure.message : "Rapor oluşturulamadı."); }
    finally { setPending(null); }
  }
  const scope = [
    `${formatReportCell(criteria.startDate)} – ${formatReportCell(criteria.endDate)}`,
    projects.find((item) => item.id === criteria.projectId)?.name ?? "Tüm projeler",
    customers.find((item) => item.id === criteria.customerId)?.name ?? "Tüm cariler",
    criteria.personnelId ? personnel.find((item) => item.id === criteria.personnelId)?.name : undefined,
    showTaskFilters && criteria.teamId ? teams.find((item) => item.id === criteria.teamId)?.name : undefined,
    criteria.projectState === "ACTIVE" ? "Güncel aktif projeler" : criteria.projectState === "ARCHIVED" ? "Güncel arşiv projeler" : "Aktif ve arşiv projeler",
  ].filter(Boolean).join(" · ");
  return <>
    <section className="space-y-3" aria-label="Rapor türleri"><p className="text-sm text-muted-foreground">Cevaplamak istediğiniz soruya göre raporu seçin. Önizlemede kapsamı ve eksik kayıtları inceleyip sonucu kaydedebilirsiniz.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {reportTypes.map(({ icon: Icon, label, value, description }) => <button className="flex items-start gap-3 rounded-lg border border-primary/15 bg-white p-5 text-left shadow-card transition hover:border-primary hover:bg-primary/5" key={value} onClick={() => showReport(value)} type="button"><span className="rounded-md bg-primary/10 p-3 text-primary"><Icon className="h-5 w-5" aria-hidden="true" /></span><span><span className="block font-semibold text-navy">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span></span></button>)}
    </div></section>
    <section className="mt-6 overflow-hidden rounded-lg border border-navy/10 bg-white shadow-card">
      <div className="flex items-center gap-3 border-b border-navy/10 bg-primary/5 p-4"><BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" /><div><h2 className="font-semibold">Kaydedilmiş raporlar</h2><p className="text-xs text-muted-foreground">Üretildikleri andaki sonuçlar korunur. {total} kayıt.</p></div></div>
      <form className="grid gap-3 border-b border-navy/10 p-4 sm:grid-cols-2 lg:grid-cols-3" method="get">
        <label className="text-xs">Başlık, üreten veya proje<input aria-label="Kayıtlı rapor ara" className={`${inputClass} mt-1`} name="q" defaultValue={query} placeholder="Arşivde ara" /></label>
        <label className="text-xs">Rapor tipi<select aria-label="Kayıtlı rapor tipi" className={`${inputClass} mt-1`} name="type" defaultValue={selectedType}><option value="">Tüm raporlar</option>{reportTypes.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}</select></label>
        <label className="text-xs">Üreten kişi<select aria-label="Raporu üreten kişi" className={`${inputClass} mt-1`} name="creator" defaultValue={archiveCreator}><option value="">Tüm kullanıcılar</option>{personnel.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        <label className="text-xs">Dönem başlangıcı<input aria-label="Arşiv dönem başlangıcı" className={`${inputClass} mt-1`} name="start" type="date" defaultValue={archiveStart} /></label>
        <label className="text-xs">Dönem bitişi<input aria-label="Arşiv dönem bitişi" className={`${inputClass} mt-1`} name="end" type="date" defaultValue={archiveEnd} /></label>
        <div className="flex items-end gap-3"><Button type="submit" variant="outline">Ara</Button><Link className="py-2 text-sm text-primary underline" href="/admin/reports">Filtreleri temizle</Link></div>
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">Dönem filtresi, seçilen tarihlerle kesişen kayıtlı raporları gösterir.</p>
      </form>
      {reports.length ? <div className="divide-y divide-navy/10">{reports.map((report) => <article className="p-4" key={report.id}><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><Link className="font-semibold text-navy underline decoration-primary/30 underline-offset-4" href={`/admin/reports/${encodeURIComponent(report.id)}`}>{report.title}</Link><p className="mt-1 text-xs text-muted-foreground">{formatReportCell(report.startDate.slice(0, 10))} – {formatReportCell(report.endDate.slice(0, 10))} · {report.createdBy} · {formatReportCell(report.createdAt)}</p><p className="mt-1 text-xs text-muted-foreground">{reportTypes.find((item) => item.value === report.reportType)?.label ?? report.reportType} · Kimlik: {report.id}</p></div><div className="flex flex-wrap gap-3 text-sm text-primary"><Link className="underline" href={`/admin/reports/${encodeURIComponent(report.id)}`}>Aç / PDF</Link><a className="underline" href={`/api/admin/reports/${encodeURIComponent(report.id)}/export`}>CSV</a><a className="underline" href={`/api/admin/reports/${encodeURIComponent(report.id)}/export?format=xlsx`}>XLSX</a></div></div></article>)}</div> : <p className="p-8 text-center text-sm text-muted-foreground">Bu aramada kayıtlı rapor bulunamadı.</p>}
      <nav className="flex items-center justify-between border-t border-navy/10 p-4 text-sm" aria-label="Kayıtlı rapor sayfaları">{page > 1 ? <Link className="text-primary underline" href={pageHref(page - 1)}>Önceki</Link> : <span />}<span>{page} / {pages}</span>{page < pages ? <Link className="text-primary underline" href={pageHref(page + 1)}>Sonraki</Link> : <span />}</nav>
    </section>
    <Drawer description={selectedReport?.description} isOpen={Boolean(reportType)} onClose={() => { if (!pending) setReportType(null); }} title={`${selectedReport?.label ?? ""} oluştur`}>
      <form key={reportType} onSubmit={submit}>
        <fieldset disabled={Boolean(pending)} className="flex flex-col gap-4">
          <input name="reportType" type="hidden" value={reportType ?? ""} />
          <div className="flex flex-wrap gap-2" aria-label="Dönem kısayolları">{[
            { label: "Bugün", start: today, end: today }, { label: "Dün", start: shiftDate(today, -1), end: shiftDate(today, -1) },
            { label: "Son 7 gün", start: shiftDate(today, -6), end: today }, { label: "Bu ay", start: `${today.slice(0, 7)}-01`, end: today },
          ].map((shortcut) => <button className="rounded-md border border-primary/20 px-3 py-2 text-xs text-primary" key={shortcut.label} type="button" onClick={() => dateShortcut(shortcut.start, shortcut.end)}>{shortcut.label}</button>)}</div>
          <div className="grid grid-cols-2 gap-3"><DateField value={criteria.startDate} onChange={(value) => update("startDate", value)} label="Başlangıç" name="startDate" /><DateField value={criteria.endDate} onChange={(value) => update("endDate", value)} label="Bitiş" name="endDate" /></div>
          <p className="text-xs text-muted-foreground">Gün sınırları Europe/Istanbul (GMT+3) saat dilimindedir. Görevler program günü, ziyaretler ziyaret zamanı, medya kendi kayıt zamanı üzerinden raporlanır.</p>
          {reportType === "COMPARISON" && previousPeriod ? <p className="rounded-md border border-primary/15 bg-primary/5 p-3 text-sm">Seçilen {previousPeriod.days} gün, aynı filtrelerle hemen önceki {formatReportCell(previousPeriod.start)} – {formatReportCell(previousPeriod.end)} dönemiyle karşılaştırılır.</p> : null}
          <label className="text-sm font-medium">Proje arama<input className={`${inputClass} mt-2`} type="search" placeholder="Proje veya cari ara" value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} /></label>
          <SelectField label="Proje" name="projectId" value={criteria.projectId} onChange={(value) => update("projectId", value)} options={filteredProjects.map((project) => ({ id: project.id, name: `${project.name} — ${project.customerName}${project.isActive ? "" : " (arşiv)"}` }))} all="Tüm projeler" />
          <SelectField label="Cari" name="customerId" value={criteria.customerId} onChange={(value) => update("customerId", value)} options={customers} all="Tüm cariler" />
          <SelectField label={isVisit ? "Ziyaret eden" : isMedia ? "Dosyayı yükleyen" : "Personel / temsilci"} name="personnelId" value={criteria.personnelId} onChange={(value) => update("personnelId", value)} options={personnel} all="Tüm kullanıcılar" />
          {showTaskFilters ? <><SelectField label="Taşeron ekip" name="teamId" value={criteria.teamId} onChange={(value) => update("teamId", value)} options={teams} all="Tüm ekipler" /><SelectField label="İşgücü türü" name="workforce" value={criteria.workforce} onChange={(value) => update("workforce", value)} options={[{ id: "PERSONNEL", name: "Personel" }, { id: "CONTRACTOR", name: "Taşeron ekip" }, { id: "OBSERVER", name: "Saha kontrol" }, { id: "UNKNOWN", name: "Eski / sınıfı bilinmeyen" }]} all="Tümü" allValue="ALL" /><SelectField label="Görev durumu" name="status" value={criteria.status} onChange={(value) => update("status", value)} options={[{ id: "PLANNED", name: "Planlandı durumunda" }, { id: "ON_SITE", name: "Sahada" }, { id: "COMPLETED", name: "Tamamlandı durumunda" }]} all="Tümü" allValue="ALL" /></> : null}
          <SelectField label="Proje kapsamı" name="projectState" value={criteria.projectState} onChange={(value) => update("projectState", value)} options={[{ id: "ACTIVE", name: "Yalnız aktif" }, { id: "ARCHIVED", name: "Yalnız arşiv" }]} all="Aktif ve arşiv projeler" allValue="ALL" />
          {reportType === "PROJECT" || reportType === "CUSTOMER" ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="includeInactiveRows" value="true" className="mt-1" checked={criteria.includeInactiveRows} onChange={(event) => update("includeInactiveRows", event.target.checked)} /><span>Dönemde faaliyet kaydı olmayan projeleri / carileri de göster</span></label> : null}
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-muted-foreground"><p className="font-medium text-navy">Seçili kapsam</p><p className="mt-1" aria-live="polite">{scope}</p><p className="mt-2">{isVisit ? "Ziyaret eden filtresi dönem listesini süzer. Son ziyaret ve gecikme özeti bütün proje ziyaretlerine dayanır." : isMedia ? "Kullanıcı filtresi dosyayı yükleyeni seçer. Dosyanın kayıt zamanı çekim zamanı değildir." : "Kişi ve ekip filtreleri seçili atamaları süzer. Görev süresi göreve ortaktır; not ve dosya ayrıntıları kaydı yapan kullanıcıya göre süzülür. Görevdeki toplam ek sayısı bütün yükleyenleri kapsar."} Aktif/arşiv kapsamı projelerin bugünkü durumudur.</p></div>
          {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          <div className="flex gap-3"><Button disabled={Boolean(pending)} name="operation" value="preview" type="submit" variant="outline">{pending === "preview" ? "Hazırlanıyor..." : "Önizle"}</Button><Button disabled={Boolean(pending) || !preview} name="operation" value="save" type="submit">{pending === "save" ? "Kaydediliyor..." : "Raporu kaydet"}</Button></div>
        </fieldset>
      </form>
      {preview ? <section className="mt-6" aria-label="Rapor önizlemesi"><h3 className="font-semibold">{preview.title}</h3><ReportSnapshotContent key={preview.fingerprint} snapshot={preview.snapshot} /></section> : null}
    </Drawer>
  </>;
}

function DateField({ value, onChange, label, name }: { value: string; onChange: (value: string) => void; label: string; name: string }) { return <label className="text-sm font-medium">{label}<input className={`${inputClass} mt-2`} value={value} onChange={(event) => onChange(event.target.value)} name={name} required type="date" /></label>; }
function SelectField({ label, name, options, all, value, onChange, allValue = "" }: { label: string; name: string; options: Option[]; all: string; value: string; onChange: (value: string) => void; allValue?: string }) { return <label className="text-sm font-medium">{label}<select className={`${inputClass} mt-2`} name={name} value={value} onChange={(event) => onChange(event.target.value)}><option value={allValue}>{all}</option>{options.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>; }
function shiftDate(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); if (!Number.isFinite(date.getTime())) return value; date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function comparePeriod(start: string, end: string) { const duration = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime(); if (!Number.isFinite(duration) || duration < 0) return null; const days = Math.round(duration / 86_400_000) + 1; return { days, start: shiftDate(start, -days), end: shiftDate(start, -1) }; }
