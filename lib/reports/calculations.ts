import type { WorkforceKind } from "../teams/headcount";
import type { ReportMetadata, ReportSection, ReportTrend } from "./model";

export type ReportType = "PROJECT" | "PERSONNEL" | "CUSTOMER" | "VISIT" | "OPERATIONS" | "QUALITY" | "MEDIA" | "COMPARISON";
export type ReportCell = number | string;
export type ReportSnapshot = {
  schemaVersion: 2 | 3;
  calculationVersion: string;
  generatedAt: string;
  headers: string[];
  rows: ReportCell[][];
  rowLinks: Array<{ href: string; label: string } | null>;
  totals: Record<string, number>;
  definitions: string[];
  warnings: string[];
  filters: Record<string, string>;
  filterLabels?: Record<string, string>;
  details?: { headers: string[]; rows: ReportCell[][]; rowLinks: Array<{ href: string; label: string } | null> };
  sections?: ReportSection[];
  metadata?: ReportMetadata;
  trend?: ReportTrend[];
  excludedMetrics?: string[];
};

export type ReportAssignment = {
  id?: string;
  userId: string;
  teamId: string | null;
  teamNameSnapshot: string | null;
  headcountSnapshot: number | null;
  actualHeadcount: number | null;
  workforceKindSnapshot: WorkforceKind | null;
  user: { fullName: string; role: string };
};

export type ReportTask = {
  id: string;
  title?: string;
  managerNote?: string | null;
  taskDate: Date;
  status: "PLANNED" | "ON_SITE" | "COMPLETED";
  arrivedAt: Date | null;
  leftAt: Date | null;
  durationMinutes: number | null;
  assignees: ReportAssignment[];
  projectId: string;
  project: { name: string; customer: { id: string; name: string } };
  _count?: { files: number };
};

function dayOf(task: ReportTask) { return task.taskDate.toISOString().slice(0, 10); }
export function isWorkforceAssignment(assignee: ReportAssignment) {
  // The current user role cannot establish the class of a historical assignment.
  return assignee.workforceKindSnapshot !== "OBSERVER";
}
export function measuredTaskMinutes(task: ReportTask) {
  if (!task.arrivedAt || !task.leftAt || task.durationMinutes === null || !Number.isInteger(task.durationMinutes) || task.durationMinutes < 0) return null;
  const elapsed = task.leftAt.getTime() - task.arrivedAt.getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && Math.round(elapsed / 60_000) === task.durationMinutes ? task.durationMinutes : null;
}

export function summarizeWorkforce(tasks: ReportTask[]) {
  const individualDays = new Set<string>();
  const teamDays = new Map<string, { planned: Set<number>; actual: Set<number>; missingPlan: boolean; missingActual: boolean }>();
  let knownProjectParticipation = 0;
  let unknownAssignments = 0;
  let declaredProjectParticipation = 0;
  let missingDeclarations = 0;
  for (const task of tasks) for (const assignee of task.assignees) {
    if (!isWorkforceAssignment(assignee)) continue;
    const knownPlan = assignee.headcountSnapshot !== null && Number.isInteger(assignee.headcountSnapshot) && assignee.headcountSnapshot >= 0;
    if (assignee.workforceKindSnapshot === null || !knownPlan) {
      unknownAssignments += 1;
      if (assignee.workforceKindSnapshot === null) continue;
    }
    if (knownPlan) knownProjectParticipation += assignee.headcountSnapshot!;
    if (assignee.workforceKindSnapshot === "PERSONNEL") individualDays.add(`${dayOf(task)}:${assignee.userId}`);
    if (assignee.workforceKindSnapshot === "CONTRACTOR") {
      const key = `${dayOf(task)}:${assignee.teamId ?? assignee.userId}`;
      const day = teamDays.get(key) ?? { planned: new Set<number>(), actual: new Set<number>(), missingPlan: false, missingActual: false };
      if (knownPlan) day.planned.add(assignee.headcountSnapshot!);
      else day.missingPlan = true;
      if (assignee.actualHeadcount !== null && Number.isInteger(assignee.actualHeadcount) && assignee.actualHeadcount >= 0 && task.arrivedAt) {
        day.actual.add(assignee.actualHeadcount);
        declaredProjectParticipation += assignee.actualHeadcount;
      } else if (task.arrivedAt) { missingDeclarations += 1; day.missingActual = true; }
      teamDays.set(key, day);
    }
  }
  let knownPlannedTeamHeadcountDays = 0;
  let declaredTeamHeadcountDays = 0;
  let changingTeamDays = 0;
  let incompleteTeamDays = 0;
  for (const day of teamDays.values()) {
    if (day.planned.size === 1 && !day.missingPlan) knownPlannedTeamHeadcountDays += [...day.planned][0];
    if (day.actual.size === 1 && !day.missingActual) declaredTeamHeadcountDays += [...day.actual][0];
    if (day.planned.size > 1 || day.actual.size > 1) changingTeamDays += 1;
    if (day.missingPlan || day.missingActual) incompleteTeamDays += 1;
  }
  return { individualDays: individualDays.size, teamDays: teamDays.size, knownPlannedTeamHeadcountDays, declaredTeamHeadcountDays, knownProjectParticipation, declaredProjectParticipation, unknownAssignments, missingDeclarations, changingTeamDays, incompleteTeamDays };
}

