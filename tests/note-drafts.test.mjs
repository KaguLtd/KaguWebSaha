import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react');
const { useNoteDraft } = await import('../lib/client/use-note-draft.ts');
const handles = new Map();
const keyFor = (user = 'observer-A', project = 'project-A', scope = 'quick-note') => `kagu-saha-note-v1:${JSON.stringify([user, project, scope])}`;
function Harness({ name, userId = 'observer-A', projectId = 'project-A', scope = 'quick-note' }) {
  const draft = useNoteDraft(userId, projectId, scope);
  handles.set(name, draft);
  return React.createElement('section', null,
    React.createElement('textarea', { 'aria-label': name, value: draft.value, disabled: !draft.ready, onChange: (event) => draft.setValue(event.target.value) }),
    React.createElement('p', { role: 'status' }, draft.persistenceError),
    ...draft.previousDrafts.map((previous) => React.createElement('button', {
      key: previous.clientItemId, type: 'button', onClick: () => draft.restoreDraft(previous.clientItemId),
    }, `Restore ${name}: ${previous.value}`)));
}
const mount = (...names) => render(React.createElement(React.Fragment, null, ...names.map((name) => React.createElement(Harness, { name, key: name }))));
const rows = (base = keyFor()) => Object.keys(window.localStorage).filter((key) => key === base || key.startsWith(`${base}:writer:`)).map((key) => ({ key, draft: JSON.parse(window.localStorage.getItem(key)) }));
async function capture(name) {
  let submission;
  await act(async () => { submission = handles.get(name).capture('quick-note'); });
  return submission;
}
async function acknowledge(name, submission) {
  let cleared;
  await act(async () => { cleared = handles.get(name).acknowledge(submission); });
  return cleared;
}
test.afterEach(() => { cleanup(); window.localStorage.clear(); handles.clear(); });
test.after(() => dom.window.close());

test('two mounted writers cannot overwrite another draft on retry or erase it on ACK; remount recovers it', async () => {
  const view = mount('tab-A', 'tab-B');
  await waitFor(() => assert.equal(view.getByLabelText('tab-A').disabled, false));
  fireEvent.change(view.getByLabelText('tab-A'), { target: { value: 'A waiting for its ACK' } });
  const sent = await capture('tab-A');
  fireEvent.change(view.getByLabelText('tab-B'), { target: { value: 'B new unsent text' } });
  const retry = await capture('tab-A');
  assert.equal(retry.clientItemId, sent.clientItemId);
  assert.ok(rows().some(({ draft }) => draft.value === 'B new unsent text'));
  assert.equal(await acknowledge('tab-A', sent), true);
  assert.equal(view.getByLabelText('tab-B').value, 'B new unsent text');
  assert.deepEqual(rows().map(({ draft }) => draft.value), ['B new unsent text']);
  view.unmount();
  const restored = mount('remounted');
  await waitFor(() => assert.equal(restored.getByLabelText('remounted').value, 'B new unsent text'));
});

test('ACK for an older edit removes only matching copies and keeps both writers newer values', async () => {
  const legacy = { key: keyFor(), clientItemId: 'legacy-note-001', binding: 'quick-note', value: 'Old submission' };
  window.localStorage.setItem(keyFor(), JSON.stringify(legacy));
  const view = mount('tab-A', 'tab-B');
  await waitFor(() => assert.equal(view.getByLabelText('tab-A').value, legacy.value));
  const sent = await capture('tab-A');
  assert.equal(sent.clientItemId, legacy.clientItemId);
  fireEvent.change(view.getByLabelText('tab-A'), { target: { value: 'A newer edit during request' } });
  fireEvent.change(view.getByLabelText('tab-B'), { target: { value: 'B different new note' } });
  assert.equal(await acknowledge('tab-A', sent), false);
  assert.equal(view.getByLabelText('tab-A').value, 'A newer edit during request');
  assert.equal(view.getByLabelText('tab-B').value, 'B different new note');
  assert.equal(window.localStorage.getItem(keyFor()), JSON.stringify(legacy), 'ACK never mutates the legacy shared slot');
  assert.deepEqual(rows().filter(({ draft }) => draft.clientItemId !== legacy.clientItemId).map(({ draft }) => draft.value).sort(), ['A newer edit during request', 'B different new note'].sort());
  assert.deepEqual(handles.get('tab-A').previousDrafts.map((draft) => draft.value), ['B different new note']);
});

