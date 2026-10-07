import { APP_TIME_ZONE, getDateOnlyRangeInAppTimeZone } from "../dates/today";
import { parseDateOnly } from "../dates/calendar";
import { getVisitAgeDays, getVisitDayKey, getVisitStatus } from "../visits/status";
import { buildTaskReport, measuredTaskMinutes, summarizeWorkforce } from "./calculations";
import type { ReportAssignment, ReportCell, ReportSnapshot, ReportTask, ReportType } from "./calculations";
import type { ReportData, ReportSection, ReportTrend } from "./model";

type Link = { href: string; label: string } | null;
type QualityIssue = { level: string; source: string; projectId: string; date: string; issue: string; explanation: string; link: Link };
const dateOf = (task: ReportTask) => task.taskDate.toISOString().slice(0, 10);
const iso = (date: Date | null | undefined) => date ? date.toISOString() : "—";
const taskLink = (id: string): Link => ({ href: `/admin/schedule/tasks/${encodeURIComponent(id)}`, label: "Görevi aç" });
const projectLink = (id: string): Link => ({ href: `/admin/projects/${encodeURIComponent(id)}`, label: "Projeyi aç" });
const kindName = (assignment: ReportAssignment) => assignment.workforceKindSnapshot === "PERSONNEL" ? "Personel" : assignment.workforceKindSnapshot === "CONTRACTOR" ? "Taşeron ekip" : assignment.workforceKindSnapshot === "OBSERVER" ? "Saha kontrol" : "Tarihsel sınıf bilinmiyor";
const validCount = (value: number | null) => value !== null && Number.isInteger(value) && value >= 0;
const unique = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map((row) => [row.id, row])).values()];
const section = (id: string, title: string, headers: string[], rows: ReportCell[][], rowLinks?: Link[], description?: string): ReportSection => ({ id, title, headers, rows, ...(rowLinks ? { rowLinks } : {}), ...(description ? { description } : {}) });

function period(filters: Record<string, string>, now: Date) {
  const first = parseDateOnly(filters.startDate) ?? parseDateOnly(getVisitDayKey(now))!;
  const last = parseDateOnly(filters.endDate) ?? first;
  return { start: getDateOnlyRangeInAppTimeZone(first).start, end: getDateOnlyRangeInAppTimeZone(last).end, first, last };
}

function normalize(data: ReportData): ReportData {
  return { ...data, projects: unique(data.projects), tasks: unique(data.tasks), activity: unique(data.activity), notes: unique(data.notes), files: unique(data.files), siteEvents: unique(data.siteEvents), visits: unique(data.visits.map((visit) => ({ ...visit, id: `${visit.source}:${visit.id}`, sourceId: visit.id }))).map((visit) => ({ ...visit, id: visit.sourceId })), mediaJobs: [...new Map(data.mediaJobs.map((job) => [`${job.kind}:${job.id}`, job])).values()] };
}

