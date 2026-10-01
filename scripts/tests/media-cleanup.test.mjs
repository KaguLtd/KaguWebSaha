import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const sessions = new Map();
const jobs = new Map();
const files = new Map();
function matches(row, where) {
  if (where.OR && !where.OR.some((part) => matches(row, part))) return false;
  if (where.AND && !where.AND.every((part) => matches(row, part))) return false;
  for (const [key, filter] of Object.entries(where)) {
    if (['OR', 'AND'].includes(key)) continue;
    const value = row[key];
    if (filter !== null && typeof filter === 'object' && !(filter instanceof Date)) {
      if ('lt' in filter && !(value < filter.lt)) return false;
      if ('lte' in filter && !(value <= filter.lte)) return false;
      if ('not' in filter && value === filter.not) return false;
    } else if (value !== filter) return false;
  }
  return true;
}
function table(rows) {
  return {
    findMany: async ({ where, take }) => [...rows.values()].filter((row) => matches(row, where)).slice(0, take).map((row) => ({ ...row })),
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const row of rows.values()) if (matches(row, where)) { Object.assign(row, data); count += 1; }
      return { count };
    },
    update: async ({ where, data }) => { const row = rows.get(where.id); Object.assign(row, data); return { ...row }; },
    findUniqueOrThrow: async ({ where }) => { const row = rows.get(where.id); assert.ok(row); return { ...row }; },
  };
}
const db = {
  uploadSession: table(sessions), heicConversionJob: table(jobs),
  projectFile: {
    findFirst: async ({ where }) => [...files.values()].find((row) => row.storagePath === where.storagePath) ?? null,
    findUnique: async ({ where }) => files.get(where.id) ?? null,
  },
  $transaction: async (run) => {
    const sessionCopy = new Map([...sessions].map(([key, row]) => [key, { ...row }]));
    const jobCopy = new Map([...jobs].map(([key, row]) => [key, { ...row }]));
    try { return await run(db); } catch (error) {
      sessions.clear(); jobs.clear();
      for (const [key, row] of sessionCopy) sessions.set(key, row);
      for (const [key, row] of jobCopy) jobs.set(key, row);
      throw error;
    }
  },
};
globalThis.__mediaCleanupDb = db;
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === '../db/prisma' ? { url: 'media-cleanup:db', shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return url === 'media-cleanup:db' ? { format: 'module', source: 'export const prisma = globalThis.__mediaCleanupDb;', shortCircuit: true } : nextLoad(url, context);
  },
});
const { cleanupCompletedHeicSources, cleanupUploadStaging } = await import('../../lib/files/media-processing.ts');

test('cleanup retains failed/active sources and a broken publication; only expired or safely published staging is removed', async () => {
  const tempRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, 'kagu-media-cleanup-'));
  assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep));
  const previous = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = directory;
  const now = Date.now();
  const old = new Date(now - 10 * 60_000);
  const makeFile = async (name) => { await mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await writeFile(path.join(directory, name), 'test-only media'); };
  const exists = (name) => access(path.join(directory, name)).then(() => true, () => false);
  const session = (id, status, extra = {}) => ({ id, status, projectFileId: null, stagingCleanedAt: null, lockedBy: null, lockedUntil: null, updatedAt: old, expiresAt: new Date(now + 86_400_000), tempStoragePath: `${id}.bin`, ...extra });
  const job = (id, status, extra = {}) => ({ id, status, stagingCleanedAt: null, lockedBy: null, lockedUntil: null, nextAttemptAt: old, updatedAt: old, uploadSessionId: null, tempStoragePath: `${id}.heic`, targetStoragePath: `published/${id}.jpg`, ...extra });
  try {
    sessions.set('active', session('active', 'OPEN'));
    sessions.set('expired', session('expired', 'OPEN', { expiresAt: old }));
    sessions.set('locked', session('locked', 'OPEN', { expiresAt: old, lockedUntil: new Date(now + 60_000) }));
    sessions.set('cancelled', session('cancelled', 'CANCELLED'));
    sessions.set('failed-conversion', session('failed-conversion', 'COMPLETED'));
    sessions.set('published', session('published', 'COMPLETED', { projectFileId: 'ready-file' }));
    files.set('ready-file', { id: 'ready-file', storagePath: 'published/ready.txt' });
    jobs.set('failed', job('failed', 'FAILED'));
    jobs.set('working', job('working', 'PROCESSING'));
    jobs.set('safe', job('safe', 'COMPLETED'));
    jobs.set('broken', job('broken', 'COMPLETED'));
    files.set('safe-file', { id: 'safe-file', storagePath: 'published/safe.jpg' });
    // A DB file row without a physical target is insufficient to discard its recovery source.
    files.set('broken-file', { id: 'broken-file', storagePath: 'published/broken.jpg' });
    for (const row of sessions.values()) await makeFile(row.tempStoragePath);
    for (const row of jobs.values()) await makeFile(row.tempStoragePath);
    await makeFile('published/ready.txt'); await makeFile('published/safe.jpg');

    await cleanupCompletedHeicSources();
    await cleanupUploadStaging();
    for (const name of ['active.bin', 'locked.bin', 'failed-conversion.bin', 'failed.heic', 'working.heic', 'broken.heic']) assert.equal(await exists(name), true, `${name} remains recoverable`);
    for (const name of ['expired.bin', 'cancelled.bin', 'published.bin', 'safe.heic']) assert.equal(await exists(name), false, `${name} is safe to remove`);
    assert.equal(sessions.get('expired').status, 'CANCELLED');
    assert.ok(sessions.get('expired').stagingCleanedAt instanceof Date);
    assert.equal(jobs.get('broken').status, 'COMPLETED');
    assert.equal(jobs.get('broken').stagingCleanedAt, null);
    assert.ok(jobs.get('broken').nextAttemptAt.getTime() > now);
  } finally {
    if (previous === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previous;
    assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep));
    await rm(directory, { recursive: true, force: true });
    delete globalThis.__mediaCleanupDb;
  }
});
