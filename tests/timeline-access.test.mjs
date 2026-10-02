import assert from 'node:assert/strict';
import test from 'node:test';
import { observerTimelineWhere } from '../lib/timeline/access.ts';

// Evaluate the Prisma query against fixtures to check permitted and denied rows.
function matches(row, where) {
  return Object.entries(where).every(([field, condition]) => {
    if (field === 'OR') return condition.some(branch => matches(row, branch));
    if (condition && typeof condition === 'object') {
      if ('in' in condition) return condition.in.includes(row[field]);
      if ('not' in condition) return row[field] !== condition.not;
      throw new Error(`Unsupported condition: ${field}`);
    }
    return row[field] === condition;
  });
}
const scope = observerTimelineWhere('observer-A');
const event = (eventType, extra = {}) => ({ eventType, userId: 'other-user', dailyTaskId: 'task-1', projectVisitId: null, ...extra });

test('observer sees every personnel arrival, departure and task upload regardless of author', () => {
  for (const type of ['ARRIVED_SITE', 'LEFT_SITE', 'FILE_ADDED']) {
    for (const userId of ['personnel-A', 'personnel-B', 'admin', 'observer-A']) {
      assert.equal(matches(event(type, { userId }), scope), true, `${type}: ${userId}`);
    }
  }
});

test('observer sees independent project/quick notes and files from other users', () => {
  for (const type of ['NOTE_ADDED', 'FILE_ADDED']) {
    for (const userId of ['admin', 'observer-B', 'personnel-A']) {
      assert.equal(matches(event(type, { userId, dailyTaskId: null }), scope), true, `${type}: ${userId}`);
    }
  }
});

test('observer keeps access to other users visit events, notes and media', () => {
  for (const type of ['SITE_VISITED', 'NOTE_ADDED', 'FILE_ADDED']) {
    assert.equal(matches(event(type, { dailyTaskId: null, projectVisitId: 'visit-B' }), scope), true);
  }
});

test('task notes, planning, assignments and old task visits keep their existing restrictions', () => {
  for (const type of ['NOTE_ADDED', 'TASK_CREATED', 'TASK_UPDATED', 'PERSON_ASSIGNED', 'SITE_VISITED']) {
    for (const userId of ['admin', 'observer-B', 'observer-A', 'personnel-A']) {
      assert.equal(matches(event(type, { userId }), scope), false, `${type}: ${userId}`);
    }
  }
  assert.equal(matches(event('PROJECT_CREATED', { dailyTaskId: null, userId: 'admin' }), scope), false);
  assert.equal(matches(event('TASK_UPDATED', { dailyTaskId: null, userId: 'admin' }), scope), false);
});

test('observer retains their previously visible independent historical records', () => {
  assert.equal(matches(event('TASK_UPDATED', { dailyTaskId: null, userId: 'observer-A' }), scope), true);
});