function makeTrend(data: ReportData, filters: Record<string, string>, now: Date): ReportTrend[] {
  const { first, last } = period(filters, now);
  const days = new Map<string, ReportTrend>();
  const get = (date: string) => {
    if (date < first.toISOString().slice(0, 10) || date > last.toISOString().slice(0, 10)) return null;
    const row = days.get(date) ?? { date, tasks: 0, arrived: 0, closed: 0, minutes: 0, notes: 0, files: 0, visits: 0 };
    days.set(date, row); return row;
  };
  // Empty calendar days remain visible without allocating an unbounded date range.
  const length = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
  if (length <= 3660) for (let index = 0; index < length; index++) get(new Date(first.getTime() + index * 86_400_000).toISOString().slice(0, 10));
  for (const task of data.tasks) { const row = get(dateOf(task)); if (row) { row.tasks++; if (task.arrivedAt) row.arrived++; if (task.status === "COMPLETED") row.closed++; row.minutes += measuredTaskMinutes(task) ?? 0; } }
  for (const activity of data.activity) { const row = get(getVisitDayKey(activity.createdAt)); if (row && activity.eventType === "NOTE_ADDED") row.notes++; }
  for (const file of data.files) { const row = get(getVisitDayKey(file.createdAt)); if (row) row.files++; }
  for (const visit of data.visitsAvailable === false ? [] : data.visits) { const row = get(getVisitDayKey(visit.visitedAt)); if (row) row.visits++; }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function workforceDaily(data: ReportData) {
  const groups = new Map<string, { date: string; identity: string; label: string; kind: string; tasks: ReportTask[] }>();
  for (const task of data.tasks) for (const assignment of task.assignees) {
    const identity = assignment.teamId ?? assignment.userId;
    const label = assignment.teamNameSnapshot ?? assignment.user.fullName;
    const key = JSON.stringify([dateOf(task), assignment.teamId ? "team" : "user", identity, assignment.workforceKindSnapshot, label]);
    const group = groups.get(key) ?? { date: dateOf(task), identity, label, kind: kindName(assignment), tasks: [] };
    group.tasks.push({ ...task, assignees: [assignment] }); groups.set(key, group);
  }
  // Daily declarations are assessed across name changes of the same stable team identity.
  const teamDayTasks = new Map<string, ReportTask[]>();
  for (const task of data.tasks) for (const assignment of task.assignees) if (assignment.workforceKindSnapshot === "CONTRACTOR") {
    const key = `${dateOf(task)}:${assignment.teamId ?? assignment.userId}`;
    const rows = teamDayTasks.get(key) ?? []; rows.push({ ...task, assignees: [assignment] }); teamDayTasks.set(key, rows);
  }
  return section("workforceDaily", "Personel / ekip günlük matrisi", ["Program günü", "Kişi / ekip ID", "Tarihsel ad", "Tarihsel tür", "Görev", "Proje", "Plan katılımı", "Fiili ekip katılımı", "Günlük plan mevcudu", "Günlük fiili mevcud", "Bilinmeyen atama", "Ortak görev süresi (dk)"], [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, "tr")).map((group) => {
    const summary = summarizeWorkforce(group.tasks);
    const teamTasks = teamDayTasks.get(`${group.date}:${group.identity}`) ?? group.tasks;
    const daily = summarizeWorkforce(teamTasks);
    const contractor = group.kind === "Taşeron ekip";
    const plans = new Set(teamTasks.flatMap((task) => task.assignees.filter((assignment) => validCount(assignment.headcountSnapshot)).map((assignment) => assignment.headcountSnapshot)));
    const actuals = new Set(teamTasks.filter((task) => task.arrivedAt).flatMap((task) => task.assignees.filter((assignment) => validCount(assignment.actualHeadcount)).map((assignment) => assignment.actualHeadcount)));
    const planned = contractor ? plans.size > 1 || teamTasks.some((task) => task.assignees.some((assignment) => !validCount(assignment.headcountSnapshot))) ? "Bilinmiyor / değişen" : daily.knownPlannedTeamHeadcountDays : "—";
    const actual = contractor ? !teamTasks.some((task) => task.arrivedAt) ? "Varış yok" : actuals.size > 1 || daily.missingDeclarations ? "Bilinmiyor / eksik veya değişen" : daily.declaredTeamHeadcountDays : "Kişisel fiili mevcud ölçülmüyor";
    return [group.date, group.identity, group.label, group.kind, new Set(group.tasks.map((task) => task.id)).size, new Set(group.tasks.map((task) => task.projectId)).size, summary.knownProjectParticipation, summary.declaredProjectParticipation, planned, actual, summary.unknownAssignments, [...new Map(group.tasks.map((task) => [task.id, task])).values()].reduce((sum, task) => sum + (measuredTaskMinutes(task) ?? 0), 0)];
  }), undefined, "Görev/katılım sayıları atama kapsamındadır. Ortak süre kişisel çalışma süresi değildir ve kişi/ekip satırları arasında toplanmaz. Aynı ekibin ad değişikliği satırlarında günlük mevcud tekrar görünebilir; şirket toplamı sabit ekip ID ile tekilleştirilir.");
}

