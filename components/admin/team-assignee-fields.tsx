"use client";

import { useState } from "react";

export type AssignmentPersonView = { id: string; fullName: string; teamId?: string | null; teamNameSnapshot?: string | null; headcountSnapshot?: number | null };
export type AssignmentTeamView = { id: string; name: string; representativeUserId: string; representativeName: string; headcount: number; isActive: boolean; effectiveFrom: string };

export function TeamAssigneeFields({ personnel, teams = [], assignments = [], taskDate, disabled }: { personnel: AssignmentPersonView[]; teams?: AssignmentTeamView[]; assignments?: AssignmentPersonView[]; taskDate: string; disabled?: boolean }) {
  const [people, setPeople] = useState(new Set(assignments.filter((item) => !item.teamId).map((item) => item.id)));
  const [selectedTeams, setSelectedTeams] = useState(new Set(assignments.flatMap((item) => item.teamId ? [item.teamId] : [])));
  const availableTeams = teams.filter((team) => selectedTeams.has(team.id) || (team.isActive && team.effectiveFrom <= taskDate));
  const allPeople = [...new Map([...personnel, ...assignments].map((person) => [person.id, person])).values()];
  return <fieldset className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-3 text-navy shadow-sm">
    <input name="assignmentSchemaVersion" type="hidden" value="2" />
    <legend className="px-1 text-sm font-medium">Personel / taşeron ekipleri</legend>
    {disabled ? <p className="text-sm text-muted-foreground">Görev sahada veya tamamlanmış olduğu için atamalar değiştirilemez.</p> : null}
    {allPeople.filter((person) => !disabled || people.has(person.id)).map((person) => <label className="flex items-center gap-3 text-sm" key={person.id}>
      <input className="h-4 w-4" name="assigneeIds" type="checkbox" value={person.id} disabled={disabled} checked={people.has(person.id)} onChange={(event) => { const next = new Set(people); if (event.target.checked) next.add(person.id); else next.delete(person.id); setPeople(next); if (event.target.checked) setSelectedTeams(new Set([...selectedTeams].filter((id) => teams.find((team) => team.id === id)?.representativeUserId !== person.id))); }} />
      <span>{person.fullName} <span className="text-xs text-muted-foreground">(tek hesap{assignments.find((item) => item.id === person.id && !item.teamId)?.headcountSnapshot === null ? ", eski mevcud bilinmiyor" : ""})</span></span>
    </label>)}
    {availableTeams.length ? <p className="mt-2 text-xs font-semibold text-muted-foreground">Ön tanımlı ekipler</p> : null}
    {availableTeams.filter((team) => !disabled || selectedTeams.has(team.id)).map((team) => {
      const saved = assignments.find((item) => item.teamId === team.id);
      const headcount = saved ? saved.headcountSnapshot : team.headcount;
      return <label className="flex items-start gap-3 text-sm" key={team.id}>
        <input className="mt-1 h-4 w-4" name="teamIds" type="checkbox" value={team.id} disabled={disabled} checked={selectedTeams.has(team.id)} onChange={(event) => { const next = event.target.checked ? new Set([...selectedTeams].filter((id) => teams.find((item) => item.id === id)?.representativeUserId !== team.representativeUserId)) : new Set(selectedTeams); if (event.target.checked) next.add(team.id); else next.delete(team.id); setSelectedTeams(next); if (event.target.checked) setPeople(new Set([...people].filter((id) => id !== team.representativeUserId))); }} />
        <span>{saved?.teamNameSnapshot ?? team.name} <span className="font-medium">· {headcount ?? "bilinmeyen"} kişi</span><span className="block text-xs text-muted-foreground">Temsilci: {team.representativeName}{!team.isActive ? " · pasif ekip, önceki atama" : ""}</span></span>
      </label>;
    })}
    {allPeople.length === 0 && availableTeams.length === 0 ? <p className="text-sm text-muted-foreground">Uygun personel veya ekip yok.</p> : null}
    <p className="text-xs text-muted-foreground">Ekip seçimi temsilci hesabını da atar. Mevcut görevlerin kayıtlı ekip sayısı korunur.</p>
  </fieldset>;
}
