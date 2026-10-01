import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getTodayDateOnly } from '../../lib/dates/today.ts';

// Real route handlers run against an isolated in-memory DB and real temporary files.
// No production Prisma client, auth cookie, or upload directory is used.
globalThis.__mediaTestUser = { id: 'person-A', role: 'PERSONNEL' };
const sessions = new Map();
const files = [];
const events = [];
let failNextCommit = false;
function copy(value) { return value ? { ...value } : null; }
function sessionMatches(session, where) {
  return (!where.id || session.id === where.id)
    && (!where.uploadedByUserId || session.uploadedByUserId === where.uploadedByUserId)
    && (!where.lockedBy || session.lockedBy === where.lockedBy);
}
const db = {
  project: { findUnique: async () => ({ id: 'project-A', isActive: true }) },
  dailyTask: { findFirst: async ({ where }) => where.assignees?.some.userId === 'person-A' ? { id: 'task-A', taskDate: getTodayDateOnly() } : null },
  projectVisit: { findFirst: async () => null },
  uploadSession: {
    findUnique: async ({ where }) => {
      const key = where.uploadedByUserId_clientUploadId;
      return copy([...sessions.values()].find((row) => row.uploadedByUserId === key.uploadedByUserId && row.clientUploadId === key.clientUploadId));
    },
    upsert: async ({ where, create }) => {
      const key = where.uploadedByUserId_clientUploadId;
      const existing = [...sessions.values()].find((row) => row.uploadedByUserId === key.uploadedByUserId && row.clientUploadId === key.clientUploadId);
      if (existing) return copy(existing);
      const row = { offsetBytes: 0n, status: 'OPEN', projectFileId: null, lockedBy: null, lockedUntil: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), ...create };
      sessions.set(row.id, row);
      return copy(row);
    },
    findFirst: async ({ where }) => copy([...sessions.values()].find((row) => sessionMatches(row, where))),
    updateMany: async ({ where, data }) => {
      const row = [...sessions.values()].find((item) => sessionMatches(item, where));
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    update: async ({ where, data }) => {
      const row = sessions.get(where.id);
      Object.assign(row, data);
      return copy(row);
    },
  },
  projectFile: {
    create: async ({ data }) => {
      const file = { id: `file-${files.length + 1}`, thumbnailStoragePath: null, ...data };
      files.push(file);
      return copy(file);
    },
    findUnique: async ({ where }) => {
      const file = files.find((row) => row.id === where.id);
      return file ? { ...file, project: { isActive: true, dailyTasks: [{ id: 'task-A' }] } } : null;
    },
  },
  projectTimelineEvent: { create: async ({ data }) => { events.push(data); return data; } },
  imageThumbnailJob: { findFirst: async () => null, create: async ({ data }) => data },
  heicConversionJob: { create: async ({ data }) => ({ id: 'heic-1', ...data }) },
  $transaction: async (run) => {
    const previous = new Map([...sessions].map(([key, row]) => [key, copy(row)]));
    const result = await run(db);
    if (failNextCommit) {
      failNextCommit = false;
      sessions.clear();
      for (const [key, row] of previous) sessions.set(key, row);
      throw new Error('injected DB commit interruption');
    }
    return result;
  },
};
globalThis.__mediaTestDb = db;

const mocks = {
  db: 'export const prisma = globalThis.__mediaTestDb;',
  auth: 'export async function getCurrentUser(){return globalThis.__mediaTestUser;} export async function requireUser(){return globalThis.__mediaTestUser;}',
  server: 'export const NextResponse = { json: (body, init) => Response.json(body, init) }; export function after(){}',
  cache: 'export function revalidatePath(){}',
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    let mock;
    if (specifier === '@/lib/db/prisma' || specifier === '../db/prisma') mock = 'db';
    if (specifier === '@/lib/auth/session') mock = 'auth';
    if (specifier === 'next/server') mock = 'server';
    if (specifier === 'next/cache') mock = 'cache';
    return mock ? { url: `media-test:${mock}`, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return url.startsWith('media-test:') ? { format: 'module', source: mocks[url.slice(11)], shortCircuit: true } : nextLoad(url, context);
  },
});

