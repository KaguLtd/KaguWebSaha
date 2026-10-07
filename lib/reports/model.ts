import type { ReportTask } from "./calculations";
import type { VisitRecord } from "../visits/read";

/** Only reporting uses these projections. They contain no storage paths or credentials. */
export type ReportProject = {
  id: string; name: string; customer: { id: string; name: string };
  city: string | null; description: string | null; isActive: boolean; createdAt: Date;
};
export type ReportActivity = {
  id: string; projectId: string; dailyTaskId: string | null; projectVisitId: string | null;
  userId: string | null; userName: string; eventType: string; title: string;
  description: string | null; createdAt: Date;
};
export type ReportNote = {
  id: string; projectId: string; userId: string; userName: string; note: string; createdAt: Date;
};
export type ReportFile = {
  id: string; projectId: string; dailyTaskId: string | null; projectVisitId: string | null;
  uploadedByUserId: string; userName: string; originalName: string; mimeType: string;
  sizeBytes: number; note: string | null; createdAt: Date; scope: "TASK" | "PERIOD";
};
export type ReportSiteEvent = {
  id: string; projectId: string; dailyTaskId: string; userId: string; userName: string;
  type: string; createdAt: Date; hasLocation: boolean;
};
export type ReportMediaJob = {
  id: string; projectId: string; kind: "UPLOAD" | "HEIC" | "THUMBNAIL";
  status: string; createdAt: Date; updatedAt: Date;
};
export type ReportData = {
  projects: ReportProject[]; tasks: ReportTask[]; activity: ReportActivity[];
  notes: ReportNote[]; files: ReportFile[]; siteEvents: ReportSiteEvent[];
  visits: VisitRecord[]; latestVisits: VisitRecord[]; mediaJobs: ReportMediaJob[];
  warnings: string[]; previous?: ReportData; visitsAvailable?: boolean;
};
export type ReportSection = {
  id: string; title: string; description?: string; headers: string[];
  rows: Array<Array<string | number>>;
  rowLinks?: Array<{ href: string; label: string } | null>;
};
export type ReportMetadata = {
  reportId?: string; title?: string; reportType: string; startDate: string; endDate: string;
  timeZone: string; dateBasis: string; readAt: string; createdByUserId?: string; createdByName?: string;
};
export type ReportTrend = {
  date: string; tasks: number; arrived: number; closed: number; minutes: number;
  notes: number; files: number; visits: number;
};
