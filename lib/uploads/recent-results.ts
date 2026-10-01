import { prisma } from "@/lib/db/prisma";
import { canReadProjectFile, projectFileAccessInclude, type FileAccessUser } from "@/lib/files/access";

export type RecentUploadResult = {
  uploadId: string;
  originalName: string;
  completedAt: string;
  projectFileId: string | null;
  status: "READY" | "PROCESSING" | "FAILED";
  canRead: boolean;
};

export async function readRecentUploadResults(user: FileAccessUser, client = prisma, now = new Date()): Promise<RecentUploadResult[]> {
  const sessions = await client.uploadSession.findMany({
    where: { uploadedByUserId: user.id, status: "COMPLETED", completedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }], take: 100,
    select: { id: true, originalName: true, completedAt: true, projectFileId: true },
  });
  if (sessions.length === 0) return [];
  const fileIds = sessions.flatMap((session) => session.projectFileId ? [session.projectFileId] : []);
  const [files, jobs] = await Promise.all([
    fileIds.length ? client.projectFile.findMany({ where: { id: { in: fileIds }, uploadedByUserId: user.id }, include: projectFileAccessInclude(user.id) }) : [],
    client.heicConversionJob.findMany({ where: { uploadSessionId: { in: sessions.map((session) => session.id) }, uploadedByUserId: user.id }, select: { uploadSessionId: true, status: true } }),
  ]);
  const filesById = new Map(files.map((file) => [file.id, file]));
  const jobsById = new Map(jobs.map((job) => [job.uploadSessionId, job]));
  return sessions.map((session) => {
    const file = session.projectFileId ? filesById.get(session.projectFileId) : undefined;
    const failed = jobsById.get(session.id)?.status === "FAILED";
    const canRead = Boolean(file && canReadProjectFile(user, file));
    return { uploadId: session.id, originalName: session.originalName,
      completedAt: (session.completedAt ?? now).toISOString(), projectFileId: canRead ? file!.id : null,
      status: file ? "READY" : failed ? "FAILED" : "PROCESSING", canRead };
  });
}