const initRoute = await import('../../app/api/uploads/route.ts');
const uploadRoute = await import('../../app/api/uploads/[uploadId]/route.ts');
const finalizeRoute = await import('../../app/api/uploads/[uploadId]/finalize/route.ts');
const fileRoute = await import('../../app/api/files/[fileId]/route.ts');
const metadata = { ownerUserId: 'person-A', clientUploadId: 'client-file-A', projectId: 'project-A', dailyTaskId: 'task-A', originalName: 'evidence.txt', mimeType: 'text/plain', sizeBytes: 6 };
const init = (data) => initRoute.POST(new Request('http://test/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));

test('upload handlers preserve ownership, chunk replay, finalize identity, and Range/HEAD', async () => {
  const tempRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, 'kagu-upload-api-'));
  assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep));
  const previousUploadDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = directory;
  try {
    const created = await init(metadata);
    assert.equal(created.status, 200);
    const session = await created.json();
    assert.equal(session.offsetBytes, 0);
    const repeated = await (await init(metadata)).json();
    assert.equal(repeated.uploadId, session.uploadId);
    assert.equal(sessions.size, 1);
    assert.equal((await init({ ...metadata, originalName: 'changed.txt' })).status, 409);
    assert.equal((await init({ ...metadata, sizeBytes: 101 * 1024 * 1024 })).status, 413);

    globalThis.__mediaTestUser = { id: 'person-B', role: 'PERSONNEL' };
    assert.equal((await init(metadata)).status, 401, 'account switch cannot send A draft as B');
    const context = { params: Promise.resolve({ uploadId: session.uploadId }) };
    assert.equal((await uploadRoute.GET(new Request('http://test/api/uploads/id'), context)).status, 404);
    globalThis.__mediaTestUser = { id: 'person-A', role: 'PERSONNEL' };

    const chunk = (offset, body) => uploadRoute.PATCH(new Request('http://test/api/uploads/id', { method: 'PATCH', headers: { 'Upload-Offset': String(offset) }, body }), context);
    failNextCommit = true;
    assert.equal((await chunk(0, 'abc')).status, 503, 'uncommitted disk bytes are not acknowledged');
    assert.equal(sessions.get(session.uploadId).offsetBytes, 0n);
    assert.equal((await (await chunk(0, 'abc')).json()).offsetBytes, 3);
    assert.equal((await (await chunk(0, 'abc')).json()).offsetBytes, 3, 'lost ACK safely replays a confirmed chunk');
    assert.equal((await chunk(0, 'abd')).status, 409);
    assert.equal((await finalizeRoute.POST(new Request('http://test/api/uploads/id/finalize', { method: 'POST' }), context)).status, 409);
    assert.equal((await (await chunk(3, 'def')).json()).offsetBytes, 6);
    const first = await (await finalizeRoute.POST(new Request('http://test/api/uploads/id/finalize', { method: 'POST' }), context)).json();
    const second = await (await finalizeRoute.POST(new Request('http://test/api/uploads/id/finalize', { method: 'POST' }), context)).json();
    assert.equal(first.status, 'COMPLETED');
    assert.equal(first.projectFileId, second.projectFileId);
    assert.equal(files.length, 1);
    assert.equal(events.length, 1);
    assert.equal((await uploadRoute.DELETE(new Request('http://test/api/uploads/id', { method: 'DELETE' }), context)).status, 409);

    const fileContext = { params: Promise.resolve({ fileId: first.projectFileId }) };
    const partial = await fileRoute.GET(new Request('http://test/api/files/file-1', { headers: { Range: 'bytes=2-4' } }), fileContext);
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 2-4/6');
    assert.equal(await partial.text(), 'cde');
    const head = await fileRoute.HEAD(new Request('http://test/api/files/file-1', { method: 'HEAD', headers: { Range: 'bytes=-2' } }), fileContext);
    assert.equal(head.status, 206);
    assert.equal(head.headers.get('content-length'), '2');
    assert.equal(await head.text(), '');
  } finally {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;
    assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep));
    await rm(directory, { recursive: true, force: true });
    delete globalThis.__mediaTestDb;
    delete globalThis.__mediaTestUser;
  }
});
