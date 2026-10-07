import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { APP_TIME_ZONE } from "../dates/today";
import { buildAnalyticsReport } from "./analytics";
import { previousPeriod, serializeCriteria } from "./criteria";
import type { ReportCriteria } from "./criteria";
import { readReportData } from "./read";
import type { ReportSnapshot } from "./calculations";
import { ReportError } from "./errors";
export { parseReportCriteria, REPORT_NAMES, serializeCriteria } from "./criteria";
export type { ReportCriteria } from "./criteria";

export function assertReportSize(snapshot: ReportSnapshot) {
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 8_000_000) throw new ReportError("Rapor çıktı boyutu sınırını aşıyor. Tarih veya proje filtresini daraltın; kayıtlar kırpılmadı.");
}

export async function buildReport(criteria: ReportCriteria, database = prisma): Promise<ReportSnapshot> {
  const now = new Date();
  const { data, labels } = await database.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [project, customer, person, team] = await Promise.all([
      criteria.projectId ? tx.project.findUnique({ where: { id: criteria.projectId }, select: { name: true, customerId: true } }) : null,
      criteria.customerId ? tx.customer.findUnique({ where: { id: criteria.customerId }, select: { name: true } }) : null,
      criteria.personnelId ? tx.user.findUnique({ where: { id: criteria.personnelId }, select: { fullName: true } }) : null,
      criteria.teamId ? tx.team.findUnique({ where: { id: criteria.teamId }, select: { name: true } }) : null,
    ]);
    if (criteria.projectId && !project || criteria.customerId && !customer || criteria.personnelId && !person || criteria.teamId && !team) throw new ReportError("Filtredeki proje, cari, kullanıcı veya ekip bulunamadı.");
    if (project && criteria.customerId && project.customerId !== criteria.customerId) throw new ReportError("Seçilen proje bu cariye ait değil.");
    const data = await readReportData(criteria, tx);
    if (criteria.reportType === "COMPARISON") data.previous = await readReportData(previousPeriod(criteria), tx);
    const statusNames = { ALL: "Tümü", PLANNED: "Planlandı durumu", ON_SITE: "Sahada durumu", COMPLETED: "Tamamlandı durumu" };
    const kindNames = { ALL: "Tümü", PERSONNEL: "Personel", CONTRACTOR: "Taşeron ekip", OBSERVER: "Saha kontrol", UNKNOWN: "Tarihsel sınıf bilinmiyor" };
    const labels: Record<string, string> = {
      ...(project ? { Proje: project.name } : {}), ...(customer ? { Cari: customer.name } : {}),
      ...(person ? { Kullanıcı: person.fullName } : {}), ...(team ? { Ekip: team.name } : {}),
      Kapsam: criteria.projectState === "ACTIVE" ? "Şu anda aktif projeler" : criteria.projectState === "ARCHIVED" ? "Şu anda arşiv projeler" : "Aktif ve arşiv",
      "Saat dilimi": APP_TIME_ZONE,
      ...(criteria.reportType !== "VISIT" ? { Durum: statusNames[criteria.status], "İşgücü": kindNames[criteria.workforce] } : {}),
      "Faaliyetsiz satırlar": criteria.includeInactiveRows ? "Dahil" : "Hariç",
      "Atama kapsamı": criteria.personnelId || criteria.teamId || criteria.workforce !== "ALL" ? "Yalnız filtreye uyan atamalar; görev durumları ve süre göreve ortak" : "Tüm görev atamaları",
    };
    return { data, labels };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 15_000 });
  const snapshot = buildAnalyticsReport(criteria.reportType, data, serializeCriteria(criteria), now);
  snapshot.filterLabels = labels;
  assertReportSize(snapshot);
  return snapshot;
}