test('latest nonempty recovery exposes alternatives, and choosing one preserves the previous active draft', async () => {
  const base = keyFor();
  const first = { key: base, clientItemId: 'first-draft-001', binding: 'quick-note', value: 'First alternative', updatedAt: 10 };
  const second = { key: base, clientItemId: 'second-draft-01', binding: 'quick-note', value: 'Latest alternative', updatedAt: 20 };
  window.localStorage.setItem(`${base}:writer:old-A`, JSON.stringify(first));
  window.localStorage.setItem(`${base}:writer:old-B`, JSON.stringify(second));
  const view = mount('restored');
  await waitFor(() => assert.equal(view.getByLabelText('restored').value, second.value));
  fireEvent.click(view.getByText(`Restore restored: ${first.value}`));
  assert.equal(view.getByLabelText('restored').value, first.value);
  assert.ok(view.getByText(`Restore restored: ${second.value}`));
  const sent = await capture('restored');
  assert.equal(sent.clientItemId, first.clientItemId);
  assert.equal(await acknowledge('restored', sent), true);
  assert.deepEqual(handles.get('restored').previousDrafts.map((draft) => draft.value), [second.value]);
  assert.ok(rows().some(({ draft }) => draft.value === first.value), 'immutable ACK filters an old copy without deleting another writer');
  view.unmount();
  const remounted = mount('after-ack');
  await waitFor(() => assert.equal(remounted.getByLabelText('after-ack').value, second.value));
});

test('storage events expose another tab text without replacing local input, and account/project/scope remain isolated', async () => {
  const view = mount('local');
  await waitFor(() => assert.equal(view.getByLabelText('local').disabled, false));
  fireEvent.change(view.getByLabelText('local'), { target: { value: 'Local typing' } });
  const externalKey = `${keyFor()}:writer:external-tab`;
  window.localStorage.setItem(externalKey, JSON.stringify({ key: keyFor(), clientItemId: 'external-note-01', binding: 'quick-note', value: 'External tab draft', updatedAt: Date.now() + 1000 }));
  for (const key of [keyFor('observer-B'), keyFor('observer-A', 'project-B'), keyFor('observer-A', 'project-A', 'files')]) {
    window.localStorage.setItem(`${key}:writer:other`, JSON.stringify({ key, clientItemId: 'isolated-note-01', binding: 'quick-note', value: 'Must remain isolated', updatedAt: Date.now() + 2000 }));
  }
  await act(async () => { window.dispatchEvent(new window.StorageEvent('storage', { key: externalKey })); });
  assert.equal(view.getByLabelText('local').value, 'Local typing');
  assert.deepEqual(handles.get('local').previousDrafts.map((draft) => draft.value), ['External tab draft']);
  fireEvent.click(view.getByText('Restore local: External tab draft'));
  assert.equal(view.getByLabelText('local').value, 'External tab draft');
  assert.ok(view.getByText('Restore local: Local typing'));
});

test('repeated typing updates one writer slot and retains the same retry ID for unchanged submitted text', async () => {
  const view = mount('single');
  await waitFor(() => assert.equal(view.getByLabelText('single').disabled, false));
  for (let index = 0; index < 100; index++) fireEvent.change(view.getByLabelText('single'), { target: { value: `Typed note ${index}` } });
  assert.equal(rows().length, 1);
  assert.equal(window.localStorage.getItem(keyFor()), null, 'new writes never overwrite the shared legacy base key');
  const first = await capture('single');
  const retry = await capture('single');
  assert.equal(first.clientItemId, retry.clientItemId);
  assert.equal(rows().length, 1);
});

