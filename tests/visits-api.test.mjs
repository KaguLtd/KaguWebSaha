import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const state = { receipts: new Map(), notes: [], visits: [], timeline: [], files: [], jobs: [] };
let user = { id: 'observer-A', role: 'OBSERVER' };
let failCommit = false;
let failRefresh = false;
let failFile = false;
let archived = false;
let transactionTail = Promise.resolve();
let transactionAttempts = 0;
let bareLookupBarrier = null;
const preparedSources = [];
const db = {
  project: { findUnique: async ({ where }) => ({ id: where.id, isActive: !archived }) },
  projectVisit: {
    create: async ({ data }) => { const result = { ...data, id: `visit-${state.visits.length + 1}` }; state.visits.push(result); return result; },
    findFirst: async ({ where }) => state.visits.find((v) => v.id === where.id && v.projectId === where.projectId) ?? null,
    update: async ({ where, data }) => Object.assign(state.visits.find((v) => v.id === where.id), data),
  },
  projectNote: { create: async ({ data }) => { state.notes.push(data); return data; } },
  projectTimelineEvent: { create: async ({ data }) => { state.timeline.push(data); return data; } },
  offlinePendingItem: {
    create: async ({ data }) => { if (state.receipts.has(data.clientItemId)) throw Object.assign(new Error('duplicate'), { code: 'P2002' }); state.receipts.set(data.clientItemId, structuredClone(data)); return data; },
    update: async ({ where, data }) => Object.assign(state.receipts.get(where.clientItemId), structuredClone(data)),
    findUnique: async ({ where }) => {
      const previous = state.receipts.get(where.clientItemId) ?? null;
      if (bareLookupBarrier?.id === where.clientItemId) {
        bareLookupBarrier.arrived++;
        if (bareLookupBarrier.arrived === 2) bareLookupBarrier.release();
        await bareLookupBarrier.promise;
      }
      return previous;
    },
  },
  user: { update: async () => ({}) },
  $transaction: async (run) => {
    transactionAttempts++;
    // A unique DB claim waits for commit/rollback before another transaction
    // can fail on that same key; a fake rollback must not erase concurrent writes.
    const prior = transactionTail;
    let release;
    transactionTail = new Promise((resolve) => { release = resolve; });
    await prior;
    const previous = structuredClone(state);
    try { const result = await run(db); if (failCommit) { failCommit = false; throw new Error('database unavailable'); } return result; }
    catch (error) { Object.assign(state, previous); throw error; }
    finally { release(); }
  },
};
globalThis.__visitApi = { db, getUser: () => user, refresh: () => { if (failRefresh) throw new Error('refresh failed'); },
  file: (file) => {
    if (failFile) throw new Error('upload failed');
    preparedSources.push(file.name);
    return { status: file.name.endsWith('.heic') ? 'pending-heic' : 'ready', originalName: file.name, mimeType: file.type, sizeBytes: BigInt(file.size), storagePath: 'fixture-only/source', tempStoragePath: 'fixture-only/staged' };
  },
  record: (upload, context, tx) => {
    assert.equal(tx, db, 'file/job publication must use the business transaction');
    if (upload.status === 'pending-heic') state.jobs.push({ ...context, originalName: upload.originalName });
    else state.files.push({ ...context, originalName: upload.originalName });
    state.timeline.push({ ...context, eventType: 'FILE_ADDED' });
  },
};
const sources = {
  auth: 'export async function getCurrentUser(){return globalThis.__visitApi.getUser();}',
  db: 'export const prisma=globalThis.__visitApi.db;',
  server: 'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
  cache: 'export const revalidatePath=()=>globalThis.__visitApi.refresh();',
  media: 'export async function recordProjectUpload(...args){return globalThis.__visitApi.record(...args);} export function scheduleHeicConversionProcessing(){}',
  thumb: 'export function scheduleImageThumbnailProcessing(){}',
  storage: 'export async function saveProjectUpload(file){return globalThis.__visitApi.file(file);}',
};
registerHooks({
  resolve(specifier, context, next) {
    const key = ({ '@/lib/auth/session': 'auth', '@/lib/db/prisma': 'db', 'next/server': 'server', 'next/cache': 'cache', '@/lib/files/heic-conversion-jobs': 'media', '@/lib/files/image-thumbnail-jobs': 'thumb', '@/lib/files/storage': 'storage' })[specifier];
    return key ? { url: `visit-api:${key}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) { return url.startsWith('visit-api:') ? { format: 'module', source: sources[url.slice(10)], shortCircuit: true } : next(url, context); },
});
const { POST } = await import('../app/api/admin/visits/route.ts');
function send(operation, id, extra = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ operation, clientItemId: id, projectId: 'project-A', ownerUserId: 'observer-A', note: 'Saha kontrol notu', ...extra })) {
    if (Array.isArray(value)) for (const item of value) form.append(key, item);
    else form.set(key, value);
  }
  return POST(new Request('http://test/api/admin/visits', { method: 'POST', body: form }));
}
test.beforeEach(() => {
  Object.assign(state, { receipts: new Map(), notes: [], visits: [], timeline: [], files: [], jobs: [] });
  transactionTail = Promise.resolve(); transactionAttempts = 0; bareLookupBarrier = null; preparedSources.length = 0;
  user = { id: 'observer-A', role: 'OBSERVER' }; failCommit = failRefresh = failFile = archived = false;
});

test('expired session returns JSON401 without redirect or business writes', async () => {
  user = null;
  const response = await send('note', 'session-expired');
  assert.equal(response.status, 401); assert.equal(response.headers.has('location'), false);
  assert.equal((await response.json()).ok, false); assert.equal(state.notes.length, 0); assert.equal(state.receipts.size, 0);
});
test('wrong role and a changed account cannot submit the old form', async () => {
  user = { id: 'observer-A', role: 'PERSONNEL' };
  assert.equal((await send('note', 'wrong-role-01')).status, 403);
  user = { id: 'observer-B', role: 'OBSERVER' };
  assert.equal((await send('note', 'wrong-owner-1')).status, 401); assert.equal(state.notes.length, 0);
});
test('note survives commit failure and saves exactly once on retry', async () => {
  failCommit = true;
  assert.equal((await send('note', 'retry-note-01')).status, 503); assert.equal(state.notes.length, 0);
  assert.equal((await send('note', 'retry-note-01')).status, 200);
  assert.equal((await send('note', 'retry-note-01')).status, 200); assert.equal(state.notes.length, 1);
  assert.equal((await send('note', 'retry-note-01', { note: 'different' })).status, 400);
});
test('refresh failure after commit remains a successful note ACK and deduplicates', async () => {
  failRefresh = true;
  assert.equal((await send('note', 'refresh-note-1')).status, 200);
  assert.equal((await send('note', 'refresh-note-1')).status, 200); assert.equal(state.notes.length, 1);
});
test('visit ACK contains the same visit ID on retry and only one note/timeline pair', async () => {
  failRefresh = true;
  const first = await (await send('visit', 'visit-retry-01')).json();
  const second = await (await send('visit', 'visit-retry-01')).json();
  assert.equal(first.ok, true); assert.equal(first.visitId, second.visitId);
  assert.equal(state.visits.length, 1); assert.equal(state.notes.length, 1); assert.equal(state.timeline.length, 2);
});
test('quick-note is idempotent and its legacy file failure rolls back the note', async () => {
  failFile = true;
  assert.equal((await send('quick-note', 'quick-with-file', { files: new File(['data'], 'photo.jpg', { type: 'image/jpeg' }) })).status, 503);
  assert.equal(state.notes.length, 0);
  failFile = false;
  assert.equal((await send('quick-note', 'quick-note-01')).status, 200);
  assert.equal((await send('quick-note', 'quick-note-01')).status, 200); assert.equal(state.notes.length, 1);
});
test('observer cannot attach another observers visit or use an archived project', async () => {
  state.visits.push({ id: 'other-visit', projectId: 'project-A', visitedByUserId: 'observer-B' });
  assert.equal((await send('note', 'visit-wrong-01', { projectVisitId: 'other-visit' })).status, 400);
  archived = true;
  assert.equal((await send('note', 'archived-note')).status, 400); assert.equal(state.notes.length, 0);
});

test('legacy file new receipt deduplicates and rejects changed note/name/size/type/project/visit', async () => {
  const file = () => new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
  const first = await (await send('file', 'new-file-receipt', { files: file() })).json();
  const repeated = await (await send('file', 'new-file-receipt', { files: file() })).json();
  assert.deepEqual(repeated, first); assert.equal(state.files.length, 1); assert.equal(preparedSources.length, 1);
  const changes = [
    { note: 'A newly changed note', files: file() },
    { files: new File(['data'], 'another.jpg', { type: 'image/jpeg' }) },
    { files: new File(['different size'], 'photo.jpg', { type: 'image/jpeg' }) },
    { files: new File(['data'], 'photo.jpg', { type: 'image/png' }) },
    { projectId: 'project-B', files: file() },
  ];
  for (const changed of changes) assert.equal((await send('file', 'new-file-receipt', changed)).status, 400);
  state.visits.push({ id: 'own-visit', projectId: 'project-A', visitedByUserId: 'observer-A' });
  assert.equal((await send('file', 'new-file-receipt', { projectVisitId: 'own-visit', files: file() })).status, 400);
  assert.equal(state.files.length, 1); assert.equal(preparedSources.length, 1);
  const stored = state.receipts.get('observer-A:new-file-receipt');
  assert.equal(stored.status, 'SYNCED'); assert.equal(stored.type, 'FILE'); assert.equal(stored.payload.request.note, 'Saha kontrol notu');
});

test('two file requests that both miss the legacy receipt publish only one file/job transaction', async () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  bareLookupBarrier = { id: 'parallel-file-01', arrived: 0, promise, release };
  const request = () => send('file', 'parallel-file-01', { files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' }), new File(['heic'], 'camera.heic', { type: 'image/heic' })] });
  const responses = await Promise.all([request(), request()]);
  assert.equal(bareLookupBarrier.arrived, 2, 'both requests must miss before the first claim');
  assert.equal(transactionAttempts, 2, 'both handlers attempt the atomic transaction');
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.equal(state.files.length, 1); assert.equal(state.jobs.length, 1); assert.equal(state.timeline.length, 2); assert.equal(state.receipts.size, 1);
  assert.deepEqual(preparedSources, ['photo.jpg', 'camera.heic'], 'second unique claim must not prepare any disk sources');
});

test('legacy file commit/disk failures do not acknowledge or publish partial data and retry remains possible', async () => {
  const files = () => [new File(['image'], 'photo.jpg', { type: 'image/jpeg' }), new File(['heic'], 'camera.heic', { type: 'image/heic' })];
  failFile = true;
  assert.equal((await send('file', 'failed-file-001', { files: files() })).status, 503);
  assert.equal(state.receipts.size, 0); assert.equal(state.files.length, 0); assert.equal(state.jobs.length, 0);
  failFile = false; failCommit = true;
  assert.equal((await send('file', 'failed-file-001', { files: files() })).status, 503);
  assert.equal(state.receipts.size, 0); assert.equal(state.files.length, 0); assert.equal(state.jobs.length, 0);
  assert.deepEqual(preparedSources, ['photo.jpg', 'camera.heic'], 'DB rollback must not delete prepared source evidence');
  assert.equal((await send('file', 'failed-file-001', { files: files() })).status, 200);
  assert.equal(state.files.length, 1); assert.equal(state.jobs.length, 1); assert.equal(state.receipts.get('observer-A:failed-file-001').status, 'SYNCED');
});

test('bare V1 SYNCED file receipt preserves an explicit legacy ACK but keeps owner/project/visit checks', async () => {
  const legacy = { clientItemId: 'bare-legacy-file', userId: 'observer-A', type: 'FILE', status: 'SYNCED', payload: { projectId: 'project-A', projectVisitId: null, fileCount: 1 } };
  state.receipts.set(legacy.clientItemId, structuredClone(legacy));
  const response = await send('file', legacy.clientItemId, { files: new File(['original'], 'old.jpg') });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, duplicate: true, legacyReceipt: true, visitId: null });
  assert.deepEqual(state.receipts.get(legacy.clientItemId), legacy); assert.equal(preparedSources.length, 0); assert.equal(transactionAttempts, 0);
  assert.equal((await send('file', legacy.clientItemId, { projectId: 'project-B', files: new File(['x'], 'x.jpg') })).status, 400);
  assert.equal((await send('file', legacy.clientItemId, { projectVisitId: 'other-visit', files: new File(['x'], 'x.jpg') })).status, 400);
  user = { id: 'observer-B', role: 'OBSERVER' };
  assert.equal((await send('file', legacy.clientItemId, { ownerUserId: 'observer-B', files: new File(['x'], 'x.jpg') })).status, 400);
  assert.equal(preparedSources.length, 0);
});

test('a bare pending V1 receipt keeps its owner guard and is never overwritten', async () => {
  const pending = { clientItemId: 'same-client-file', userId: 'observer-A', type: 'FILE', status: 'PENDING', payload: { projectId: 'project-A' } };
  state.receipts.set(pending.clientItemId, structuredClone(pending));
  assert.equal((await send('file', pending.clientItemId, { files: new File(['A'], 'A.jpg') })).status, 200);
  user = { id: 'observer-B', role: 'OBSERVER' };
  assert.equal((await send('file', pending.clientItemId, { ownerUserId: 'observer-B', files: new File(['B'], 'B.jpg') })).status, 400);
  assert.deepEqual(state.receipts.get(pending.clientItemId), pending); assert.equal(state.files.length, 1);
  assert.ok(state.receipts.get('observer-A:same-client-file')); assert.equal(state.receipts.has('observer-B:same-client-file'), false);
});

test('fresh scoped file receipts let independent owners use the same client ID without legacy state', async () => {
  assert.equal((await send('file', 'fresh-owner-id', { files: new File(['A'], 'A.jpg') })).status, 200);
  user = { id: 'observer-B', role: 'OBSERVER' };
  assert.equal((await send('file', 'fresh-owner-id', { ownerUserId: 'observer-B', files: new File(['B'], 'B.jpg') })).status, 200);
  assert.equal(state.files.length, 2);
  assert.ok(state.receipts.get('observer-A:fresh-owner-id')); assert.ok(state.receipts.get('observer-B:fresh-owner-id'));
});

test('legacy file rejects a 21-file batch before disk preparation or a receipt claim', async () => {
  const files = Array.from({ length: 21 }, (_, index) => new File(['x'], `photo-${index}.jpg`));
  assert.equal((await send('file', 'too-many-files', { files })).status, 413);
  assert.equal(preparedSources.length, 0); assert.equal(state.receipts.size, 0); assert.equal(transactionAttempts, 0);
});
