import type { Prisma, UploadSession, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getTodayDateOnly } from "@/lib/dates/today";
import { canWriteTaskDay, DELAYED_TASK_WRITE_ERROR, taskAgeDays } from "@/lib/personnel/delayed-write-policy";
import { MAX_UPLOAD_BYTES } from "@/lib/files/storage";
import { UploadProtocolError, UPLOAD_SESSION_TTL_MS } from "./protocol";

type User = { id: string; role: UserRole };
type Client = typeof prisma | Prisma.TransactionClient;
export type UploadContext = { projectId: string; dailyTaskId?: string | null; projectVisitId?: string | null };

export async function uploadUser(request?: Request): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new UploadProtocolError("Oturum suresi doldu. Giris yapip tekrar deneyin.", 401);
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    // Same-origin browser writes only; non-browser requests without Origin still require a session.
    if (origin && origin !== new URL(request.url).origin && origin !== process.env.APP_ORIGIN) {
      throw new UploadProtocolError("Gecersiz istek kaynagi.", 403);
    }
  }
  return { id: user.id, role: user.role };
}

export async function requireUploadContext(user: User, context: UploadContext, client: Client = prisma, options: { completedAcknowledgement?: boolean } = {}) {
  const project = await client.project.findUnique({ where: { id: context.projectId }, select: { id: true, isActive: true } });
  if (!project) throw new UploadProtocolError("Proje bulunamadi.", 404);
  if (user.role === "OBSERVER" && !project.isActive) throw new UploadProtocolError("Arsiv projeye dosya ekleyemezsiniz.", 403);
  if (user.role === "PERSONNEL") {
    if (!context.dailyTaskId || context.projectVisitId) throw new UploadProtocolError("Personel gorev bilgisi gerekli.", 403);
    const today = getTodayDateOnly();
    const task = await client.dailyTask.findFirst({ where: {
      id: context.dailyTaskId, projectId: context.projectId, taskDate: { lte: today }, assignees: { some: { userId: user.id } },
    }, select: { id: true, taskDate: true } });
    if (!task) throw new UploadProtocolError("Bu goreve dosya ekleme yetkiniz yok.", 403);
    const age = taskAgeDays(task.taskDate, today);
    if (age === null || age < 0) throw new UploadProtocolError("Görev günü geçersiz veya gelecekte.", 403);
    if (age > 0 && !project.isActive) throw new UploadProtocolError("Arşiv projeye geçmiş görev dosyası eklenemez.", 403);
    // A committed result can still acknowledge a lost response after day seven.
    // It never grants permission for another chunk or a new publication.
    if (!options.completedAcknowledgement && !canWriteTaskDay(task.taskDate, today)) {
      throw new UploadProtocolError(DELAYED_TASK_WRITE_ERROR, 403);
    }
  } else if (context.dailyTaskId) {
    const task = await client.dailyTask.findFirst({ where: { id: context.dailyTaskId, projectId: context.projectId }, select: { id: true } });
    if (!task || user.role !== "ADMIN") throw new UploadProtocolError("Bu goreve dosya ekleme yetkiniz yok.", 403);
  }
  if (context.projectVisitId) {
    const visit = await client.projectVisit.findFirst({ where: {
      id: context.projectVisitId, projectId: context.projectId,
      ...(user.role === "OBSERVER" ? { visitedByUserId: user.id } : {}),
    }, select: { id: true } });
    if (!visit) throw new UploadProtocolError("Bu ziyarete dosya ekleme yetkiniz yok.", 403);
  }
}

export function uploadStatus(session: UploadSession) {
  return { ok: true, uploadId: session.id, status: session.status,
    offsetBytes: Number(session.offsetBytes), sizeBytes: Number(session.sizeBytes),
    projectFileId: session.projectFileId, expiresAt: session.expiresAt.toISOString(), completedAt: session.completedAt?.toISOString() ?? null,
    processing: session.status === "COMPLETED" && !session.projectFileId };
}

export async function ownedUpload(uploadId: string, user: User, client: Client = prisma) {
  const session = await client.uploadSession.findFirst({ where: { id: uploadId, uploadedByUserId: user.id } });
  if (!session) throw new UploadProtocolError("Yukleme bulunamadi.", 404);
  await requireUploadContext(user, session, client, { completedAcknowledgement: session.status === "COMPLETED" });
  return session;
}

export async function withUploadLock<T>(uploadId: string, user: User, run: (session: UploadSession, tx: Prisma.TransactionClient) => Promise<T>) {
  const token = randomUUID();
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.uploadSession.updateMany({ where: {
      id: uploadId, uploadedByUserId: user.id,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    }, data: { lockedBy: token, lockedUntil: new Date(now.getTime() + 120_000) } });
    if (claimed.count !== 1) throw new UploadProtocolError("Yukleme baska bir ekranda suruyor; biraz sonra tekrar deneyin.", 409);
    // The update holds the PostgreSQL row lock through every filesystem write and commit.
    const session = await ownedUpload(uploadId, user, tx);
    const result = await run(session, tx);
    await tx.uploadSession.updateMany({ where: { id: uploadId, lockedBy: token }, data: { lockedBy: null, lockedUntil: null } });
    return result;
  }, { maxWait: 10_000, timeout: 60_000 });
}

export function ensureOpenUpload(session: UploadSession) {
  if (session.status !== "OPEN") throw new UploadProtocolError("Bu yukleme artik dosya parcasi kabul etmiyor.", 409, Number(session.offsetBytes));
  if (session.expiresAt <= new Date()) throw new UploadProtocolError("Yukleme oturumu suresi doldu. Dosyayi yeniden baslatin.", 410, Number(session.offsetBytes));
}

export function readUploadMetadata(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new UploadProtocolError("Yukleme bilgisi gecersiz.", 400);
  const data = input as Record<string, unknown>;
  const text = (key: string, required = false, max = 512) => {
    const value = typeof data[key] === "string" ? data[key].trim() : "";
    if ((required && !value) || value.length > max) throw new UploadProtocolError("Yukleme bilgisi eksik veya cok uzun.", 400);
    return value;
  };
  const sizeBytes = data.sizeBytes;
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
    throw new UploadProtocolError("Dosya boyutu 100 MB limitini asamaz veya bos olamaz.", 413);
  }
  return {
    clientUploadId: text("clientUploadId", true, 200), projectId: text("projectId", true, 128),
    dailyTaskId: text("dailyTaskId", false, 128) || null, projectVisitId: text("projectVisitId", false, 128) || null,
    originalName: text("originalName", true), mimeType: text("mimeType", false, 128) || "application/octet-stream",
    sizeBytes: BigInt(sizeBytes), note: text("note", false, 20_000) || null,
  };
}

export function uploadError(error: unknown) {
  if (error instanceof UploadProtocolError) return NextResponse.json({ ok: false, error: error.message, ...(error.offsetBytes !== undefined ? { offsetBytes: error.offsetBytes } : {}) }, { status: error.status });
  console.warn("[uploads] Request could not complete; staged data is retained.");
  return NextResponse.json({ ok: false, error: "Yukleme tamamlanamadi. Kayit cihazda korunur; tekrar deneyin." }, { status: 503 });
}

export function renewedUploadExpiry() { return new Date(Date.now() + UPLOAD_SESSION_TTL_MS); }