function qualityIssues(data: ReportData): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const addTask = (task: ReportTask, issue: string, explanation: string, level = "Uyarı", source = task.id) => issues.push({ level, source, projectId: task.projectId, date: dateOf(task), issue, explanation, link: taskLink(task.id) });
  for (const task of data.tasks) {
    if (!task.assignees.length) addTask(task, "Atamasız görev", "Görevde personel veya ekip ataması yok.");
    if (task.status === "COMPLETED" && !task.arrivedAt) addTask(task, "Kanıtı eksik tamamlanma", "Tamamlandı durumu saha varışını veya fiili çalışma süresini kanıtlamaz.");
    if (task.status === "PLANNED" && task.arrivedAt) addTask(task, "Durum / varış uyuşmazlığı", "Planlandı durumuna rağmen varış kaydı var; varış metriği bağımsız gösterilir.");
    if (task.leftAt && !task.arrivedAt) addTask(task, "Başlangıçsız ayrılış", "Varış bulunmadığından süre bilinmiyor.", "Hata");
    if (task.arrivedAt && !task.leftAt) addTask(task, "Ayrılış eksik", "Başlayan görevin ölçülmüş ortak süresi bulunmuyor.");
    if (task.arrivedAt && task.leftAt && measuredTaskMinutes(task) === null) addTask(task, "Tutarsız süre", "Zamanlar sıralı olmalı ve kayıtlı dakika zaman farkının yuvarlanmış değeriyle eşleşmeli; süre toplamına alınmadı.", "Hata");
    for (const assignment of task.assignees) {
      const id = assignment.id ?? `${task.id}:${assignment.userId}`;
      if (assignment.workforceKindSnapshot === null) addTask(task, "Tarihsel sınıf eksik", "Bugünkü kullanıcı rolü geçmiş atamanın sınıfını kanıtlamaz.", "Uyarı", id);
      else if (assignment.workforceKindSnapshot !== "OBSERVER" && !validCount(assignment.headcountSnapshot)) addTask(task, "Plan mevcudu eksik / geçersiz", "Bilinen plan toplamı bu atamayı kapsamıyor.", "Uyarı", id);
      if (assignment.workforceKindSnapshot === "CONTRACTOR" && task.arrivedAt && !validCount(assignment.actualHeadcount)) addTask(task, "Fiili ekip beyanı eksik / geçersiz", "İlgili ekip/gün fiili toplamdan çıkarılır; sıfır geçerli beyandır.", "Uyarı", id);
    }
  }
  const teamDays = new Map<string, { task: ReportTask; tasks: ReportTask[] }>();
  for (const task of data.tasks) for (const assignment of task.assignees) if (assignment.workforceKindSnapshot === "CONTRACTOR") {
    const key = `${dateOf(task)}:${assignment.teamId ?? assignment.userId}`;
    const group = teamDays.get(key) ?? { task, tasks: [] }; group.tasks.push({ ...task, assignees: [assignment] }); teamDays.set(key, group);
  }
  for (const [id, group] of teamDays) if (summarizeWorkforce(group.tasks).changingTeamDays) addTask(group.task, "Değişen ekip/gün", "Aynı sabit ekip kimliği ve program gününde farklı mevcudlar var; ilgili günlük toplam kesin sayı olarak gösterilmez.", "Uyarı", id);
  for (const visit of data.visits) if (visit.source === "LEGACY" && visit.fileCount === null) issues.push({ level: "Bilgi", source: visit.id, projectId: visit.projectId, date: getVisitDayKey(visit.visitedAt), issue: "Eski ziyaret dosya sayısı bilinmiyor", explanation: "Tarihsel ziyaretin dosya mevcudu sıfır varsayılmadı.", link: { href: `/admin/visits/${encodeURIComponent(visit.projectId)}`, label: "Ziyaret geçmişi" } });
  for (const job of data.mediaJobs) if (job.status === "FAILED") issues.push({ level: "Uyarı", source: job.id, projectId: job.projectId, date: getVisitDayKey(job.updatedAt), issue: "Başarısız sunucu medya işi", explanation: `${job.kind}; durum okuma anındaki sunucu kaydıdır.`, link: projectLink(job.projectId) });
  for (const file of data.files) if (!file.dailyTaskId && !file.projectVisitId) issues.push({ level: "Bilgi", source: file.id, projectId: file.projectId, date: getVisitDayKey(file.createdAt), issue: "Görev / ziyaret bağı olmayan dosya", explanation: "Proje dosyası korunur; bir göreve veya ziyarete tahminen bağlanmaz.", link: { href: `/api/files/${encodeURIComponent(file.id)}`, label: "Dosyayı aç" } });
  for (const event of data.siteEvents) if (["ARRIVED_SITE", "LEFT_SITE", "SITE_VISITED"].includes(event.type) && !event.hasLocation) issues.push({ level: "Bilgi", source: event.id, projectId: event.projectId, date: getVisitDayKey(event.createdAt), issue: "Saha olayında konum kaydı yok", explanation: "Olay kaydı vardır; konum veya sürekli GPS takibi çıkarılamaz.", link: taskLink(event.dailyTaskId) });
  return issues;
}

