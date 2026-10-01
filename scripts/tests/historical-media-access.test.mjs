import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Actual handlers with isolated auth/DB; files live only in this temporary fixture.
const tempRoot = path.resolve(tmpdir());
const directory = await mkdtemp(path.join(tempRoot, 'kagu-historical-media-'));
assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep));
await writeFile(path.join(directory, 'file.bin'), 'abcdef');
await writeFile(path.join(directory, 'thumbnail.webp'), 'thumb');
test.after(async () => {
  assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep));
  await rm(directory, { recursive: true, force: true });
});

const state = { user: null, projects: new Map(), tasks: new Map(), files: new Map(), sessions: new Map(), jobs: [], queries: [] };
globalThis.__historicalMediaState = state;

function matchesTask(task, where) {
  return (!where.id || task.id === where.id) && (!where.projectId || task.projectId === where.projectId) &&
    (!where.taskDate || (where.taskDate instanceof Date ? task.taskDate.getTime() === where.taskDate.getTime() : task.taskDate <= where.taskDate.lte)) &&
    (!where.assignees || task.assignees.some((assignment) => assignment.userId === where.assignees.some.userId));
}
function projectedFile(file, include) {
  if (!file) return null;
  const project = state.projects.get(file.projectId);
  const todayQuery = include.project.select.dailyTasks;
  const dailyTask = state.tasks.get(file.dailyTaskId) ?? null;
  return { ...file, project: { isActive: project.isActive, dailyTasks: [...state.tasks.values()].filter((task) => task.projectId === file.projectId && matchesTask(task, todayQuery.where)).slice(0, 1).map((task) => ({ id: task.id })) },
    dailyTask: dailyTask ? { ...dailyTask, assignees: dailyTask.assignees.filter((assignment) => assignment.userId === include.dailyTask.select.assignees.where.userId) } : null };
}
const db = {
  project: { findUnique: async ({ where }) => state.projects.get(where.id) ?? null },
  dailyTask: { findFirst: async ({ where }) => { state.queries.push(['task', where]); return [...state.tasks.values()].find((task) => matchesTask(task, where)) ?? null; } },
  projectVisit: { findFirst: async () => null },
  projectFile: {
    findUnique: async ({ where, include }) => { state.queries.push(['file', where]); return projectedFile(state.files.get(where.id), include); },
    findMany: async ({ where, include }) => [...state.files.values()].filter((file) => where.id.in.includes(file.id) && file.uploadedByUserId === where.uploadedByUserId).map((file) => projectedFile(file, include)),
  },
  uploadSession: {
    findUnique: async ({ where }) => { const key = where.uploadedByUserId_clientUploadId; return [...state.sessions.values()].find((session) => session.uploadedByUserId === key.uploadedByUserId && session.clientUploadId === key.clientUploadId) ?? null; },
    findFirst: async ({ where }) => [...state.sessions.values()].find((session) => session.id === where.id && session.uploadedByUserId === where.uploadedByUserId) ?? null,
    findMany: async ({ where, take }) => { state.queries.push(['receipts', where]); return [...state.sessions.values()].filter((session) => session.uploadedByUserId === where.uploadedByUserId && session.status === where.status && session.completedAt >= where.completedAt.gte).sort((a, b) => b.completedAt - a.completedAt).slice(0, take); },
    upsert: async ({ where, create }) => { const key = where.uploadedByUserId_clientUploadId; const existing = [...state.sessions.values()].find((session) => session.uploadedByUserId === key.uploadedByUserId && session.clientUploadId === key.clientUploadId); if (existing) return existing; const next = { ...create, status: 'OPEN', offsetBytes: 0n, projectFileId: null, completedAt: null }; state.sessions.set(next.id, next); return next; },
    update: async ({ where, data }) => Object.assign(state.sessions.get(where.id), data),
  },
  heicConversionJob: { findMany: async ({ where }) => state.jobs.filter((job) => where.uploadSessionId.in.includes(job.uploadSessionId) && job.uploadedByUserId === where.uploadedByUserId) },
};
globalThis.__historicalMediaDb = db;
globalThis.__historicalMediaDirectory = directory;
const mocks = {
  auth: 'export async function getCurrentUser(){return globalThis.__historicalMediaState.user;}',
  db: 'export const prisma = globalThis.__historicalMediaDb;',
  server: 'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
  cache: 'export function revalidatePath(){}',
  storage: 'import path from "node:path"; export const MAX_UPLOAD_BYTES=100*1024*1024; export function resolveStoragePath(value){return path.join(globalThis.__historicalMediaDirectory,value);} export async function removeStorageFile(){throw new Error("fixture must not delete");} export async function prepareStoredProjectUpload(){throw new Error("fixture must not publish");}',
  media: 'export function scheduleHeicConversionProcessing(){} export async function recordProjectUpload(){throw new Error("fixture must not publish");}',
  thumbnails: 'export function scheduleImageThumbnailProcessing(){}',
};
registerHooks({
  resolve(specifier, context, next) {
    const key = ({ '@/lib/auth/session': 'auth', '@/lib/db/prisma': 'db', 'next/server': 'server', 'next/cache': 'cache', '@/lib/files/storage': 'storage', '@/lib/files/heic-conversion-jobs': 'media', '@/lib/files/image-thumbnail-jobs': 'thumbnails' })[specifier];
    return key ? { url: `historical-media-test:${key}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) { return url.startsWith('historical-media-test:') ? { format: 'module', source: mocks[url.slice(22)], shortCircuit: true } : next(url, context); },
});

const fileRoute = await import('../../app/api/files/[fileId]/route.ts');
const thumbnailRoute = await import('../../app/api/files/[fileId]/thumbnail/route.ts');
const initRoute = await import('../../app/api/uploads/route.ts');
const uploadRoute = await import('../../app/api/uploads/[uploadId]/route.ts');
const finalizeRoute = await import('../../app/api/uploads/[uploadId]/finalize/route.ts');
const recentRoute = await import('../../app/api/personnel/uploads/recent/route.ts');
const { canWriteTaskDay, taskAgeDays } = await import('../../lib/personnel/delayed-write-policy.ts');
const { getTodayDateOnly } = await import('../../lib/dates/today.ts');

test.beforeEach((t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T10:00:00Z') });
  state.user = { id: 'A', role: 'PERSONNEL' }; state.projects.clear(); state.tasks.clear(); state.files.clear(); state.sessions.clear(); state.jobs = []; state.queries = [];
  state.projects.set('project', { id: 'project', isActive: true });
  state.tasks.set('past', { id: 'past', projectId: 'project', taskDate: new Date('2026-09-30T00:00:00Z'), assignees: [{ userId: 'A' }] });
  state.files.set('file', { id: 'file', projectId: 'project', dailyTaskId: 'past', uploadedByUserId: 'A', storagePath: 'file.bin', originalName: 'dosya.txt', mimeType: 'text/plain', thumbnailStoragePath: 'thumbnail.webp', thumbnailMimeType: 'image/webp' });
});

const fileContext = { params: Promise.resolve({ fileId: 'file' }) };
async function assertReadStatuses(expected) {
  const responses = [await fileRoute.GET(new Request('http://test/api/files/file'), fileContext), await fileRoute.HEAD(new Request('http://test/api/files/file', { method: 'HEAD' }), fileContext), await thumbnailRoute.GET(new Request('http://test/api/files/file/thumbnail'), fileContext)];
  for (const response of responses) { assert.equal(response.status, expected); if (response.body) await response.arrayBuffer(); }
}
const metadata = { ownerUserId: 'A', clientUploadId: 'original-upload', projectId: 'project', dailyTaskId: 'past', originalName: 'dosya.txt', mimeType: 'text/plain', sizeBytes: 6 };
const init = (extra = {}) => initRoute.POST(new Request('http://test/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...metadata, ...extra }) }));

test('GET, HEAD and thumbnail return JSON401 before any file lookup for an expired session', async () => {
  state.user = null;
  for (const [route, request] of [[fileRoute.GET, new Request('http://test/api/files/file')], [fileRoute.HEAD, new Request('http://test/api/files/file', { method: 'HEAD' })], [thumbnailRoute.GET, new Request('http://test/api/files/file/thumbnail')]]) {
    const response = await route(request, fileContext); assert.equal(response.status, 401); assert.equal(response.headers.get('location'), null); assert.equal(response.headers.get('content-type'), 'application/json'); assert.equal((await response.json()).ok, false);
  }
  assert.equal(state.queries.length, 0);
});

test('own historical exact task file is readable through all three handlers with current assignment', async () => {
  await assertReadStatuses(200);
  const response = await fileRoute.GET(new Request('http://test/api/files/file', { headers: { Range: 'bytes=1-3' } }), fileContext);
  assert.equal(response.status, 206); assert.equal(await response.text(), 'bcd');
});

test('historical project assignment grants no access to another uploader or a project-level file', async () => {
  state.files.get('file').uploadedByUserId = 'B'; await assertReadStatuses(403);
  state.files.get('file').uploadedByUserId = 'A'; state.files.get('file').dailyTaskId = null; await assertReadStatuses(403);
});

test('historical own file is denied after assignment removal, on archive, or after exact task deletion', async () => {
  state.tasks.get('past').assignees = []; await assertReadStatuses(403);
  state.tasks.get('past').assignees = [{ userId: 'A' }]; state.projects.get('project').isActive = false; await assertReadStatuses(403);
  state.projects.get('project').isActive = true; state.tasks.delete('past'); await assertReadStatuses(403);
});

test('today project-wide access remains intact including another uploader and an archived project', async () => {
  state.tasks.set('today', { id: 'today', projectId: 'project', taskDate: getTodayDateOnly(), assignees: [{ userId: 'A' }] });
  state.files.get('file').uploadedByUserId = 'B'; state.files.get('file').dailyTaskId = null;
  await assertReadStatuses(200); state.projects.get('project').isActive = false; await assertReadStatuses(200);
});

test('administrator and observer existing active/archive file scope is preserved', async () => {
  state.user = { id: 'observer', role: 'OBSERVER' }; await assertReadStatuses(200);
  state.projects.get('project').isActive = false; await assertReadStatuses(403);
  state.user = { id: 'admin', role: 'ADMIN' }; await assertReadStatuses(200);
});

test('original task day allows age0 and7, rejects8, future and invalid dates', async () => {
  const today = getTodayDateOnly(); assert.equal(taskAgeDays(new Date('2026-09-24T00:00:00Z'), today), 7);
  for (const date of ['2026-10-01', '2026-09-24']) { state.tasks.get('past').taskDate = new Date(`${date}T00:00:00Z`); assert.equal((await init({ clientUploadId: date })).status, 200); }
  state.tasks.get('past').taskDate = new Date('2026-09-23T00:00:00Z'); const rejected = await init(); assert.equal(rejected.status, 403); assert.match((await rejected.json()).error, /cihazda korundu/);
  state.tasks.get('past').taskDate = new Date('2026-10-02T00:00:00Z'); assert.equal((await init()).status, 403);
  assert.equal(canWriteTaskDay(new Date('invalid'), today), false); assert.equal(canWriteTaskDay(new Date('2026-10-02T00:00:00Z'), today), false);
});

test('upload authorization rejects another task owner/project and archived historical project', async () => {
  state.tasks.get('past').assignees = [{ userId: 'B' }]; assert.equal((await init()).status, 403);
  state.tasks.get('past').assignees = [{ userId: 'A' }]; state.tasks.get('past').projectId = 'other'; assert.equal((await init()).status, 403);
  state.tasks.get('past').projectId = 'project'; state.projects.get('project').isActive = false; assert.equal((await init()).status, 403);
});

test('upload status/chunk/finalize enforce the original task limit across Istanbul midnight', async (t) => {
  t.mock.timers.setTime(new Date('2026-10-01T20:59:59Z').getTime());
  state.tasks.get('past').taskDate = new Date('2026-09-24T00:00:00Z');
  const created = await init(); assert.equal(created.status, 200); const session = await created.json();
  const context = { params: Promise.resolve({ uploadId: session.uploadId }) };
  assert.equal((await uploadRoute.GET(new Request('http://test/api/uploads/id'), context)).status, 200);
  t.mock.timers.setTime(new Date('2026-10-01T21:00:00Z').getTime());
  assert.equal((await uploadRoute.GET(new Request('http://test/api/uploads/id'), context)).status, 403);
  // The lock is stubbed only to reach the actual authorization in withUploadLock.
  db.$transaction = async (run) => run(db); db.uploadSession.updateMany = async () => ({ count: 1 });
  assert.equal((await uploadRoute.PATCH(new Request('http://test/api/uploads/id', { method: 'PATCH', headers: { 'Upload-Offset': '0' }, body: 'abc' }), context)).status, 403);
  assert.equal((await finalizeRoute.POST(new Request('http://test/api/uploads/id/finalize', { method: 'POST' }), context)).status, 403);
  assert.equal(state.sessions.get(session.uploadId).offsetBytes, 0n); assert.equal(state.sessions.get(session.uploadId).status, 'OPEN');
});

test('completed acknowledgements beyond day7 return original result but still enforce owner, assignment and active project', async () => {
  const session = { id: 'saved', uploadedByUserId: 'A', clientUploadId: metadata.clientUploadId, projectId: 'project', dailyTaskId: 'past', projectVisitId: null, originalName: metadata.originalName, mimeType: metadata.mimeType, sizeBytes: 6n, note: null, status: 'COMPLETED', offsetBytes: 6n, expiresAt: new Date('2026-10-08T10:00:00Z'), completedAt: new Date('2026-09-30T12:00:00Z'), projectFileId: 'file' };
  state.sessions.set(session.id, session); state.tasks.get('past').taskDate = new Date('2026-09-01T00:00:00Z');
  const context = { params: Promise.resolve({ uploadId: session.id }) };
  assert.equal((await init()).status, 200); assert.equal((await uploadRoute.GET(new Request('http://test/api/uploads/saved'), context)).status, 200);
  const acknowledged = await finalizeRoute.POST(new Request('http://test/api/uploads/saved/finalize', { method: 'POST' }), context); assert.equal(acknowledged.status, 200); assert.equal((await acknowledged.json()).projectFileId, 'file'); assert.equal(state.sessions.size, 1);
  assert.equal((await init({ originalName: 'different.txt' })).status, 409);
  state.tasks.get('past').assignees = []; assert.equal((await uploadRoute.GET(new Request('http://test/api/uploads/saved'), context)).status, 403);
  state.tasks.get('past').assignees = [{ userId: 'A' }]; state.projects.get('project').isActive = false; assert.equal((await init()).status, 403);
  state.projects.get('project').isActive = true; state.user = { id: 'B', role: 'PERSONNEL' }; assert.equal((await uploadRoute.GET(new Request('http://test/api/uploads/saved'), context)).status, 404);
});

test('recent results expose only own recent completed receipts and preparation failures without internal paths', async () => {
  const completedAt = new Date('2026-09-30T12:00:00Z');
  const receipt = (id, extra = {}) => ({ id, uploadedByUserId: 'A', status: 'COMPLETED', completedAt, originalName: `${id}.heic`, projectFileId: null, ...extra });
  for (const row of [receipt('ready', { projectFileId: 'file' }), receipt('pending'), receipt('failed'), receipt('other', { uploadedByUserId: 'B' }), receipt('old', { completedAt: new Date('2026-09-20T12:00:00Z') }), receipt('unfinished', { status: 'OPEN' })]) state.sessions.set(row.id, row);
  state.jobs = [{ uploadSessionId: 'pending', uploadedByUserId: 'A', status: 'PROCESSING' }, { uploadSessionId: 'failed', uploadedByUserId: 'A', status: 'FAILED', lastError: 'private/path', tempStoragePath: 'private/source.heic' }];
  const response = await recentRoute.GET(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const payload = await response.json(); assert.equal(payload.userId, 'A'); assert.equal(payload.results.length, 3);
  const byId = new Map(payload.results.map((row) => [row.uploadId, row])); assert.equal(byId.get('ready').status, 'READY'); assert.equal(byId.get('ready').projectFileId, 'file'); assert.equal(byId.get('pending').status, 'PROCESSING'); assert.equal(byId.get('failed').status, 'FAILED');
  assert.equal(JSON.stringify(payload).includes('private/'), false);
  state.tasks.get('past').assignees = []; const denied = (await (await recentRoute.GET()).json()).results.find((row) => row.uploadId === 'ready'); assert.equal(denied.canRead, false); assert.equal(denied.projectFileId, null);
});

test('recent receipts API returns JSON401/403 with no receipt reads for missing or wrong-role session', async () => {
  state.user = null; assert.equal((await recentRoute.GET()).status, 401);
  state.user = { id: 'admin', role: 'ADMIN' }; assert.equal((await recentRoute.GET()).status, 403);
  assert.equal(state.queries.length, 0);
});
