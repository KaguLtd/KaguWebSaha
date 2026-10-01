export type WorkforceKind = "PERSONNEL" | "CONTRACTOR" | "OBSERVER";

export const MAX_TEAM_HEADCOUNT = 500;

export function teamHeadcount(extraPersonnelCount: number, includeRepresentative: boolean) {
  if (!Number.isInteger(extraPersonnelCount) || extraPersonnelCount < 0) {
    throw new Error("Hesabı olmayan personel sayısı sıfır veya pozitif tam sayı olmalıdır.");
  }
  const total = extraPersonnelCount + (includeRepresentative ? 1 : 0);
  if (total < 1 || total > MAX_TEAM_HEADCOUNT) {
    throw new Error(`Ekip toplamı 1–${MAX_TEAM_HEADCOUNT} kişi arasında olmalıdır.`);
  }
  return total;
}

export function parseActualHeadcount(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > MAX_TEAM_HEADCOUNT) {
    throw new Error(`Sahaya gelen ekip mevcudu 0–${MAX_TEAM_HEADCOUNT} kişi arasında olmalıdır.`);
  }
  return count;
}