function sectionsFor(data: ReportData, issues: QualityIssue[], trend: ReportTrend[], filters: Record<string, string>, now: Date): Record<string, ReportSection> {
  const projectNames = new Map(data.projects.map((project) => [project.id, project.name]));
  const name = (projectId: string) => projectNames.get(projectId) ?? data.tasks.find((task) => task.projectId === projectId)?.project.name ?? projectId;
  const { start, end } = period(filters, now);
  const inside = (date: Date) => date >= start && date < end;
  const latest = new Map(data.latestVisits.map((visit) => [visit.projectId, visit]));
  const reference = new Date(end.getTime() - 1);
  const statusLabel = (status: string) => status === "CURRENT" ? "0–15 gün" : status === "WARNING" ? "16–30 gün" : status === "OVERDUE" ? "31+ gün" : "Hiç ziyaret yok";
  const tasks = section("tasks", "Görev kayıtları", ["Görev ID", "Program günü", "Proje", "Görev başlığı", "Durum", "Varış", "Ayrılış", "Ölçülmüş ortak süre (dk)", "Atama", "Göreve bağlı dosya (güncel)", "Yönetici notu"], data.tasks.map((task) => [task.id, dateOf(task), task.project.name, task.title ?? "—", task.status, iso(task.arrivedAt), iso(task.leftAt), measuredTaskMinutes(task) ?? "Bilinmiyor", task.assignees.length, task._count?.files ?? "Bilinmiyor", task.managerNote ?? "—"]), data.tasks.map((task) => taskLink(task.id)), "Görevler program günüyle seçilir. Bağlı not ve dosyalar sonradan eklenmiş olabilir; kişisel süre çıkarılmaz.");
  const assignments = section("assignments", "Tarihsel görev atamaları", ["Atama ID", "Görev ID", "Program günü", "Proje", "Kullanıcı ID", "Kullanıcı", "Ekip ID", "Tarihsel ekip adı", "Tarihsel tür", "Plan mevcudu", "Fiili ekip beyanı", "Varış kanıtı"], data.tasks.flatMap((task) => task.assignees.map((assignment) => [assignment.id ?? `${task.id}:${assignment.userId}`, task.id, dateOf(task), task.project.name, assignment.userId, assignment.user.fullName, assignment.teamId ?? "—", assignment.teamNameSnapshot ?? "—", kindName(assignment), validCount(assignment.headcountSnapshot) ? assignment.headcountSnapshot! : "Bilinmiyor", assignment.workforceKindSnapshot !== "CONTRACTOR" ? "Uygulanmaz" : !task.arrivedAt ? "Varış yok" : validCount(assignment.actualHeadcount) ? assignment.actualHeadcount! : "Bilinmiyor", task.arrivedAt ? "Varış kaydı var (göreve ortak)" : "Varış kaydı yok"])), data.tasks.flatMap((task) => task.assignees.map(() => taskLink(task.id))), "Kullanıcı adı güncel, ekip adı/sınıf/mevcud atama snapshot'ıdır. Göreve ortak varış tüm atanan kişilerin çalıştığını kanıtlamaz.");
  const siteEvents = section("siteEvents", "Saha olayları ve kaydı yapan kişi", ["TaskEvent ID", "Olay zamanı", "Proje", "Görev ID", "Kullanıcı ID", "Kaydı yapan", "Tür", "Konum kanıtı", "Tarih kapsamı"], data.siteEvents.map((event) => [event.id, iso(event.createdAt), name(event.projectId), event.dailyTaskId, event.userId, event.userName, event.type, event.hasLocation ? "Konum kaydı var" : "Konum kaydı yok", inside(event.createdAt) ? "Seçili dönem" : "Bağlı görevin dönem dışı olayı"]), data.siteEvents.map((event) => taskLink(event.dailyTaskId)), "TaskEvent kaynak olayın aktörünü gösterir. Timeline karşılığıyla tekrar sayılmaz; bu olaylar kişisel puantaj veya sürekli konum takibi oluşturmaz.");
  const activity = section("activity", "Kanonik proje günlüğü ve notlar", ["Olay ID", "Kayıt zamanı", "Proje", "Görev ID", "Ziyaret ID", "Yazan kullanıcı ID", "Yazan", "Tür", "Başlık", "İçerik", "Tarih kapsamı"], data.activity.map((event) => [event.id, iso(event.createdAt), name(event.projectId), event.dailyTaskId ?? "—", event.projectVisitId ?? "—", event.userId ?? "—", event.userName, event.eventType, event.title, event.description ?? "—", inside(event.createdAt) ? "Seçili dönem" : "Bağlı görevin dönem dışı kaydı"]), data.activity.map((event) => event.dailyTaskId ? taskLink(event.dailyTaskId) : projectLink(event.projectId)), "NOTE_ADDED notların kanonik kaynağıdır; mevcud düzeltme notları üretim veya çalışma kanıtı sayılmaz. Aynı olayın TaskEvent/ProjectNote karşılığı tekrar sayılmaz.");
  const notesArchive = section("notesArchive", "Eski proje not arşivi", ["Arşiv not ID", "Kayıt zamanı", "Proje", "Kullanıcı ID", "Yazan", "Not"], data.notes.map((note) => [note.id, iso(note.createdAt), name(note.projectId), note.userId, note.userName, note.note]), data.notes.map((note) => projectLink(note.projectId)), "Bu arşiv kanonik günlüğün aynalı kayıtlarını içerebilir; not toplamına eklenmez.");
  const visits = section("visits", "Dönem ziyaretleri", ["Kaynak ID", "Kaynak", "Proje", "Cari", "Ziyaret eden ID", "Ziyaret eden", "Ziyaret zamanı", "Not", "Dosya"], data.visits.map((visit) => [visit.id, visit.source === "LEGACY" ? "Eski program ziyareti" : "Ziyaret", visit.projectName, visit.customerName, visit.userId ?? "—", visit.userName, iso(visit.visitedAt), visit.note ?? "—", visit.fileCount ?? "Bilinmiyor"]), data.visits.map((visit) => ({ href: `/admin/visits/${encodeURIComponent(visit.projectId)}`, label: "Ziyaret geçmişi" })), "Yeni ziyaret ve onun timeline karşılığı bir kez sayılır. Ziyaret eden filtresi dönem listesine uygulanır, son ziyaret gecikmesine uygulanmaz.");
  const files = section("files", "Dosya envanteri", ["Dosya ID", "Yükleme zamanı", "Proje", "Görev ID", "Ziyaret ID", "Yükleyen ID", "Yükleyen", "Dosya adı", "MIME", "Bayt", "Not", "Tarih kapsamı"], data.files.map((file) => [file.id, iso(file.createdAt), name(file.projectId), file.dailyTaskId ?? "—", file.projectVisitId ?? "—", file.uploadedByUserId, file.userName, file.originalName, file.mimeType, file.sizeBytes, file.note ?? "—", inside(file.createdAt) ? "Seçili dönem" : "Bağlı görevin dönem dışı dosyası"]), data.files.map((file) => ({ href: `/api/files/${encodeURIComponent(file.id)}`, label: "Dosyayı aç" })), "Her fiziksel ProjectFile ID bir kez sayılır. Dosya yolları rapora alınmaz; açma bağlantısı mevcut dosya yetkilendirmesini kullanır.");
  const quality = section("quality", "Veri kalitesi bulguları", ["Önem", "Kaynak ID", "Proje", "Gün", "Bulgu", "Açıklama"], issues.map((issue) => [issue.level, issue.source, name(issue.projectId), issue.date, issue.issue, issue.explanation]), issues.map((issue) => issue.link), "Bulgular mevcut kayıtları açıklamak içindir; hiçbir kaynak kayıt otomatik düzeltilmez.");
  const visitsAvailable = data.visitsAvailable !== false;
  const daily = section("daily", "Günlük dönem eğilimi", ["Gün", "Program görevi", "Varışlı görev", "Tamamlandı durumu", "Ölçülmüş ortak süre (dk)", "Kanonik not", "Yüklenen dosya", ...(visitsAvailable ? ["Ziyaret"] : [])], trend.map((day) => [day.date, day.tasks, day.arrived, day.closed, day.minutes, day.notes, day.files, ...(visitsAvailable ? [day.visits] : [])]), undefined, "Görev/varış/tamamlanma/süre program gününe; not, dosya ve ziyaret kendi olay gününe yazılır. Dönem dışı bağlı kayıtlar bu eğilime eklenmez.");
  const projectInfo = section("projectInfo", "Proje kapsamı ve ziyaret durumu", ["Proje ID", "Proje", "Cari ID", "Cari", "İl", "Okuma anındaki kapsam", "Proje oluşturma", "Son ziyaret ID", "Son ziyaret", "Geçen gün", "Ziyaret durumu", "Açıklama"], data.projects.map((project) => { const visit = latest.get(project.id); return [project.id, project.name, project.customer.id, project.customer.name, project.city ?? "—", project.isActive ? "Aktif" : "Arşiv", iso(project.createdAt), visit?.id ?? "—", iso(visit?.visitedAt), visit ? getVisitAgeDays(visit.visitedAt, reference) : "—", project.createdAt >= end ? "Dönemden sonra oluşturuldu" : !project.isActive ? "Arşiv — gecikme hesabı dışında" : statusLabel(getVisitStatus(visit?.visitedAt, reference)), project.description ?? "—"]; }), data.projects.map((project) => projectLink(project.id)), "Aktif/arşiv ve proje/cari adları okuma anındaki değerlerdir; geçmiş durum geçmişi saklanmadığından geriye dönük durum varsayılmaz. Son ziyaret bitiş günü sonuna kadar tüm ziyaret edenleri kapsar.");
  const serverMedia = section("serverMedia", "Sunucu medya işleri", ["İş ID", "Proje", "İş türü", "Okuma anındaki durum", "Oluşturma", "Son güncelleme"], data.mediaJobs.map((job) => [job.id, name(job.projectId), job.kind, job.status, iso(job.createdAt), iso(job.updatedAt)]), data.mediaJobs.map((job) => projectLink(job.projectId)), "Yalnız sunucuda kayıtlı işler görülür. Cihazdaki gönderilmemiş offline kuyruk burada bulunmaz; iş durumu geçmiş dönem sonundaki durumu kanıtlamaz.");
  return { tasks, assignments, siteEvents, activity, notesArchive, visits, files, quality, daily, projectInfo, workforceDaily: workforceDaily(data), serverMedia };
}

