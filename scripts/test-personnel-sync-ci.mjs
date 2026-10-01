import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { guardedCiDatabaseUrl } from "./test-migrations-ci.mjs";

// This process only runs after the isolated CI migration job. No dotenv loading,
// real accounts, live database or live upload directory are used.
async function main() {
  const databaseUrl = guardedCiDatabaseUrl(process.env);
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ datasourceUrl: databaseUrl, log: [] });
  let storage;
  let unregister;
  try {
    const identity = await client.$queryRaw`SELECT current_database()::text AS database, current_user::text AS username`;
    assert.equal(identity[0].database, "kagu_saha_ci_v11");
    assert.equal(identity[0].username, "kagu_ci");
    const migrations = await client.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.ok(migrations.some((row) => row.migration_name === "20260930000000_v1_1_media_and_teams"));

    // Prove the original failure against real Prisma/PostgreSQL. Reading the
    // void result aborts the transaction even though PostgreSQL acquired the lock.
    await assert.rejects(client.$transaction((tx) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ci-original-site-lock'))`),
      (error) => error.code === "P2010" && /void/.test(error.meta?.message ?? error.message));
    console.log("Reproduced original Prisma/PostgreSQL void-result failure.");

    storage = await mkdtemp(path.join(tmpdir(), "kagu-personnel-ci-"));
    process.env.UPLOAD_DIR = storage;
    process.env.MEDIA_WORKER_MODE = "external";
    process.env.APP_ORIGIN = "http://personnel-ci.test";
    globalThis.__personnelCiDb = client;
    globalThis.__personnelCiUser = { id: "ci-sync-person", role: "PERSONNEL" };
    const mocks = {
      db: "export const prisma = globalThis.__personnelCiDb;",
      auth: "export async function getCurrentUser() { return globalThis.__personnelCiUser; }",
      response: "export const NextResponse = { json: (body, init) => Response.json(body, init) }; export function after() {}",
      cache: "export function revalidatePath() {}",
    };
    const hooks = registerHooks({
      resolve(specifier, context, next) {
        const key = ({ "@/lib/db/prisma": "db", "@/lib/auth/session": "auth", "next/server": "response", "next/cache": "cache" })[specifier];
        return key ? { url: `personnel-ci:${key}`, shortCircuit: true } : next(specifier, context);
      },
      load(url, context, next) {
        return url.startsWith("personnel-ci:") ? { format: "module", source: mocks[url.slice("personnel-ci:".length)], shortCircuit: true } : next(url, context);
      },
    });
    unregister = () => hooks.deregister();
    const { getTodayDateOnly } = await import("../lib/dates/today.ts");
    const sync = await import("../app/api/offline/sync/route.ts");
    const uploads = await import("../app/api/uploads/route.ts");
    const chunks = await import("../app/api/uploads/[uploadId]/route.ts");
    const finalize = await import("../app/api/uploads/[uploadId]/finalize/route.ts");
    const { resolveStoragePath } = await import("../lib/files/storage.ts");
    const user = await client.user.create({ data: { id: "ci-sync-person", username: "ci-sync-person", fullName: "Synthetic sync person", role: "PERSONNEL", passwordHash: "ci-no-login-hash" } });
    const customer = await client.customer.create({ data: { name: "Synthetic sync customer" } });
    const project = await client.project.create({ data: { name: "Synthetic sync project", customerId: customer.id } });
    const taskData = { taskDate: getTodayDateOnly(), projectId: project.id, title: "Synthetic sync task", createdByUserId: "ci-admin", assignees: { create: { userId: user.id } } };
    const task = await client.dailyTask.create({ data: taskData });
    // Receipt FK checks acquire KEY SHARE on the user. With the original
    // FOR UPDATE, two claims can deadlock while one waits for the advisory lock.
    let claims = 0;
    let releaseClaims;
    const bothClaimed = new Promise((resolve) => { releaseClaims = resolve; });
    const originalLockResults = await Promise.allSettled([1, 2].map((index) => client.$transaction(async (tx) => {
      await tx.offlinePendingItem.create({ data: { userId: user.id, clientItemId: `ci-original-user-lock-${index}`, type: "ARRIVED_SITE", payload: {}, status: "PENDING" } });
      if (++claims === 2) releaseClaims();
      await bothClaimed;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ci-original-user-lock'))::text`;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
    }, { timeout: 30_000 })));
    const originalFailures = originalLockResults.filter((result) => result.status === "rejected");
    assert.equal(originalFailures.length, 1);
    assert.equal(originalFailures[0].reason.code, "P2010");
    assert.equal(originalFailures[0].reason.meta?.code, "40P01");
    console.log("Reproduced original receipt/user-lock deadlock (40P01).");
    const origin = process.env.APP_ORIGIN;
    const jsonRequest = (url, body) => new Request(`${origin}${url}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
    const send = (type, id, extra = {}) => sync.POST(jsonRequest("/api/offline/sync", {
      ownerUserId: user.id, taskId: task.id, type, clientItemId: id, occurredAt: new Date().toISOString(), ...extra,
    }));
    async function acknowledged(response, label) {
      const body = await response.json();
      assert.equal(response.status, 200, `${label}: ${response.status}; ${body.error ?? "no error"}`);
      assert.equal(body.ok, true);
      return body;
    }
    // Keep the payload stable when simulating a lost acknowledgement.
    const arrivalAt = new Date().toISOString();
    const arrival = () => send("ARRIVED_SITE", "ci-arrival-001", { occurredAt: arrivalAt });
    await acknowledged(await arrival(), "arrival");
    await acknowledged(await arrival(), "replayed arrival");
    const noteAt = new Date().toISOString();
    const note = () => send("NOTE", "ci-note-001", { occurredAt: noteAt, note: "Two photos and one note" });
    await acknowledged(await note(), "note");
    await acknowledged(await note(), "replayed note");

    const { default: sharp } = await import("sharp");
    const photo = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 40, g: 120, b: 180 } } }).jpeg().toBuffer();
    for (let index = 1; index <= 2; index++) {
      const metadata = { ownerUserId: user.id, projectId: project.id, dailyTaskId: task.id, clientUploadId: `ci-photo-${index}`, originalName: `field-${index}.jpg`, mimeType: "image/jpeg", sizeBytes: photo.length, note: "Two photos and one note" };
      const upload = await acknowledged(await uploads.POST(jsonRequest("/api/uploads", metadata)), `photo ${index} session`);
      const context = { params: Promise.resolve({ uploadId: upload.uploadId }) };
      const patch = () => chunks.PATCH(new Request(`${origin}/api/uploads/${upload.uploadId}`, { method: "PATCH", headers: { Origin: origin, "Content-Type": "application/octet-stream", "Upload-Offset": "0" }, body: photo }), context);
      await acknowledged(await patch(), `photo ${index} chunk`);
      await acknowledged(await patch(), `photo ${index} replayed chunk`);
      const publish = () => finalize.POST(new Request(`${origin}/api/uploads/${upload.uploadId}/finalize`, { method: "POST", headers: { Origin: origin } }), context);
      const completed = await acknowledged(await publish(), `photo ${index} finalize`);
      const repeated = await acknowledged(await publish(), `photo ${index} replayed finalize`);
      assert.equal(completed.status, "COMPLETED");
      assert.equal(repeated.projectFileId, completed.projectFileId);
      const file = await client.projectFile.findUniqueOrThrow({ where: { id: completed.projectFileId } });
      assert.deepEqual(await readFile(resolveStoragePath(file.storagePath)), photo);
    }
    await acknowledged(await send("LEFT_SITE", "ci-departure-001"), "departure after note and photos");
    assert.equal((await client.dailyTask.findUniqueOrThrow({ where: { id: task.id } })).status, "COMPLETED");
    assert.equal(await client.taskEvent.count({ where: { dailyTaskId: task.id, type: "ARRIVED_SITE" } }), 1);
    assert.equal(await client.taskEvent.count({ where: { dailyTaskId: task.id, type: "NOTE_ADDED" } }), 1);
    assert.equal(await client.taskEvent.count({ where: { dailyTaskId: task.id, type: "LEFT_SITE" } }), 1);
    assert.equal(await client.projectNote.count({ where: { projectId: project.id } }), 1);
    assert.equal(await client.projectFile.count({ where: { dailyTaskId: task.id } }), 2);
    assert.equal(await client.projectTimelineEvent.count({ where: { dailyTaskId: task.id, eventType: "FILE_ADDED" } }), 2);
    assert.equal(await client.offlinePendingItem.count({ where: { userId: user.id, status: "SYNCED" } }), 3);

    // Concurrent transitions must still serialize: casting the result must not
    // weaken the lock that stops one person starting overlapping tasks.
    const competing = await Promise.all([1, 2].map(() => client.dailyTask.create({ data: taskData })));
    const responses = await Promise.all(competing.map((other, index) => send("ARRIVED_SITE", `ci-competing-${index}`, { taskId: other.id })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
    console.log("Personnel integration passed: real PostgreSQL arrival, note, two JPEG uploads, replay protection, departure and concurrent transitions.");
  } finally {
    unregister?.();
    await client.$disconnect();
    if (storage) {
      assert.ok(path.resolve(storage).startsWith(path.resolve(tmpdir()) + path.sep));
      assert.ok(path.basename(storage).startsWith("kagu-personnel-ci-"));
      await rm(storage, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error("Personnel PostgreSQL integration failed. Only the guarded CI database and temporary upload directory were used.");
  if (error instanceof assert.AssertionError) console.error(error.message);
  else console.error({ code: /^P\d{4}$/.test(String(error?.code)) ? error.code : "INTEGRATION_ERROR" });
  process.exitCode = 1;
});
