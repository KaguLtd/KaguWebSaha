import type { Prisma } from "@prisma/client";
import { parseDateOnly, toDateInputValue } from "../dates/calendar";
import type { ReportType } from "./calculations";
import { ReportError } from "./errors";

export const REPORT_NAMES: Record<ReportType, string> = {
  PROJECT: "Proje Saha Faaliyet Raporu", PERSONNEL: "Personel / Ekip Katılım Raporu",
  CUSTOMER: "Cari Saha Raporu", VISIT: "Ziyaret ve Kontrol Raporu",
  OPERATIONS: "Operasyon Özeti", QUALITY: "Veri Kalitesi Raporu",
  MEDIA: "Medya / Belge Envanteri", COMPARISON: "Dönem Karşılaştırması",
};
export type ReportCriteria = {
  reportType: ReportType; startDate: Date; endDate: Date; projectId: string; customerId: string;
  personnelId: string; teamId: string; status: "ALL" | "PLANNED" | "ON_SITE" | "COMPLETED";
  workforce: "ALL" | "PERSONNEL" | "CONTRACTOR" | "OBSERVER" | "UNKNOWN";
  projectState: "ALL" | "ACTIVE" | "ARCHIVED"; includeInactiveRows: boolean;
};
export function parseReportCriteria(form: FormData): ReportCriteria {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const reportType = text("reportType") as ReportType;
  if (!Object.hasOwn(REPORT_NAMES, reportType)) throw new ReportError("Geçerli bir rapor tipi seçin.");
  const first = parseDateOnly(text("startDate")), last = parseDateOnly(text("endDate"));
  if (!first || !last) throw new ReportError("Geçerli başlangıç ve bitiş tarihleri zorunludur.");
  const startDate = first <= last ? first : last, endDate = first <= last ? last : first;
  if (startDate.getUTCFullYear() < 1000 || (endDate.getTime() - startDate.getTime()) / 86_400_000 + 1 > 3660) throw new ReportError("Rapor dönemi en fazla 3.660 takvim günü olabilir. Tarih aralığını daraltın.");
  const status = text("status") || "ALL", workforce = text("workforce") || "ALL", projectState = text("projectState") || "ALL";
  if (!["ALL", "PLANNED", "ON_SITE", "COMPLETED"].includes(status) || !["ALL", "PERSONNEL", "CONTRACTOR", "OBSERVER", "UNKNOWN"].includes(workforce) || !["ALL", "ACTIVE", "ARCHIVED"].includes(projectState)) throw new ReportError("Rapor filtreleri geçersiz.");
  const ids = { projectId: text("projectId"), customerId: text("customerId"), personnelId: text("personnelId"), teamId: text("teamId") };
  if (Object.values(ids).some((id) => id.length > 120)) throw new ReportError("Filtre kimliği çok uzun.");
  if (["VISIT", "MEDIA"].includes(reportType) && (ids.teamId || status !== "ALL" || workforce !== "ALL")) throw new ReportError("Ziyaret ve medya raporlarında görev durumu ve ekip/işgücü filtresi kullanılamaz.");
  return { reportType, startDate, endDate, ...ids, status: status as ReportCriteria["status"], workforce: workforce as ReportCriteria["workforce"], projectState: projectState as ReportCriteria["projectState"], includeInactiveRows: ["true", "on", "1"].includes(text("includeInactiveRows")) };
}
export function serializeCriteria(criteria: ReportCriteria): Record<string, string> {
  return { ...criteria, startDate: toDateInputValue(criteria.startDate), endDate: toDateInputValue(criteria.endDate), includeInactiveRows: String(criteria.includeInactiveRows) };
}
export function projectWhere(criteria: ReportCriteria): Prisma.ProjectWhereInput {
  return { ...(criteria.projectId ? { id: criteria.projectId } : {}), ...(criteria.customerId ? { customerId: criteria.customerId } : {}), ...(criteria.projectState !== "ALL" ? { isActive: criteria.projectState === "ACTIVE" } : {}) };
}
export function assignmentWhere(criteria: ReportCriteria): Prisma.DailyTaskAssigneeWhereInput {
  return { ...(criteria.personnelId ? { userId: criteria.personnelId } : {}), ...(criteria.teamId ? { teamId: criteria.teamId } : {}), ...(criteria.workforce !== "ALL" ? { workforceKindSnapshot: criteria.workforce === "UNKNOWN" ? null : criteria.workforce } : {}) };
}
export function previousPeriod(criteria: ReportCriteria): ReportCriteria {
  const days = Math.round((criteria.endDate.getTime() - criteria.startDate.getTime()) / 86_400_000) + 1;
  const startDate = new Date(criteria.startDate.getTime() - days * 86_400_000);
  if (startDate.getUTCFullYear() < 1000) throw new ReportError("Karşılaştırmanın önceki dönemi desteklenen tarih sınırının dışında.");
  return { ...criteria, endDate: new Date(criteria.startDate.getTime() - 86_400_000), startDate };
}