function visitTotals(data: ReportData, filters: Record<string, string>, now: Date): Record<string, number> {
  const end = period(filters, now).end;
  const reference = new Date(end.getTime() - 1);
  const latest = new Map(data.latestVisits.map((visit) => [visit.projectId, visit]));
  const active = data.projects.filter((project) => project.isActive && project.createdAt < end);
  const selectedVisits: Record<string, number> = data.visitsAvailable === false ? {} : { "Ziyaret": data.visits.length, "Ziyaret edilen şantiye": new Set(data.visits.map((visit) => visit.projectId)).size };
  return { ...selectedVisits, "16–30 gün": active.filter((project) => getVisitStatus(latest.get(project.id)?.visitedAt, reference) === "WARNING").length, "31+ gün": active.filter((project) => getVisitStatus(latest.get(project.id)?.visitedAt, reference) === "OVERDUE").length, "Hiç ziyaret yok": active.filter((project) => !latest.has(project.id)).length };
}

function operationTotals(data: ReportData, filters: Record<string, string>, now: Date): Record<string, number> {
  const base = buildTaskReport("PROJECT", data.tasks, filters, now).totals;
  const { start, end } = period(filters, now);
  return { ...base, ...visitTotals(data, filters, now), "Varış kaydı olmayan görev": data.tasks.filter((task) => !task.arrivedAt).length, "Süresi doğrulanan görev": data.tasks.filter((task) => measuredTaskMinutes(task) !== null).length, "Ayrılışı kayıtlı görev": data.tasks.filter((task) => task.arrivedAt && task.leftAt && task.leftAt >= task.arrivedAt).length, "Atama kaydı": data.tasks.reduce((sum, task) => sum + task.assignees.length, 0), "Kapsamdaki proje": data.projects.filter((project) => project.createdAt < end).length, "Kanonik not (program kapsamı)": data.activity.filter((event) => event.eventType === "NOTE_ADDED").length, "Dönemdeki kanonik not": data.activity.filter((event) => event.eventType === "NOTE_ADDED" && event.createdAt >= start && event.createdAt < end).length, "Dosya (program kapsamı)": data.files.length, "Dönemde yüklenen dosya": data.files.filter((file) => file.createdAt >= start && file.createdAt < end).length, "Dosya bayt": data.files.reduce((sum, file) => sum + file.sizeBytes, 0), "Sunucu medya işi": data.mediaJobs.length };
}

