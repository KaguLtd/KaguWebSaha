import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { getDateOnlyRangeInAppTimeZone, getTodayDateOnly } from "@/lib/dates/today";
import { recordProjectUpload, scheduleHeicConversionProcessing } from "@/lib/files/heic-conversion-jobs";
import { saveProjectUpload } from "@/lib/files/storage";
import { formatSiteDurationMinutes } from "@/lib/format/duration";
import { parseLatitude, parseLongitude } from "@/lib/location/google-maps";
import { runOfflineOperation } from "@/lib/offline/server-operation";
import { InputError } from "@/lib/offline/input-error";
import { eventOccurredAt } from "@/lib/personnel/event-policy";
import { canWriteTaskDay, DELAYED_TASK_WRITE_ERROR } from "@/lib/personnel/delayed-write-policy";

type Payload = FormData | Record<string, unknown>;
type EventType = "ARRIVED_SITE" | "LEFT_SITE" | "NOTE";
function value(payload: Payload, name: string) { return payload instanceof FormData ? payload.get(name) : payload[name]; }
function text(payload: Payload, name: string) { return String(value(payload, name) ?? "").trim(); }

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Oturum süresi doldu." }, { status: 401 });
  if (user.role !== "PERSONNEL") return NextResponse.json({ error: "Yetkisiz kayıt işlemi." }, { status: 403 });
  try {
    const payload: Payload = request.headers.get("content-type")?.includes("application/json") ? await request.json() : await request.formData();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new InputError("Geçersiz istek verisi.");
    if (text(payload, "ownerUserId") && text(payload, "ownerUserId") !== user.id) return NextResponse.json({ error: "Hesap değişti. Bu kullanıcıya ait kayıtlar cihazda korunuyor." }, { status: 401 });
    const taskId = text(payload, "taskId");
    const type = text(payload, "type") as EventType;
    const note = text(payload, "note");
    if (!taskId) throw new InputError("Görev bilgisi eksik.");
    if (!["ARRIVED_SITE", "LEFT_SITE", "NOTE"].includes(type)) throw new InputError("Geçersiz personel kayıt tipi.");
    if (type === "NOTE" && !note) throw new InputError("Not alanı boş bırakılamaz.");
    if (note.length > 20_000) throw new InputError("Not en fazla 20000 karakter olabilir.");
    const latitude = parseLatitude(text(payload, "latitude"));
    const longitude = parseLongitude(text(payload, "longitude"));
    const location = latitude !== null && longitude !== null && !(latitude === 0 && longitude === 0) ? { latitude, longitude } : { latitude: null, longitude: null };
    const files = payload instanceof FormData ? payload.getAll("files").filter((file): file is File => file instanceof File && file.size > 0) : [];
    if (files.length > 20 || files.some((file) => file.size > 100 * 1024 * 1024) || files.reduce((total, file) => total + file.size, 0) > 500 * 1024 * 1024) {
      throw new InputError("Dosya sayısı veya boyutu izin verilen sınırı aşıyor.");
    }
    const occurredAtText = text(payload, "occurredAt");
    const actualValue = text(payload, "actualHeadcount");
    const actualHeadcount = actualValue ? Number(actualValue) : undefined;
    if (actualHeadcount !== undefined && (!Number.isInteger(actualHeadcount) || actualHeadcount < 0 || actualHeadcount > 500)) throw new InputError("Ekip mevcudu 0–500 arasında tam sayı olmalı.");
    const operationPayload: Prisma.InputJsonObject = { taskId, type, note, occurredAt: occurredAtText, latitude: location.latitude, longitude: location.longitude,
      actualHeadcount: actualHeadcount ?? null, files: files.map((file) => ({ name: file.name, size: file.size, type: file.type })) };
    const result = await runOfflineOperation({ userId: user.id, clientItemId: text(payload, "clientItemId") || undefined, type, payload: operationPayload }, async (tx) => {
      // Shared task status affects every assignee. A short global transition
      // lock also prevents overlapping shared tasks from starting concurrently.
      // Prisma cannot deserialize PostgreSQL void. Cast only the result; the
      // transaction lock still serializes overlapping arrival/departure writes.
      if (type !== "NOTE") await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('kagu-saha-site-events'))::text`;
      // Receipt inserts hold a foreign-key KEY SHARE lock on users. FOR UPDATE
      // would deadlock with another receipt waiting for the advisory lock.
      // We change only non-key fields, so NO KEY UPDATE safely serializes writes
      // while remaining compatible with receipt/media foreign-key checks.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR NO KEY UPDATE`;
      await tx.$queryRaw`SELECT id FROM daily_tasks WHERE id = ${taskId} FOR NO KEY UPDATE`;
      const today = getTodayDateOnly();
      const task = await tx.dailyTask.findFirst({ where: { id: taskId, taskDate: { lte: today }, assignees: { some: { userId: user.id } } },
        include: { assignees: true } });
      if (!task) throw new InputError("Görev bulunamadı veya bu personele atanmamış.");
      const now = new Date();
      const occurredAt = occurredAtText ? eventOccurredAt(occurredAtText, task.taskDate, now) : now;
      const isToday = task.taskDate.getTime() === today.getTime();
      if (type !== "NOTE" && !isToday && (!occurredAtText || today.getTime() - task.taskDate.getTime() > 7 * 86_400_000)) {
        throw new InputError("Geçmiş saha olayı otomatik uygulanamadı. Kayıt cihazda korundu; yönetici kontrolü gerekiyor.");
      }
      if (type === "NOTE") {
        if (!canWriteTaskDay(task.taskDate, today)) throw new InputError(DELAYED_TASK_WRITE_ERROR);
        await tx.taskEvent.create({ data: { dailyTaskId: task.id, projectId: task.projectId, userId: user.id, type: "NOTE_ADDED", note, createdAt: occurredAt } });
        await tx.projectNote.create({ data: { projectId: task.projectId, userId: user.id, note, createdAt: occurredAt } });
        await tx.projectTimelineEvent.create({ data: { projectId: task.projectId, dailyTaskId: task.id, userId: user.id, eventType: "NOTE_ADDED", title: "Personel not ekledi", description: note, createdAt: occurredAt } });
        // Compatibility for already-open V1 forms; V1.1 sends media separately.
        for (const file of files) {
          const upload = await saveProjectUpload(file, task.projectId);
          if (upload) await recordProjectUpload(upload, { projectId: task.projectId, dailyTaskId: task.id, uploadedByUserId: user.id, note, timelineTitle: "Personel dosya ekledi" }, tx);
        }
      } else if (type === "ARRIVED_SITE") {
        if (isToday && task.status === "COMPLETED") throw new InputError("Tamamlanmış görev yeniden başlatılamaz.");
        if (task.leftAt && occurredAt > task.leftAt) throw new InputError("Varış zamanı mevcut ayrılıştan sonra olamaz.");
        if (isToday) {
          const active = await tx.dailyTask.findFirst({ where: { id: { not: task.id }, taskDate: today, status: "ON_SITE", assignees: { some: { userId: { in: task.assignees.map((assignment) => assignment.userId) } } } }, select: { id: true } });
          if (active) throw new InputError("Önce aktif sahadaki görevi kapatmalısın.");
        }
        await tx.dailyTask.update({ where: { id: task.id }, data: { ...(isToday ? { status: "ON_SITE" } : {}), arrivedAt: task.arrivedAt ?? occurredAt } });
        const assignment = task.assignees.find((item) => item.userId === user.id)!;
        if (assignment.workforceKindSnapshot === "CONTRACTOR" && actualHeadcount !== undefined) {
          await tx.dailyTaskAssignee.update({ where: { id: assignment.id }, data: { actualHeadcount } });
        } else if (actualHeadcount !== undefined && assignment.workforceKindSnapshot !== "CONTRACTOR") throw new InputError("Bu görev bir taşeron ekip ataması değil.");
        await writeSiteEvent(tx, task, user.id, type, occurredAt, location, null);
      } else {
        if (!task.arrivedAt) throw new InputError("Sahadan ayrılmadan önce varış kaydı gerekiyor.");
        if (occurredAt < task.arrivedAt) throw new InputError("Ayrılış zamanı varıştan önce olamaz.");
        const range = getDateOnlyRangeInAppTimeZone(task.taskDate);
        const savedNote = await tx.projectTimelineEvent.findFirst({ where: { dailyTaskId: task.id, userId: user.id, eventType: "NOTE_ADDED", createdAt: { gte: range.start, lt: range.end } }, select: { id: true } });
        if (!savedNote) throw new InputError("Bugün yaptıklarının notunu yaz!");
        const durationMinutes = Math.max(0, Math.round((occurredAt.getTime() - task.arrivedAt.getTime()) / 60_000));
        if (!task.leftAt) await tx.dailyTask.update({ where: { id: task.id }, data: { status: "COMPLETED", leftAt: occurredAt, durationMinutes } });
        await writeSiteEvent(tx, task, user.id, type, occurredAt, location, `Sahada geçen süre: ${formatSiteDurationMinutes(durationMinutes)}`);
      }
      if (type !== "NOTE" && location.latitude !== null && location.longitude !== null) {
        await tx.user.updateMany({ where: { id: user.id, OR: [{ lastLocationAt: null }, { lastLocationAt: { lte: occurredAt } }] }, data: { lastLatitude: location.latitude, lastLongitude: location.longitude, lastLocationAt: occurredAt } });
      }
      return { ok: true, taskId: task.id };
    });
    // A scheduler failure after commit must not turn a saved note into an error.
    if (files.length) { try { scheduleHeicConversionProcessing(); } catch { /* Worker will pick persisted jobs up. */ } }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kayıt kaydedilemedi.";
    const invalid = error instanceof InputError || error instanceof SyntaxError;
    if (!invalid) {
      // Error messages/metadata can contain query values; log only error codes.
      const code = error && typeof error === "object" && "code" in error && /^P\d{4}$/.test(String(error.code)) ? String(error.code) : "UNKNOWN";
      const meta = error && typeof error === "object" && "meta" in error ? error.meta : undefined;
      const sqlState = meta && typeof meta === "object" && "code" in meta && /^[0-9A-Z]{5}$/.test(String(meta.code)) ? String(meta.code) : undefined;
      console.error("[personnel-sync] Persistence failed; device record retained.", { code, ...(sqlState ? { sqlState } : {}) });
    }
    return NextResponse.json({ error: invalid ? message : "Sunucu kaydı şu anda tamamlayamadı. Cihazdaki kayıt korunuyor." }, { status: invalid ? 400 : 503 });
  }
}

async function writeSiteEvent(tx: Prisma.TransactionClient, task: { id: string; projectId: string }, userId: string, type: "ARRIVED_SITE" | "LEFT_SITE", occurredAt: Date,
  location: { latitude: number | null; longitude: number | null }, description: string | null) {
  await tx.taskEvent.create({ data: { dailyTaskId: task.id, projectId: task.projectId, userId, type, ...location, createdAt: occurredAt } });
  await tx.projectTimelineEvent.create({ data: { projectId: task.projectId, dailyTaskId: task.id, userId, eventType: type,
    title: type === "ARRIVED_SITE" ? "Sahaya ulaşıldı" : "Sahadan ayrıldı",
    description: description ?? (location.latitude !== null && location.longitude !== null ? `Konum: ${location.latitude}, ${location.longitude}` : null), createdAt: occurredAt } });
}
