import assert from 'node:assert/strict';
import test from 'node:test';

import { canAttachToVisit, getVisitAgeDays, getVisitDayKey, getVisitStatus, summarizeVisits } from '../lib/visits/status.ts';
import { readProjectVisits } from '../lib/visits/read.ts';
import { getDateOnlyRangeInAppTimeZone } from '../lib/dates/today.ts';

test('visit warning thresholds use Istanbul calendar days: 15/16 and 30/31', () => {
  const now = new Date('2026-09-30T09:00:00Z');
  for (const [date, expected] of [
    ['2026-09-15T20:59:59Z', 'CURRENT'],
    ['2026-09-14T21:00:00Z', 'CURRENT'],
    ['2026-09-14T20:59:59Z', 'WARNING'],
    ['2026-08-31T10:00:00Z', 'WARNING'],
    ['2026-08-30T10:00:00Z', 'OVERDUE'],
  ]) assert.equal(getVisitStatus(new Date(date), now), expected, date);
  assert.equal(getVisitStatus(null, now), 'NEVER');
  assert.equal(getVisitAgeDays(new Date('2026-10-01T10:00:00Z'), now), 0);
});

test('midnight is the existing application midnight, independent of device timezone', () => {
  assert.equal(getVisitDayKey(new Date('2026-09-29T20:59:59Z')), '2026-09-29');
  assert.equal(getVisitDayKey(new Date('2026-09-29T21:00:00Z')), '2026-09-30');
  const range = getDateOnlyRangeInAppTimeZone(new Date('2026-09-30T00:00:00Z'));
  assert.equal(range.start.toISOString(), '2026-09-29T21:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-09-30T21:00:00.000Z');
});

test('two visits to one site count as one site and two visits', () => {
  assert.deepEqual(summarizeVisits([{ projectId: 'a' }, { projectId: 'a' }, { projectId: 'b' }]), { projects: 2, visits: 3 });
  assert.deepEqual(summarizeVisits([]), { projects: 0, visits: 0 });
});

test('observer can attach only to own visit; administrator can attach to another visit', () => {
  assert.equal(canAttachToVisit('OBSERVER', 'a', 'a'), true);
  assert.equal(canAttachToVisit('OBSERVER', 'a', 'b'), false);
  assert.equal(canAttachToVisit('ADMIN', 'a', 'b'), true);
});

function fixtures() {
  const project = { name: 'Şantiye', customer: { name: 'Cari' } };
  const visit = (id, projectId, date) => ({ id, projectId, project, visitedByUserId: 'observer', visitedBy: { fullName: 'Kontrol' }, visitedAt: new Date(date), note: null, _count: { files: 2 } });
  const legacy = (id, projectId, date) => ({ id, projectId, project, userId: 'observer', user: { fullName: 'Kontrol' }, createdAt: new Date(date), description: null });
  const calls = [];
  const database = {
    projectVisit: { findMany: async (query) => { calls.push(['visit', query]); return [visit('new-a', 'a', '2026-09-29T10:00:00Z'), visit('new-b', 'b', '2026-09-28T10:00:00Z')]; } },
    projectTimelineEvent: { findMany: async (query) => { calls.push(['legacy', query]); return [legacy('old-a', 'a', '2026-09-30T10:00:00Z')]; } },
  };
  return { database, calls };
}

test('read combines canonical and historical visits without reading the canonical timeline counterpart', async () => {
  const { database, calls } = fixtures();
  const records = await readProjectVisits({}, database);
  assert.equal(records.length, 3);
  assert.equal(calls.find(([kind]) => kind === 'legacy')[1].where.projectVisitId, null);
  assert.equal(calls.find(([kind]) => kind === 'legacy')[1].where.eventType, 'SITE_VISITED');
  assert.equal(records[0].id, 'old-a');
  assert.equal(records[0].fileCount, null);
  assert.deepEqual(summarizeVisits(records), { projects: 2, visits: 3 });
});

test('observer summary queries both sources with owner, active project and exclusive day bounds', async () => {
  const { database, calls } = fixtures();
  const start = new Date('2026-09-29T21:00:00Z');
  const end = new Date('2026-09-30T21:00:00Z');
  await readProjectVisits({ userId: 'observer', activeOnly: true, start, end }, database);
  for (const [kind, query] of calls) {
    assert.deepEqual(query.where.project, { isActive: true });
    assert.equal(query.where[kind === 'visit' ? 'visitedByUserId' : 'userId'], 'observer');
    assert.deepEqual(query.where[kind === 'visit' ? 'visitedAt' : 'createdAt'], { gte: start, lt: end });
  }
});

test('latest project date considers legacy visits and never rewrites stored data', async () => {
  const { database, calls } = fixtures();
  const records = await readProjectVisits({ projectIds: ['a', 'b'], latestPerProject: true }, database);
  assert.equal(records.length, 2);
  assert.equal(records.find((record) => record.projectId === 'a').id, 'old-a');
  assert.equal(records.find((record) => record.projectId === 'b').id, 'new-b');
  for (const [, query] of calls) assert.deepEqual(query.distinct, ['projectId']);
  assert.deepEqual(await readProjectVisits({ projectIds: [] }, database), []);
  assert.equal(calls.length, 2);
});