function reportTotals(type: ReportType, data: ReportData, filters: Record<string, string>, now: Date): Record<string, number> {
  const totals = operationTotals(data, filters, now);
  if (type === "VISIT") return {
    ...visitTotals(data, filters, now),
    "Bağlı ziyaret notu": totals["Kanonik not (program kapsamı)"],
    "Dönemdeki kanonik not": totals["Dönemdeki kanonik not"],
    "Ziyaret eki": data.files.length,
    "Dönemde yüklenen dosya": totals["Dönemde yüklenen dosya"],
    "Ziyaret eki bayt": totals["Dosya bayt"],
  };
  if (type === "MEDIA") return {
    "Dosya (program kapsamı)": totals["Dosya (program kapsamı)"],
    "Dönemde yüklenen dosya": totals["Dönemde yüklenen dosya"],
    "Dosya bayt": totals["Dosya bayt"],
    "Sunucu medya işi": totals["Sunucu medya işi"],
  };
  if (type === "PROJECT" || type === "PERSONNEL" || type === "CUSTOMER" || type === "COMPARISON") {
    // This source is not read for these report types. Absence must not be reported as zero.
    const { "Sunucu medya işi": unreadJobs, ...measured } = totals;
    void unreadJobs;
    return measured;
  }
  return totals;
}