test('ACK never deletes another mutable writer slot, even when new text arrives between a read and potential deletion', async () => {
  const legacy = { key: keyFor(), clientItemId: 'race-original-001', binding: 'quick-note', value: 'Original shared revision' };
  window.localStorage.setItem(keyFor(), JSON.stringify(legacy));
  const view = mount('tab-A', 'tab-B');
  await waitFor(() => assert.equal(view.getByLabelText('tab-A').value, legacy.value));
  const sent = await capture('tab-A');
  const aSlot = rows().find(({ key }) => key !== keyFor()).key;
  await capture('tab-B');
  const bSlot = rows().find(({ key }) => key !== keyFor() && key !== aSlot).key;
  const prototype = Object.getPrototypeOf(window.localStorage);
  const originalGet = prototype.getItem;
  const originalSet = prototype.setItem;
  const originalRemove = prototype.removeItem;
  let readsOfB = 0;
  let interleaved = false;
  const removals = [];
  const newer = { ...legacy, clientItemId: 'race-newer-note-001', value: 'B wrote new text in the read/delete gap', updatedAt: Date.now() + 1000 };
  prototype.getItem = function (key) {
    const previous = originalGet.call(this, key);
    // The first read discovers copies; the second read simulates the former
    // compare/remove window. It returns old data while another tab writes new data.
    if (key === bSlot && ++readsOfB === 2) {
      originalSet.call(this, bSlot, JSON.stringify(newer));
      interleaved = true;
    }
    return previous;
  };
  prototype.removeItem = function (key) { removals.push(key); return originalRemove.call(this, key); };
  try {
    assert.equal(await acknowledge('tab-A', sent), true);
    assert.equal(interleaved, true);
    assert.equal(JSON.parse(originalGet.call(window.localStorage, bSlot)).value, newer.value);
    assert.deepEqual(removals, [aSlot], 'only the acknowledging hook owns the removed slot');
    assert.equal(originalGet.call(window.localStorage, keyFor()), JSON.stringify(legacy));
    const marker = JSON.parse(originalGet.call(window.localStorage, `${keyFor()}:ack:${sent.clientItemId}`));
    assert.deepEqual(Object.keys(marker).sort(), ['acknowledgedAt', 'clientItemId']);
  } finally {
    prototype.getItem = originalGet; prototype.setItem = originalSet; prototype.removeItem = originalRemove;
  }
  view.unmount();
  const restored = mount('restored-newer');
  await waitFor(() => assert.equal(restored.getByLabelText('restored-newer').value, newer.value));
  assert.equal(handles.get('restored-newer').previousDrafts.some((draft) => draft.clientItemId === sent.clientItemId), false);
});

test('legacy and other writer copies of an acknowledged revision stay filtered after remount and stale retries', async () => {
  const legacy = { key: keyFor(), clientItemId: 'ack-copies-note-01', binding: 'quick-note', value: 'Already saved text' };
  window.localStorage.setItem(keyFor(), JSON.stringify(legacy));
  const view = mount('tab-A', 'tab-B');
  await waitFor(() => assert.equal(view.getByLabelText('tab-A').value, legacy.value));
  const submission = await capture('tab-A');
  await capture('tab-B');
  assert.equal(await acknowledge('tab-A', submission), true);
  assert.ok(rows().some(({ draft }) => draft.clientItemId === submission.clientItemId));
  // An old mounted tab can still explicitly retry its old revision. Its immutable
  // ACK remains authoritative and it cannot become a recovered draft again.
  assert.equal((await capture('tab-B')).clientItemId, submission.clientItemId);
  view.unmount();
  const after = mount('after');
  await waitFor(() => assert.equal(after.getByLabelText('after').disabled, false));
  assert.equal(after.getByLabelText('after').value, '');
  assert.deepEqual(handles.get('after').previousDrafts, []);
});
