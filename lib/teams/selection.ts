import { teamHeadcount } from "./headcount";
import type { WorkforceKind } from "./headcount";

export type AssignmentSnapshot = { userId: string; teamId: string | null; teamNameSnapshot: string | null; headcountSnapshot: number | null; actualHeadcount: number | null; workforceKindSnapshot: WorkforceKind | null };
type Person = { id: string; role: string; isActive: boolean };
type Team = { id: string; representativeUserId: string; name: string; extraPersonnelCount: number; includeRepresentative: boolean; isActive: boolean; effectiveFrom: Date; representative: Person };

export function resolveAssignmentSnapshots(userIds: string[], teamIds: string[], users: Person[], teams: Team[], taskDate: Date, previous: AssignmentSnapshot[], today: Date, legacyForm = false) {
  if (users.length !== userIds.length || teams.length !== teamIds.length) throw new Error("Seçilen personel veya ekip bulunamadı.");
  const existing = new Map(previous.map((item) => [item.userId, item]));
  const selected = new Map<string, AssignmentSnapshot>();
  const teamRepresentatives = new Set<string>();
  for (const user of users) {
    const before = existing.get(user.id);
    if (before && (!before.teamId || legacyForm)) {
      selected.set(user.id, before);
      continue;
    }
    if (user.role !== "PERSONNEL" || !user.isActive) throw new Error("Yalnız aktif personel göreve atanabilir.");
    selected.set(user.id, { userId: user.id, teamId: null, teamNameSnapshot: null, headcountSnapshot: 1, actualHeadcount: null, workforceKindSnapshot: "PERSONNEL" });
  }
  for (const team of teams) {
    if (teamRepresentatives.has(team.representativeUserId)) throw new Error("Aynı temsilciye bağlı iki ekip aynı göreve atanamaz.");
    teamRepresentatives.add(team.representativeUserId);
    const before = existing.get(team.representativeUserId);
    if (before?.teamId === team.id) {
      selected.set(team.representativeUserId, before);
      continue;
    }
    if (!team.isActive || !team.representative.isActive || team.representative.role !== "PERSONNEL") throw new Error("Yalnız aktif ekibi ve aktif personel temsilcisini atayabilirsiniz.");
    if (taskDate < today) throw new Error("Geçmiş göreve bugünkü ekip mevcudu uygulanamaz. Mevcut tarihsel atama korunabilir.");
    if (team.effectiveFrom > taskDate) throw new Error("Ekip seçilen görev tarihinde henüz geçerli değil.");
    selected.set(team.representativeUserId, { userId: team.representativeUserId, teamId: team.id, teamNameSnapshot: team.name, headcountSnapshot: teamHeadcount(team.extraPersonnelCount, team.includeRepresentative), actualHeadcount: null, workforceKindSnapshot: "CONTRACTOR" });
  }
  return [...selected.values()];
}
