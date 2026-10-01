import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const receipts = new Map();
globalThis.__recentUploadTest = { list: async (userId) => receipts.get(userId) ?? [] };
registerHooks({
  resolve(specifier, context, next) {
    return specifier === '@/lib/offline/queue' ? { url: 'recent-upload-dom:queue', shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url === 'recent-upload-dom:queue' ? { format: 'module', source: 'export const listSuccessfulUploads=(userId)=>globalThis.__recentUploadTest.list(userId); export const refreshSuccessfulUploads=listSuccessfulUploads;', shortCircuit: true } : next(url, context);
  },
});
const React = await import('react');
const { render, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react');
const { RecentUploadResults } = await import('../components/personnel/recent-upload-results.tsx');
const receipt = (owner, name) => ({ id: `${owner}:upload-${owner}`, uploadedByUserId: owner, uploadId: `upload-${owner}`, originalName: name, completedAt: new Date().toISOString(), projectFileId: null });
const result = (owner, name) => ({ uploadId: `upload-${owner}`, originalName: name, completedAt: new Date().toISOString(), projectFileId: `file-${owner}`, status: 'READY', canRead: true });
const response = (owner, name) => Response.json({ ok: true, userId: owner, results: [result(owner, name)] });
const component = (owner) => React.createElement(RecentUploadResults, { userId: owner });
test.afterEach(() => { cleanup(); receipts.clear(); });
test.after(() => dom.window.close());

test('hanging JSON body times out, retains local receipts and releases the refresh lock', async () => {
  receipts.set('A', [receipt('A', 'A-yerel.jpg')]);
  let bodyStarted = false; let requestSignal;
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal;
    return { ok: true, status: 200, redirected: false, json: () => { bodyStarted = true; return new Promise(() => {}); } };
  };
  // Accelerate only the production 15-second timer; the real requestJson still
  // handles headers, body decoding, timeout/abort and lock recovery.
  const originalTimeout = globalThis.setTimeout;
  let boundedRequest = false;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 15_000) boundedRequest = true;
    return originalTimeout(callback, delay === 15_000 ? 30 : delay, ...args);
  };
  try {
    const view = render(component('A'));
    await waitFor(() => assert.equal(bodyStarted, true));
    await waitFor(() => assert.match(view.getByRole('status').textContent, /Sunucu sonuçları şu anda okunamadı/));
    assert.equal(boundedRequest, true); assert.equal(requestSignal.aborted, true); assert.ok(view.getByText('A-yerel.jpg'));
    globalThis.fetch = async () => response('A', 'A-hazir.jpg');
    fireEvent.click(view.getByText('Yenile'));
    await waitFor(() => assert.ok(view.getByText('A-hazir.jpg')));
    assert.equal(view.getByText('Dosyayı aç').getAttribute('href'), '/api/files/file-A');
  } finally { globalThis.setTimeout = originalTimeout; }
});

test('a new owner render hides previous account metadata before passive effects reset it', async () => {
  globalThis.fetch = async () => response('A', 'A-gizli.jpg');
  const committed = [];
  function Probe({ owner }) {
    React.useLayoutEffect(() => { committed.push({ owner, text: document.body.textContent }); }, [owner]);
    return component(owner);
  }
  const view = render(React.createElement(Probe, { owner: 'A' }));
  await waitFor(() => assert.ok(view.getByText('A-gizli.jpg')));
  let finishB;
  globalThis.fetch = () => new Promise((resolve) => { finishB = resolve; });
  view.rerender(React.createElement(Probe, { owner: 'B' }));
  const firstBCommit = committed.find((commit) => commit.owner === 'B');
  assert.ok(firstBCommit); assert.equal(firstBCommit.text.includes('A-gizli.jpg'), false);
  assert.equal(firstBCommit.text.includes('Dosyayı aç'), false);
  await waitFor(() => assert.equal(typeof finishB, 'function'));
  await act(async () => { finishB(response('B', 'B-hazir.jpg')); });
  await waitFor(() => assert.ok(view.getByText('B-hazir.jpg')));
});

test('an aborted old request cannot block or overwrite the new owner reload', async () => {
  let finishA; let signalA; let calls = 0;
  globalThis.fetch = (_url, options) => {
    calls++;
    if (calls === 1) { signalA = options.signal; return new Promise((resolve) => { finishA = resolve; }); }
    return Promise.resolve(response('B', 'B-kendi.jpg'));
  };
  const view = render(component('A'));
  await waitFor(() => assert.equal(typeof finishA, 'function'));
  view.rerender(component('B'));
  await waitFor(() => assert.ok(view.getByText('B-kendi.jpg')));
  assert.equal(signalA.aborted, true); assert.equal(calls, 2);
  await act(async () => { finishA(response('A', 'A-gecikmis.jpg')); });
  assert.equal(view.queryByText('A-gecikmis.jpg'), null); assert.ok(view.getByText('B-kendi.jpg'));
});

test('wrong server owner and expired session hide local account receipts instead of offering a file link', async () => {
  receipts.set('A', [receipt('A', 'A-teslim.jpg')]);
  globalThis.fetch = async () => response('B', 'B-dosyasi.jpg');
  const view = render(component('A'));
  await waitFor(() => assert.match(view.getByRole('status').textContent, /Oturum veya hesap değişti/));
  assert.equal(view.queryByText('A-teslim.jpg'), null); assert.equal(view.queryByText('B-dosyasi.jpg'), null); assert.equal(view.queryByText('Dosyayı aç'), null);
  globalThis.fetch = async () => Response.json({ ok: false }, { status: 401 });
  await act(async () => { fireEvent.click(view.getByText('Yenile')); });
  await waitFor(() => assert.match(view.getByRole('status').textContent, /Oturum veya hesap değişti/));
  assert.equal(view.queryByText('A-teslim.jpg'), null);
});