const definitions = [
  "Plan katılımı: her görevde atanmış kayıtlı personel/ekip mevcudunun toplamı; aynı proje/günde farklı görevler ayrı katılım oluşturur, benzersiz çalışan sayısı değildir.",
  "Hesaplı kişi/gün ve ekip/gün, seçilen kayıtlar içinde aynı kullanıcı veya ekibin aynı gündeki tekrarlarını tekilleştirir. Bu iki sayı şirketin kesin benzersiz çalışan sayısı olarak toplanmaz.",
  "Fiili ekip beyanı yalnız sahaya varışı olan görevde kaydedilmiş ekip mevcududur. Bireysel personelin fiili mevcudu ortak görev durumundan çıkarılmaz.",
  "Aynı ekip/gün için farklı plan veya fiili mevcudlar varsa tek bir sayı uydurulmaz; değişen beyan kendi günlük mevcud toplamından çıkarılır.",
  "Başlamış görevlerden birinde ekip beyanı eksikse o ekip/günün fiili toplamı bilinmiyor kabul edilir; bilinen proje katılımları ayrı korunur. Sıfır beyan geçerli bir değerdir.",
  "Süreler göreve ortaktır; kişisel puantaj veya adam-saat değildir. Ayrılışı olmayan görevde süre bilinmiyor gösterilir.",
  "Eski atamalarda sayı/sınıf snapshot'ı yoksa bugünkü ekip sayısı geriye uygulanmaz. Eski rol değişikliklerinin kesin tarihsel sınıflaması kanıtlanamaz.",
];

function tableTotals(tasks: ReportTask[]) {
  const workforce = summarizeWorkforce(tasks);
  return {
    "Görev": tasks.length,
    "Ataması olmayan görev": tasks.filter((task) => task.assignees.length === 0).length,
    "Planlanan": tasks.filter((task) => task.status === "PLANNED").length,
    "Varış kaydı olan": tasks.filter((task) => task.arrivedAt).length,
    "Tamamlandı durumu": tasks.filter((task) => task.status === "COMPLETED").length,
    "Plan katılımı (bilinen)": workforce.knownProjectParticipation,
    "Hesaplı kişi/gün (atama)": workforce.individualDays,
    "Ekip/gün (atama)": workforce.teamDays,
    "Ekip mevcudu/gün (plan)": workforce.knownPlannedTeamHeadcountDays,
    "Ekip mevcudu/gün (fiili beyan)": workforce.declaredTeamHeadcountDays,
    "Değişen ekip/gün": workforce.changingTeamDays,
    "Mevcudu/sınıfı bilinmeyen atama": workforce.unknownAssignments,
    "Fiili beyanı eksik ekip ataması": workforce.missingDeclarations,
    "Bilgisi eksik ekip/gün": workforce.incompleteTeamDays,
    "Ölçülmüş ortak görev süresi (dk)": tasks.reduce((sum, task) => sum + (measuredTaskMinutes(task) ?? 0), 0),
    "Süresi eksik başlayan görev": tasks.filter((task) => task.arrivedAt && measuredTaskMinutes(task) === null).length,
  };
}