function enrichGroupedRows(base: ReportSnapshot, type: "PROJECT" | "CUSTOMER", data: ReportData, filters: Record<string, string>, now: Date) {
  const { start, end } = period(filters, now);
  const eligible = data.projects.filter((project) => project.createdAt < end);
  const activityProjectIds = new Set([...data.tasks.map((task) => task.projectId), ...data.activity.filter((event) => event.createdAt >= start && event.createdAt < end).map((event) => event.projectId), ...data.visits.map((visit) => visit.projectId), ...data.files.filter((file) => file.createdAt >= start && file.createdAt < end).map((file) => file.projectId)]);
  const scope = eligible.filter((project) => filters.includeInactiveRows === "true" || activityProjectIds.has(project.id));
  const customerByProject = new Map(data.projects.map((project) => [project.id, project.customer.id]));
  const key = (projectId: string) => type === "PROJECT" ? projectId : customerByProject.get(projectId) ?? data.tasks.find((task) => task.projectId === projectId)?.project.customer.id ?? projectId;
  const ids = [...new Set(data.tasks.map((task) => key(task.projectId)))];
  const existing = new Set(ids);
  const dimensions = new Map(scope.map((project) => [key(project.id), project]));
  for (const [id, project] of dimensions) if (!existing.has(id)) {
    base.rows.push([type === "PROJECT" ? project.name : project.customer.name, type === "PROJECT" ? project.customer.name : "Seçili dönemde görev yok", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    base.rowLinks.push(type === "PROJECT" ? projectLink(project.id) : null);
    ids.push(id);
  }
  const notes = new Map<string, number>(), visits = new Map<string, number>(), files = new Map<string, number>();
  const add = (target: Map<string, number>, projectId: string) => target.set(key(projectId), (target.get(key(projectId)) ?? 0) + 1);
  data.activity.filter((event) => event.eventType === "NOTE_ADDED" && event.createdAt >= start && event.createdAt < end).forEach((event) => add(notes, event.projectId));
  data.visits.forEach((visit) => add(visits, visit.projectId));
  data.files.filter((file) => file.createdAt >= start && file.createdAt < end).forEach((file) => add(files, file.projectId));
  base.headers.push(type === "PROJECT" ? "Proje ID" : "Cari ID", "Dönem notu", "Dönem ziyareti", "Dönem dosyası");
  base.rows.forEach((row, index) => { const id = ids[index]; row[3] = type === "PROJECT" ? 1 : new Set([...scope.filter((project) => project.customer.id === id).map((project) => project.id), ...data.tasks.filter((task) => task.project.customer.id === id).map((task) => task.projectId)]).size; row.push(id, notes.get(id) ?? 0, data.visitsAvailable === false ? "Uygulanmaz" : visits.get(id) ?? 0, files.get(id) ?? 0); });
}

function comparisonSection(current: ReportData, previous: ReportData | undefined, filters: Record<string, string>, now: Date) {
  const currentTotals = operationTotals(current, filters, now);
  const { first, last } = period(filters, now);
  const length = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
  const previousFilters = { ...filters, startDate: new Date(first.getTime() - length * 86_400_000).toISOString().slice(0, 10), endDate: new Date(first.getTime() - 86_400_000).toISOString().slice(0, 10) };
  const before = previous ? operationTotals(normalize(previous), previousFilters, now) : null;
  const metrics = ["Görev", "Varış kaydı olan", "Tamamlandı durumu", "Plan katılımı (bilinen)", "Ekip mevcudu/gün (fiili beyan)", "Ölçülmüş ortak görev süresi (dk)", "Süresi eksik başlayan görev", "Mevcudu/sınıfı bilinmeyen atama", "Dönemdeki kanonik not", "Dönemde yüklenen dosya", "Ziyaret"].filter((metric) => metric !== "Ziyaret" || current.visitsAvailable !== false && previous?.visitsAvailable !== false);
  return section("comparison", "Eşit süreli önceki dönem karşılaştırması", ["Metrik", "Önceki dönem", "Seçili dönem", "Fark", "Değişim (%)"], metrics.map((metric) => { const value = currentTotals[metric] ?? 0; const prior = before?.[metric]; return [metric, prior ?? "Bilinmiyor", value, prior === undefined ? "Bilinmiyor" : value - prior, prior === undefined ? "Bilinmiyor" : prior === 0 ? value === 0 ? 0 : "Önceki taban 0 — oran hesaplanmaz" : Math.round(((value - prior) / prior) * 10000) / 100]; }), undefined, `Seçili: ${filters.startDate ?? first.toISOString().slice(0, 10)} – ${filters.endDate ?? last.toISOString().slice(0, 10)}; önceki: ${previousFilters.startDate} – ${previousFilters.endDate} (${length} takvim günü). Filtreler iki dönemde aynıdır; proje durumu her iki dönem için okuma anındaki durumdur.`);
}

/** Reporting projections are read-only. No operation infers personal attendance or edits history. */
export function buildAnalyticsReport(type: ReportType, input: ReportData, filters: Record<string, string>, now = new Date()): ReportSnapshot {
  const data = normalize(input);
  const baseType = type === "PERSONNEL" || type === "CUSTOMER" ? type : "PROJECT";
  const base = buildTaskReport(baseType, data.tasks, filters, now);
  if (type === "PROJECT" || type === "CUSTOMER") enrichGroupedRows(base, type, data, filters, now);
  const issues = qualityIssues(data);
  const trend = makeTrend(data, filters, now);
  const all = sectionsFor(data, issues, trend, filters, now);
  const totals = { ...reportTotals(type, data, filters, now), "Veri kalitesi bulgusu": issues.length, "Hata bulgusu": issues.filter((issue) => issue.level === "Hata").length };
  const definition = [
    ...base.definitions,
    "Program görevi ve görev süreleri program tarihine; not, dosya, ziyaret ve sunucu işi kendi kayıt tarihine göre değerlendirilir. Göreve sonradan eklenen kayıtlar kapsam etiketiyle ayrılır.",
    "Not sayısının kanonik kaynağı NOTE_ADDED proje günlüğüdür. Eski proje not arşivi ayrıca gösterilir ve toplamına eklenmez. Mevcud düzeltme notları gerçek üretim olarak yorumlanmaz.",
    "Ölçülmüş süre, varış/ayrılış zamanlarıyla aynı yuvarlanmış dakikayı veren ortak görev süresidir. Kişiler veya ekipler arasında toplanabilir kişisel puantaj değildir.",
    "Anonim ekip üyelerinin kimliği ve kişisel çalışma süreleri kaydedilmiyor; gerçek benzersiz çalışan veya adam-saat hesaplanamaz.",
    "Kaydedilmiş rapor okuma anındaki sabit snapshot'tır. Aktif/arşiv, proje/cari/kullanıcı adları ve sunucu medya iş durumları okuma anına aittir.",
    "Canlı kaynaklar yalnız halen mevcut kayıtları kapsar. Silinmiş görev/projelerin eksiksiz tarihçesi bu kayıtlardan yeniden kurulamaz; daha önce kaydedilmiş raporlar korunur.",
    "Cihazda henüz gönderilmemiş offline kayıtlar sunucuda bulunmadığından rapor kapsamının dışındadır.",
  ];
  const warnings = [...base.warnings, ...data.warnings];
  if (data.visitsAvailable === false) warnings.push("Ziyaret sayısı bu görev filtresinde okunmadı ve dönem hesaplarına alınmadı. Proje son ziyaret/gecikme özeti bütün ziyaret edenlerden bağımsız okunmuştur.");
  if (data.previous) warnings.push(...buildTaskReport("PROJECT", data.previous.tasks, filters, now).warnings.map((warning) => `Önceki dönem: ${warning}`), ...data.previous.warnings.map((warning) => `Önceki dönem: ${warning}`));
  if ((period(filters, now).last.getTime() - period(filters, now).first.getTime()) / 86_400_000 >= 3660) warnings.push("Çok uzun dönemde günlük eğilim yalnız kayıt bulunan günleri gösterir; kaynak kayıt toplamları kırpılmadı.");
  if (issues.length) warnings.push(`${issues.length} veri kalitesi bulgusu var; ilgili kayıtlar kalite bölümünde açıklanır.`);
  const sections: ReportSection[] = [];
  const choose = (ids: string[]) => ids.forEach((id) => sections.push(all[id]));
  if (type === "PROJECT" || type === "CUSTOMER") choose(["projectInfo", "daily", "tasks", "assignments", "siteEvents", "activity", "notesArchive", "visits", "files", "quality"]);
  else if (type === "PERSONNEL") choose(["workforceDaily", "tasks", "assignments", "siteEvents", "activity", "files", "quality"]);
  else if (type === "VISIT") { const visitTotalsOnly = visitTotals(data, filters, now); base.headers = ["Ziyaret metriği", "Değer"]; base.rows = Object.entries(visitTotalsOnly); base.rowLinks = base.rows.map(() => null); choose(["projectInfo", "visits", "activity", "notesArchive", "files", "quality"]); }
  else if (type === "QUALITY") { const counts = new Map<string, number>(); issues.forEach((issue) => counts.set(issue.issue, (counts.get(issue.issue) ?? 0) + 1)); base.headers = ["Veri kalitesi bulgusu", "Kayıt"]; base.rows = [...counts]; base.rowLinks = base.rows.map(() => null); choose(["quality", "assignments", "tasks", "siteEvents", "serverMedia"]); }
  else if (type === "MEDIA") { const mime = new Map<string, { count: number; bytes: number }>(); for (const file of data.files) { const group = mime.get(file.mimeType) ?? { count: 0, bytes: 0 }; group.count++; group.bytes += file.sizeBytes; mime.set(file.mimeType, group); } base.headers = ["Dosya türü (MIME)", "Dosya", "Bayt"]; base.rows = [...mime].map(([kind, group]) => [kind, group.count, group.bytes]); base.rowLinks = base.rows.map(() => null); choose(["files", "serverMedia", "quality"]); }
  else if (type === "COMPARISON") { const comparison = comparisonSection(data, data.previous, filters, now); base.headers = comparison.headers; base.rows = comparison.rows; base.rowLinks = base.rows.map(() => null); sections.push(comparison); choose(["daily", "quality"]); if (!data.previous) warnings.push("Önceki dönem verisi bulunmuyor; karşılaştırma değerleri bilinmiyor gösterildi."); }
  else { base.headers = ["Operasyon metriği", "Değer"]; base.rows = Object.entries(totals); base.rowLinks = base.rows.map(() => null); choose(["daily", "projectInfo", "workforceDaily", "tasks", "assignments", "siteEvents", "activity", "notesArchive", "visits", "files", "serverMedia", "quality"]); }
  if (type === "PERSONNEL") warnings.push("Personel/ekip satırlarının ortak görev süreleri birbirine eklenmez; genel süre toplamı benzersiz görevlerden hesaplanır.");
  const { details: _details, ...summary } = base;
  void _details;
  const dates = period(filters, now);
  const excludedMetrics = [...(type === "VISIT" ? ["tasks", "arrived", "closed", "minutes"] : []), ...(data.visitsAvailable === false ? ["visits"] : [])];
  return { ...summary, schemaVersion: 3, calculationVersion: "reports-v2.0", generatedAt: now.toISOString(), totals, definitions: definition, warnings: [...new Set(warnings)], sections, trend, ...(excludedMetrics.length ? { excludedMetrics } : {}), metadata: { reportType: type, startDate: filters.startDate ?? dates.first.toISOString().slice(0, 10), endDate: filters.endDate ?? dates.last.toISOString().slice(0, 10), timeZone: APP_TIME_ZONE, dateBasis: "Görevler: program günü; not/dosya/ziyaret: olay zamanı; proje ve sunucu iş durumu: okuma anı", readAt: now.toISOString() } };
}
