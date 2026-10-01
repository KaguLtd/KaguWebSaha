"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveTeamAction } from "@/app/(admin)/admin/users/actions";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { teamHeadcount } from "@/lib/teams/headcount";

export type TeamView = { id: string; name: string; representativeUserId: string; representativeName: string; extraPersonnelCount: number; includeRepresentative: boolean; isActive: boolean; effectiveFrom: string };
type Person = { id: string; fullName: string; isActive: boolean };

export function TeamsPanel({ teams, personnel, today }: { teams: TeamView[]; personnel: Person[]; today: string }) {
  const [editing, setEditing] = useState<TeamView | "new" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  return <section className="rounded-lg border border-navy/10 bg-white p-5 shadow-card">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Ön Tanımlı Taşeron Ekipleri</h2><p className="mt-1 text-sm text-muted-foreground">Tek personel hesabıyla temsil edilen ekibin çalışan sayısını belirleyin.</p></div><Button onClick={() => { setError(""); setEditing("new"); }} type="button">Ekip oluştur</Button></div>
    <div className="mt-4 divide-y">{teams.length ? teams.map((team) => <div className="flex flex-wrap items-center justify-between gap-3 py-4" key={team.id}><div><p className="font-medium">{team.name} <span className="text-xs text-muted-foreground">{team.isActive ? "Aktif" : "Pasif"}</span></p><p className="mt-1 text-sm text-muted-foreground">{team.representativeName} · {team.extraPersonnelCount + (team.includeRepresentative ? 1 : 0)} kişi · {team.effectiveFrom}</p></div><Button variant="outline" size="sm" type="button" onClick={() => { setError(""); setEditing(team); }}>Düzenle</Button></div>) : <p className="py-5 text-sm text-muted-foreground">Henüz ekip tanımlanmadı.</p>}</div>
    <Drawer title={editing === "new" ? "Ekip Oluştur" : "Ekibi Düzenle"} description="Değişiklikler mevcut görevlerin kayıtlı sayılarını değiştirmez; yeni atamalarda uygulanır." isOpen={editing !== null} onClose={() => { if (!pending) setEditing(null); }}>
      {editing ? <TeamForm key={typeof editing === "string" ? editing : editing.id} team={typeof editing === "string" ? null : editing} personnel={personnel} today={today} pending={pending} error={error} onSubmit={async (form) => { setPending(true); setError(""); try { await saveTeamAction(form); setEditing(null); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Ekip kaydedilemedi."); } finally { setPending(false); } }} /> : null}
    </Drawer>
  </section>;
}

function TeamForm({ team, personnel, today, pending, error, onSubmit }: { team: TeamView | null; personnel: Person[]; today: string; pending: boolean; error: string; onSubmit: (form: FormData) => Promise<void> }) {
  const [extraCount, setExtraCount] = useState(String(team?.extraPersonnelCount ?? 0));
  const [include, setInclude] = useState(team?.includeRepresentative ?? true);
  let total: number | null = null;
  try { total = teamHeadcount(Number(extraCount), include); } catch { /* Shown by browser/action validation. */ }
  const inputClass = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
  return <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void onSubmit(new FormData(event.currentTarget)); }}>
    <input type="hidden" name="teamId" value={team?.id ?? ""} />
    <label className="text-sm font-medium">Ekip adı<input className={`${inputClass} mt-2`} name="name" required maxLength={120} defaultValue={team?.name ?? ""} /></label>
    <label className="text-sm font-medium">Personel hesabı / temsilci<select className={`${inputClass} mt-2`} name="representativeUserId" required defaultValue={team?.representativeUserId ?? ""}><option value="" disabled>Temsilci seçin</option>{personnel.map((person) => <option value={person.id} key={person.id}>{person.fullName}{!person.isActive ? " (pasif)" : ""}</option>)}</select></label>
    <label className="text-sm font-medium">Hesabı olmayan ek personel<input className={`${inputClass} mt-2`} name="extraPersonnelCount" type="number" min={0} max={include ? 499 : 500} step={1} required value={extraCount} onChange={(event) => setExtraCount(event.target.value)} /></label>
    <label className="flex items-center gap-2 text-sm"><input name="includeRepresentative" type="checkbox" checked={include} onChange={(event) => setInclude(event.target.checked)} />Temsilci sahada çalışan sayısına dahil</label>
    <p className="rounded-md bg-primary/5 p-3 text-sm font-semibold">Toplam: {total ?? "—"} kişi</p>
    <label className="text-sm font-medium">Başlangıç tarihi<input className={`${inputClass} mt-2`} type="date" name="effectiveFrom" required defaultValue={team?.effectiveFrom ?? today} min={team ? undefined : today} /></label>
    <label className="flex items-center gap-2 text-sm"><input name="isActive" type="checkbox" defaultChecked={team?.isActive ?? true} />Aktif ekip</label>
    <p className="text-xs text-muted-foreground">Sahaya gerçekten gelen kişi sayısı ayrıca kaydedilir. Temsilcinin mevcut hesabı ve görev ekranı kullanılmaya devam eder.</p>
    {error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    <Button disabled={pending} type="submit">{pending ? "Kaydediliyor..." : "Kaydet"}</Button>
  </form>;
}