export function buildTaskReport(type: "PROJECT" | "PERSONNEL" | "CUSTOMER", tasks: ReportTask[], filters: Record<string, string>, now = new Date()): ReportSnapshot {
  const grouped = new Map<string, { label: string; secondary: string; href: string | null; tasks: ReportTask[] }>();
  if (type === "PERSONNEL") {
    for (const task of tasks) for (const assignee of task.assignees) {
      const identity = assignee.teamId ? `team:${assignee.teamId}` : `user:${assignee.userId}`;
      const key = JSON.stringify([identity, assignee.workforceKindSnapshot, assignee.teamNameSnapshot ?? assignee.user.fullName]);
      const row = grouped.get(key) ?? { label: assignee.teamNameSnapshot ?? assignee.user.fullName, secondary: assignee.workforceKindSnapshot === "CONTRACTOR" ? "Taşeron ekip" : assignee.workforceKindSnapshot === "OBSERVER" ? "Saha kontrol" : assignee.workforceKindSnapshot === "PERSONNEL" ? "Personel" : "Eski kayıt / sınıf bilinmiyor", href: null, tasks: [] };
      row.tasks.push({ ...task, assignees: [assignee] });
      grouped.set(key, row);
    }
  } else {
    for (const task of tasks) {
      const key = type === "CUSTOMER" ? task.project.customer.id : task.projectId;
      const row = grouped.get(key) ?? { label: type === "CUSTOMER" ? task.project.customer.name : task.project.name, secondary: type === "CUSTOMER" ? "" : task.project.customer.name, href: type === "PROJECT" ? `/admin/projects/${encodeURIComponent(task.projectId)}` : null, tasks: [] };
      row.tasks.push(task);
      grouped.set(key, row);
    }
  }
  const rows: ReportCell[][] = [];
  const rowLinks: ReportSnapshot["rowLinks"] = [];
  for (const group of grouped.values()) {
    const workforce = summarizeWorkforce(group.tasks);
    rows.push([
      group.label, group.secondary, group.tasks.length,
      new Set(group.tasks.map((task) => task.projectId)).size,
      group.tasks.filter((task) => task.arrivedAt).length,
      group.tasks.filter((task) => task.status === "COMPLETED").length,
      new Set(group.tasks.filter((task) => task.arrivedAt).map(dayOf)).size,
      workforce.knownProjectParticipation, workforce.declaredProjectParticipation, workforce.unknownAssignments,
      group.tasks.reduce((sum, task) => sum + (measuredTaskMinutes(task) ?? 0), 0),
      group.tasks.filter((task) => task.arrivedAt && measuredTaskMinutes(task) === null).length,
    ]);
    rowLinks.push(group.href ? { href: group.href, label: "Projeyi aç" } : null);
  }
  const totals = tableTotals(tasks);
  const warnings = [];
  if (totals["Mevcudu/sınıfı bilinmeyen atama"]) warnings.push("Bazı eski atamalarda tarihsel mevcud/sınıf bulunmuyor; bilinen toplamlar eksiktir.");
  if (totals["Süresi eksik başlayan görev"]) warnings.push("Ayrılışı veya süresi eksik görevler süre toplamına eklenmedi. Otomatik tamamlanma fiili çalışma kanıtı sayılmaz.");
  if (totals["Değişen ekip/gün"]) warnings.push("Aynı ekip/günde farklı sayılar var. Değişen plan veya fiili beyan kendi günlük toplamına eklenmedi; proje katılımları ayrıntıda görünür.");
  if (totals["Bilgisi eksik ekip/gün"]) warnings.push("Bilgisi eksik ekip/günler ilgili günlük toplamdan çıkarıldı; bilinen görev katılımları korunmuştur.");
  return {
    schemaVersion: 2, calculationVersion: "v1.1-2", generatedAt: now.toISOString(), filters,
    headers: [type === "CUSTOMER" ? "Cari" : type === "PERSONNEL" ? "Personel / ekip" : "Proje", type === "PERSONNEL" ? "Tür" : type === "CUSTOMER" ? "Kapsam" : "Cari", "Görev", "Proje", "Varışlı görev", "Tamamlandı", "Varışlı gün", "Plan katılımı (bilinen)", "Fiili ekip beyanı / katılım", "Bilinmeyen atama", "Ortak görev süresi (dk)", "Eksik süre"],
    rows, rowLinks, totals, definitions, warnings,
    details: {
      headers: ["Tarih", "Proje", "Durum", "Atanan personel / ekip", "Plan katılımı (bilinen)", "Fiili ekip beyanı", "Ortak süre (dk)", "Dosya"],
      rows: tasks.map((task) => { const summary = summarizeWorkforce([task]); const contractors = task.assignees.filter((item) => item.workforceKindSnapshot === "CONTRACTOR"); const declarations = contractors.filter((item) => item.actualHeadcount !== null); return [dayOf(task), task.project.name, task.status === "PLANNED" ? "Planlandı" : task.status === "ON_SITE" ? "Sahada" : "Tamamlandı", task.assignees.map((item) => item.teamNameSnapshot ?? item.user.fullName).join(", "), summary.unknownAssignments ? `${summary.knownProjectParticipation} + ${summary.unknownAssignments} bilinmeyen` : summary.knownProjectParticipation, !task.arrivedAt ? "Henüz varış yok" : !contractors.length ? "—" : !declarations.length ? "Beyan yok" : declarations.length < contractors.length ? `${summary.declaredProjectParticipation} + eksik beyan` : summary.declaredProjectParticipation, measuredTaskMinutes(task) ?? "Bilinmiyor", task._count?.files ?? 0]; }),
      rowLinks: tasks.map((task) => ({ href: `/admin/schedule/tasks/${encodeURIComponent(task.id)}`, label: "Görev / notlar" })),
    },
  };
}
