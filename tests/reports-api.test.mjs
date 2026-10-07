import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

let user = { id: 'admin-1', role: 'ADMIN', fullName: 'Yönetici' };
let records, calls, saved, failRefresh;
const project = () => ({ id: 'p1', name: 'Şantiye', city: 'İstanbul', description: 'Proje açıklaması', isActive: true,
  createdAt: new Date('2026-01-01T08:00:00Z'), customer: { id: 'c1', name: 'Cari' }, visits: [], timelineEvents: [] });
const task = () => ({ id: 't1', title: 'Montaj', managerNote: 'İş planı', projectId: 'p1', taskDate: new Date('2026-10-01T00:00:00Z'),
  status: 'COMPLETED', arrivedAt: new Date('2026-10-01T06:00:00Z'), leftAt: new Date('2026-10-01T08:00:00Z'), durationMinutes: 120,
  project: { name: 'Şantiye', customer: { id: 'c1', name: 'Cari' } }, _count: { files: 1 },
  assignees: [{ id: 'a1', userId: 'u1', teamId: null, teamNameSnapshot: null, headcountSnapshot: 1, actualHeadcount: null,
    workforceKindSnapshot: 'PERSONNEL', user: { fullName: 'Ali', role: 'PERSONNEL' } }] });
const mutations = ['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'];
const db = {};
for (const name of ['project', 'dailyTask', 'dailyTaskAssignee', 'projectVisit', 'projectTimelineEvent', 'projectNote', 'projectFile', 'taskEvent', 'uploadSession', 'heicConversionJob', 'imageThumbnailJob', 'user', 'customer', 'team']) {
  db[name] = {
    findMany: async (args) => {
      calls.push({ name, method: 'findMany', args });
      if (name === 'projectTimelineEvent' && args.select?.title !== true) return structuredClone(records.legacy);
      if (name === 'dailyTask' && args.where.taskDate.lte < new Date('2026-10-01T00:00:00Z')) return [];
      if (name === 'dailyTaskAssignee') return structuredClone(records.dailyTaskAssignee ?? records.dailyTask.flatMap((task) => task.assignees.map((assignment) => ({ ...assignment, dailyTaskId: task.id }))));
      return structuredClone(records[name] ?? []);
    },
    findUnique: async (args) => {
      calls.push({ name, method: 'findUnique', args });
      if (name === 'project') return { name: 'Şantiye', customerId: 'c1' };
      if (name === 'customer') return { name: 'Cari' };
      if (name === 'user') return { fullName: 'Ali' };
      if (name === 'team') return { name: 'Ekip' };
      return null;
    },
  };
  for (const method of mutations) db[name][method] = () => { throw new Error(`Operational mutation forbidden: ${name}.${method}`); };
}
db.$executeRaw = async (query) => { assert.equal(query.join(''), 'SET TRANSACTION READ ONLY'); calls.push({ name: 'sql', method: 'readOnly' }); return 0; };
db.$transaction = async (run, options) => { calls.push({ name: 'transaction', options }); return run(db); };
db.savedReport = {
  create: async ({ data }) => { saved.push(structuredClone(data)); return { id: data.id }; },
  findUnique: async ({ where }) => {
    const item = saved.find((row) => row.id === where.id);
    return item ? { ...item, createdAt: new Date('2026-10-06T10:00:00Z'), createdBy: { fullName: 'Sonraki ad' } } : null;
  },
};
globalThis.__reportApi = { db, user: () => user, refresh: () => { if (failRefresh) throw new Error('cache unavailable'); } };
const sources = {
  db: 'export const prisma=globalThis.__reportApi.db;',
  auth: 'export async function getCurrentUser(){return globalThis.__reportApi.user();}',
  server: 'export const NextResponse=class extends Response {static json(body,init){return Response.json(body,init)}};',
  cache: 'export const revalidatePath=()=>globalThis.__reportApi.refresh();',
};
registerHooks({
  resolve(specifier, context, next) {
    const key = ({ '@/lib/db/prisma': 'db', '../db/prisma': 'db', '../auth/session': 'auth', 'next/server': 'server', 'next/cache': 'cache' })[specifier];
    return key ? { url: `report-api:${key}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) { return url.startsWith('report-api:') ? { format: 'module', source: sources[url.slice(11)], shortCircuit: true } : next(url, context); },
});
const { POST } = await import('../app/api/admin/reports/route.ts');
const { GET } = await import('../app/api/admin/reports/[reportId]/export/route.ts');
const { parseReportCriteria, previousPeriod } = await import('../lib/reports/criteria.ts');
const { readReportData, MAX_REPORT_ROWS } = await import('../lib/reports/read.ts');
function form(extra = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ reportType: 'PROJECT', startDate: '2026-10-01', endDate: '2026-10-03', operation: 'preview', ...extra })) data.set(key, value);
  return data;
}
const post = (extra = {}) => POST(new Request('http://test/api/admin/reports', { method: 'POST', body: form(extra) }));
const get = (id, format = 'csv') => GET(new Request(`http://test/api/admin/reports/${id}/export?format=${format}`), { params: Promise.resolve({ reportId: id }) });
test.beforeEach(() => {
  user = { id: 'admin-1', role: 'ADMIN', fullName: 'Yönetici' }; calls = []; saved = []; failRefresh = false;
  records = { project: [project()], dailyTask: [task()], legacy: [], projectTimelineEvent: [], projectVisit: [], projectNote: [], taskEvent: [],
    projectFile: [{ id: 'f1', projectId: 'p1', dailyTaskId: 't1', projectVisitId: null, uploadedByUserId: 'u1', originalName: 'Fotoğraf.jpg',
      mimeType: 'image/jpeg', sizeBytes: 1234n, note: 'Ek', createdAt: new Date('2026-10-01T07:00:00Z'), uploadedBy: { fullName: 'Ali' } }] };
  delete process.env.REPORTS_NEW_GENERATION_DISABLED;
});
test('preview uses repeatable read + read only and never writes business models or SavedReport', async () => {
  const response = await post(); assert.equal(response.status, 200);
  const payload = await response.json(); assert.equal(payload.snapshot.schemaVersion, 3); assert.match(payload.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(saved.length, 0); assert.equal(calls[0].options.isolationLevel, 'RepeatableRead');
  assert.equal(calls.filter((item) => item.method === 'readOnly').length, 1);
  const fileQuery = calls.find((call) => call.name === 'projectFile');
  assert.equal(fileQuery.args.select.storagePath, undefined); assert.equal(fileQuery.args.select.thumbnailStoragePath, undefined);
  const timelineQuery = calls.find((call) => call.name === 'projectTimelineEvent' && call.args.select.title);
  assert.equal(timelineQuery.args.take, MAX_REPORT_ROWS + 1);
});
test('save only creates a new report with author snapshot and confirmed server-calculated values', async () => {
  const preview = await (await post()).json(); failRefresh = true;
  const response = await post({ operation: 'save', previewFingerprint: preview.fingerprint }); assert.equal(response.status, 200);
  const payload = await response.json(); assert.equal(saved.length, 1); assert.equal(saved[0].id, payload.id);
  assert.equal(saved[0].snapshot.metadata.createdByName, 'Yönetici'); assert.equal(saved[0].snapshot.metadata.reportId, payload.id);
  assert.equal(saved[0].snapshot.totals['Ölçülmüş ortak görev süresi (dk)'], 120);
});
test('data changed since preview gives a refreshed preview and no report write', async () => {
  const preview = await (await post()).json(); records.dailyTask[0].managerNote = 'Yeni iş planı';
  const response = await post({ operation: 'save', previewFingerprint: preview.fingerprint }); assert.equal(response.status, 409);
  const payload = await response.json(); assert.notEqual(payload.fingerprint, preview.fingerprint); assert.equal(saved.length, 0);
  assert.ok(payload.snapshot.sections.some((section) => JSON.stringify(section.rows).includes('Yeni iş planı')));
});
test('missing/invalid operation and save without a preview cannot create a report', async () => {
  for (const extra of [{ operation: '' }, { operation: 'erase' }, { operation: 'save' }]) {
    assert.equal((await post(extra)).status, 400);
  }
  assert.equal(saved.length, 0); assert.equal(calls.length, 0);
});
test('expired and non-admin users cannot preview, save or export', async () => {
  for (const candidate of [null, { id: 'u1', role: 'PERSONNEL' }, { id: 'o1', role: 'OBSERVER' }]) {
    user = candidate;
    const status = candidate ? 403 : 401;
    assert.equal((await post()).status, status); assert.equal((await get('missing')).status, status);
  }
  assert.equal(calls.length, 0); assert.equal(saved.length, 0);
});
test('exports use only the saved snapshot and preserve creator and metadata in CSV/XLSX', async () => {
  const preview = await (await post()).json(); const result = await (await post({ operation: 'save', previewFingerprint: preview.fingerprint })).json();
  const oldJson = JSON.stringify(saved[0].snapshot); calls = []; records.dailyTask[0].durationMinutes = 999;
  const csv = await get(result.id); assert.equal(csv.status, 200); assert.equal(csv.headers.get('Cache-Control'), 'private, no-store');
  const text = await csv.text(); assert.ok(text.includes(result.id)); assert.ok(text.includes('Yönetici')); assert.ok(text.includes('2026'));
  const xlsx = await get(result.id, 'xlsx'); assert.equal(xlsx.status, 200); assert.match(xlsx.headers.get('Content-Type'), /spreadsheetml/);
  const binary = new Uint8Array(await xlsx.arrayBuffer()); assert.equal(binary[0], 0x50); assert.equal(binary[1], 0x4b);
  assert.equal(calls.length, 0); assert.equal(JSON.stringify(saved[0].snapshot), oldJson);
});
test('report disabled switch preserves existing export while preventing new generation', async () => {
  process.env.REPORTS_NEW_GENERATION_DISABLED = 'true'; assert.equal((await post()).status, 503); assert.equal(calls.length, 0);
  assert.equal((await get('missing')).status, 404);
});
test('row overflow fails explicitly without any saved report', async () => {
  records.dailyTask = Array.from({ length: MAX_REPORT_ROWS + 1 }, (_, i) => ({ ...task(), id: `t${i}` }));
  const response = await post(); assert.equal(response.status, 400); assert.match((await response.json()).error, /10.000/); assert.equal(saved.length, 0);
});

test('assignments have a global query limit and overflow never produces a partial report', async () => {
  records.dailyTaskAssignee = Array.from({ length: MAX_REPORT_ROWS + 1 }, (_, i) => ({ ...task().assignees[0], id: `a${i}`, dailyTaskId: 't1' }));
  const response = await post(); assert.equal(response.status, 400); assert.match((await response.json()).error, /Atama ayrıntısı/);
  const query = calls.find((call) => call.name === 'dailyTaskAssignee'); assert.equal(query.args.take, MAX_REPORT_ROWS + 1); assert.equal(saved.length, 0);
});

test('operation summary actually reads pending media jobs rather than reporting an unmeasured zero', async () => {
  records.uploadSession = [{ id: 'j1', projectId: 'p1', status: 'OPEN', createdAt: new Date('2026-10-01T06:00:00Z'), updatedAt: new Date('2026-10-01T06:00:00Z') }];
  const response = await post({ reportType: 'OPERATIONS' }); assert.equal(response.status, 200);
  const payload = await response.json(); assert.equal(payload.snapshot.totals['Sunucu medya işi'], 1);
});
test('contradictory project/customer filters fail before data selection', async () => {
  const response = await post({ projectId: 'p1', customerId: 'c2' }); assert.equal(response.status, 400);
  assert.equal(calls.some((call) => call.method === 'findMany'), false);
});

test('unexpected database failures do not expose internal messages or save a report', async () => {
  const original = db.project.findMany;
  db.project.findMany = async () => { throw new Error('Internal connection secret and query'); };
  try {
    const response = await post(); assert.equal(response.status, 503);
    const payload = await response.json(); assert.equal(payload.error.includes('Internal'), false); assert.equal(saved.length, 0);
  } finally { db.project.findMany = original; }
});

test('visit author selection includes evidence attached by another administrator', async () => {
  records.projectVisit = [{ id: 'v1', projectId: 'p1', visitedByUserId: 'u1', visitedAt: new Date('2026-10-01T06:00:00Z'), note: 'Kontrol', visitedBy: { fullName: 'Ali' }, _count: { files: 1 } }];
  records.projectFile[0] = { ...records.projectFile[0], dailyTaskId: null, projectVisitId: 'v1', uploadedByUserId: 'admin-1' };
  await readReportData(parseReportCriteria(form({ reportType: 'VISIT', personnelId: 'u1' })), db);
  const files = calls.find((call) => call.name === 'projectFile').args.where;
  assert.deepEqual(files.projectVisitId, { in: ['v1'] }); assert.equal(files.uploadedByUserId, undefined);
  const activity = calls.find((call) => call.name === 'projectTimelineEvent' && call.args.select.title).args.where;
  assert.equal(activity.userId, undefined); assert.equal(activity.OR[1].userId, 'u1');
});
test('source queries apply task/assignment filters and user authored contributions distinctly', async () => {
  await readReportData(parseReportCriteria(form({ personnelId: 'u1', status: 'COMPLETED', workforce: 'PERSONNEL' })), db);
  const taskQuery = calls.find((call) => call.name === 'dailyTask').args;
  assert.equal(taskQuery.where.assignees.some.userId, 'u1');
  const assignmentQuery = calls.find((call) => call.name === 'dailyTaskAssignee').args;
  assert.equal(assignmentQuery.where.workforceKindSnapshot, 'PERSONNEL'); assert.equal(assignmentQuery.where.userId, 'u1');
  assert.deepEqual(assignmentQuery.where.dailyTaskId, { in: ['t1'] }); assert.equal(assignmentQuery.take, MAX_REPORT_ROWS + 1);
  assert.equal(taskQuery.where.status, 'COMPLETED'); assert.deepEqual(taskQuery.select._count.select, { files: true });
  const files = calls.find((call) => call.name === 'projectFile').args;
  assert.deepEqual(files.where.uploadedByUserId, { equals: 'u1' }); assert.deepEqual(files.where.dailyTaskId, { in: ['t1'] });
  assert.equal(calls.some((call) => call.name === 'projectVisit'), false);
});
test('visits combine only canonical and legacy sources, use Istanbul boundaries, lag ignores actor filter', async () => {
  records.projectVisit = [{ id: 'v1', projectId: 'p1', visitedByUserId: 'u1', visitedAt: new Date('2026-10-01T06:00:00Z'), note: 'Kontrol', visitedBy: { fullName: 'Ali' }, _count: { files: 0 } }];
  records.legacy = [{ id: 'legacy1', projectId: 'p1', userId: 'u1', createdAt: new Date('2026-10-02T06:00:00Z'), description: 'Eski ziyaret', user: { fullName: 'Ali' } }];
  records.project[0].visits = records.projectVisit; records.project[0].timelineEvents = records.legacy;
  const data = await readReportData(parseReportCriteria(form({ reportType: 'VISIT', personnelId: 'u1' })), db);
  assert.equal(data.visits.length, 2); assert.equal(data.latestVisits[0].id, 'legacy1');
  const visitQuery = calls.find((call) => call.name === 'projectVisit').args;
  assert.equal(visitQuery.where.visitedAt.gte.toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(visitQuery.where.visitedAt.lt.toISOString(), '2026-10-03T21:00:00.000Z');
  const projectQuery = calls.find((call) => call.name === 'project').args;
  assert.equal(projectQuery.select.visits.where.visitedByUserId, undefined);
  const legacyQuery = calls.find((call) => call.name === 'projectTimelineEvent' && !call.args.select.title).args;
  assert.equal(legacyQuery.where.projectVisitId, null);
});
test('invalid dates/filters are rejected and equal prior period crosses month correctly', () => {
  for (const values of [{ startDate: '2026-02-30' }, { workforce: 'fake' }, { reportType: '__proto__' }, { reportType: 'VISIT', teamId: 'team1' }, { reportType: 'MEDIA', status: 'COMPLETED' }]) assert.throws(() => parseReportCriteria(form(values)));
  const previous = previousPeriod(parseReportCriteria(form({ startDate: '2026-10-01', endDate: '2026-10-03' })));
  assert.equal(previous.startDate.toISOString().slice(0, 10), '2026-09-28'); assert.equal(previous.endDate.toISOString().slice(0, 10), '2026-09-30');
});
