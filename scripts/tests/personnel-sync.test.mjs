import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

// Real handler and idempotency receipt, isolated from Prisma and real users.
const state = { tasks: new Map(), receipts: new Map(), events: [], timeline: [], notes: [] };
let failNextCommit = false;
globalThis.__personnelUser = { id: 'person-A', role: 'PERSONNEL' };
const db = {
  $queryRaw: async () => [],
  offlinePendingItem: {
    create: async ({ data }) => { if (state.receipts.has(data.clientItemId)) throw Object.assign(new Error('duplicate'), { code: 'P2002' }); state.receipts.set(data.clientItemId, structuredClone(data)); return data; },
    update: async ({ where, data }) => { Object.assign(state.receipts.get(where.clientItemId), data); return data; },
    findUnique: async ({ where }) => state.receipts.get(where.clientItemId) ?? null,
  },
  dailyTask: {
    findFirst: async ({ where }) => {
      if (where.id?.not) return [...state.tasks.values()].find((task) => task.id !== where.id.not && task.status === 'ON_SITE' && task.taskDate.getTime() === where.taskDate.getTime() && task.assignees.some((a) => where.assignees.some.userId.in.includes(a.userId))) ?? null;
      const task = state.tasks.get(where.id);
      return task?.assignees.some((a) => a.userId === where.assignees.some.userId) ? task : null;
    },
    update: async ({ where, data }) => { Object.assign(state.tasks.get(where.id), data); return state.tasks.get(where.id); },
  },
  dailyTaskAssignee: { update: async ({ data }) => { Object.assign([...state.tasks.values()][0].assignees[0], data); return data; } },
  taskEvent: { create: async ({ data }) => { state.events.push(data); return data; } },
  projectTimelineEvent: {
    create: async ({ data }) => { state.timeline.push(data); return data; },
    findFirst: async ({ where }) => state.timeline.find((e) => e.dailyTaskId === where.dailyTaskId && e.userId === where.userId && e.eventType === where.eventType && e.createdAt >= where.createdAt.gte && e.createdAt < where.createdAt.lt) ?? null,
  },
  projectNote: { create: async ({ data }) => { state.notes.push(data); return data; } },
  user: { updateMany: async () => ({ count: 1 }) },
  $transaction: async (run) => {
    const previous = structuredClone(state);
    try { const result = await run(db); if (failNextCommit) { failNextCommit = false; throw new Error('injected commit failure'); } return result; }
    catch (error) { Object.assign(state, previous); throw error; }
  },
};
globalThis.__personnelDb = db;
const mocks = {
  db: 'export const prisma = globalThis.__personnelDb;',
  auth: 'export async function getCurrentUser(){return globalThis.__personnelUser;}',
  server: 'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
  media: 'export async function recordProjectUpload(){} export function scheduleHeicConversionProcessing(){}',
  storage: 'export async function saveProjectUpload(){throw new Error("legacy disk failure");}',
};
registerHooks({
  resolve(specifier, context, next) {
    const key = ({ '@/lib/db/prisma': 'db', '@/lib/auth/session': 'auth', 'next/server': 'server', '@/lib/files/heic-conversion-jobs': 'media', '@/lib/files/storage': 'storage' })[specifier];
    return key ? { url: `personnel-test:${key}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) { return url.startsWith('personnel-test:') ? { format: 'module', source: mocks[url.slice(15)], shortCircuit: true } : next(url, context); },
});
const { POST } = await import('../../app/api/offline/sync/route.ts');
const { sameOperationPayload, operationKey } = await import('../../lib/offline/operation-key.ts');
const { eventOccurredAt } = await import('../../lib/personnel/event-policy.ts');

test('receipt equality survives JSONB key reordering and preserves array/value differences', () => {
  assert.equal(sameOperationPayload({ task: 'A', nested: { note: 'n', n: 0 } }, { nested: { n: 0, note: 'n' }, task: 'A' }), true);
  assert.equal(sameOperationPayload({ files: [1, 2] }, { files: [2, 1] }), false);
  assert.equal(sameOperationPayload({ n: 0 }, { n: null }), false);
  assert.notEqual(operationKey('A', 'client-id-1'), operationKey('B', 'client-id-1'));
  assert.throws(() => operationKey('A', 'bad!'));
});
test('event time validates the application day and rejects future time', () => {
  const day = new Date('2026-09-30T00:00:00Z'); const now = new Date('2026-09-30T10:00:00Z');
  assert.equal(eventOccurredAt('2026-09-29T21:00:00Z', day, now).toISOString(), '2026-09-29T21:00:00.000Z');
  assert.throws(() => eventOccurredAt('2026-09-29T20:59:59Z', day, now));
  assert.throws(() => eventOccurredAt('2026-09-30T10:02:00Z', day, now));
});
test('personnel replay commits once, retains failed transactions and never reopens a past task', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T10:00:00Z') });
  const task = { id: 'task-A', projectId: 'project-A', taskDate: new Date('2026-09-30T00:00:00Z'), status: 'PLANNED', arrivedAt: null, leftAt: null, assignees: [{ id: 'assignment-A', userId: 'person-A', workforceKindSnapshot: 'CONTRACTOR', headcountSnapshot: 5 }] };
  state.tasks.set(task.id, task);
  const send = (type, clientItemId, extra = {}) => POST(new Request('http://test/api/offline/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, taskId: task.id, ownerUserId: 'person-A', clientItemId, occurredAt: '2026-09-30T09:00:00Z', ...extra }) }));
  assert.equal((await send('ARRIVED_SITE', 'arrival-001', { ownerUserId: 'person-B' })).status, 401);
  assert.equal((await send('LEFT_SITE', 'leave-first')).status, 400);
  failNextCommit = true;
  assert.equal((await send('ARRIVED_SITE', 'arrival-001', { actualHeadcount: 0 })).status, 503);
  assert.equal(state.tasks.get(task.id).status, 'PLANNED'); assert.equal(state.events.length, 0); assert.equal(state.receipts.size, 0);
  assert.equal((await send('ARRIVED_SITE', 'arrival-001', { actualHeadcount: 0 })).status, 200);
  assert.equal(state.tasks.get(task.id).assignees[0].actualHeadcount, 0);
  const receipt = state.receipts.get('person-A:arrival-001'); receipt.payload.request = Object.fromEntries(Object.entries(receipt.payload.request).reverse());
  assert.equal((await send('ARRIVED_SITE', 'arrival-001', { actualHeadcount: 0 })).status, 200); assert.equal(state.events.length, 1);
  assert.equal((await send('ARRIVED_SITE', 'arrival-001', { actualHeadcount: 4 })).status, 400);
  assert.equal((await send('LEFT_SITE', 'leave-no-note', { occurredAt: '2026-09-30T09:30:00Z' })).status, 400);
  assert.equal((await send('NOTE', 'note-00001', { note: 'İş tamamlandı' })).status, 200);
  assert.equal((await send('NOTE', 'note-00001', { note: 'İş tamamlandı' })).status, 200); assert.equal(state.notes.length, 1);
  assert.equal(state.timeline.at(-1).eventType, 'NOTE_ADDED');
  assert.equal((await send('LEFT_SITE', 'leave-0001', { occurredAt: '2026-09-30T09:30:00Z' })).status, 200);
  assert.equal(state.tasks.get(task.id).durationMinutes, 30);
  assert.equal((await send('ARRIVED_SITE', 'arrival-002')).status, 400);
  const past = state.tasks.get(task.id); past.taskDate = new Date('2026-09-29T00:00:00Z'); past.arrivedAt = null; past.leftAt = null; past.durationMinutes = null;
  assert.equal((await send('ARRIVED_SITE', 'past-arrival', { occurredAt: '2026-09-29T09:00:00Z' })).status, 200);
  assert.equal(state.tasks.get(task.id).status, 'COMPLETED');
});

test('past notes allow task day7, retain day8 failures and replay an already saved receipt after the cutoff', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T10:00:00Z') });
  const task = { id: 'past-note-task', projectId: 'project-A', taskDate: new Date('2026-09-24T00:00:00Z'), status: 'COMPLETED', assignees: [{ userId: 'person-A' }] };
  state.tasks.set(task.id, task);
  const send = (id) => POST(new Request('http://test/api/offline/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerUserId: 'person-A', type: 'NOTE', taskId: task.id, clientItemId: id, note: 'Gecikmiş not', occurredAt: '2026-09-24T09:00:00Z' }) }));
  const before = state.notes.length;
  assert.equal((await send('day7-note-001')).status, 200); assert.equal(state.notes.length, before + 1);
  t.mock.timers.setTime(new Date('2026-10-02T10:00:00Z').getTime());
  assert.equal((await send('day8-note-001')).status, 400); assert.equal(state.notes.length, before + 1);
  assert.equal((await send('day7-note-001')).status, 200); assert.equal(state.notes.length, before + 1);
  assert.equal(state.receipts.has('person-A:day8-note-001'), false);
});

test('unexpected persistence failures log a Prisma code without leaking the database message or request note', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));
  t.mock.method(db.dailyTask, 'findFirst', async () => {
    throw Object.assign(new Error('postgresql://user:private-db-password@db/live; sensitive-note'), { code: 'P2022', meta: { message: 'private-db-password' } });
  });
  const response = await POST(new Request('http://test/api/offline/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerUserId: 'person-A', type: 'NOTE', taskId: 'task-A', clientItemId: 'diagnostic-note-001', note: 'sensitive-note' }) }));
  assert.equal(response.status, 503);
  assert.match(JSON.stringify(logged), /P2022/);
  for (const output of [JSON.stringify(logged), JSON.stringify(await response.json())]) {
    assert.doesNotMatch(output, /private-db-password|sensitive-note|postgresql/);
  }
  assert.equal(state.receipts.has('person-A:diagnostic-note-001'), false);
});
