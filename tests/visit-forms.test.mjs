import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'FormData', 'File', 'Blob', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const router = { refresh: () => {} };
const queued = [];
globalThis.__visitForms = { router, enqueue: async (input) => { queued.push(input); return [{ id: 'durable-file' }]; } };
const mockSources = {
  navigation: 'export const useRouter=()=>globalThis.__visitForms.router;',
  queue: 'export const enqueueVisitUploads=(input)=>globalThis.__visitForms.enqueue(input); export const listOfflineItems=async()=>[]; export const syncOfflineItems=async()=>({synced:0,failedIds:[],remaining:0});',
};
registerHooks({
  resolve(specifier, context, next) {
    const key = ({ 'next/navigation': 'navigation', '@/lib/offline/queue': 'queue' })[specifier];
    return key ? { url: `visit-dom:${key}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) { return url.startsWith('visit-dom:') ? { format: 'module', source: mockSources[url.slice(10)], shortCircuit: true } : next(url, context); },
});
const React = await import('react');
const { render, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react');
const { VisitInteractionPanel } = await import('../components/admin/visit-interaction-panel.tsx');
const { QuickProjectNote } = await import('../components/admin/quick-project-note.tsx');
const { getVisitDayKey } = await import('../lib/visits/status.ts');
const panel = (userId = 'observer-A') => render(React.createElement(VisitInteractionPanel, { userId, projectId: 'project-A', currentDay: getVisitDayKey() }));
const quick = () => render(React.createElement(QuickProjectNote, { userId: 'observer-A', projectId: 'project-A', projectName: 'Şantiye' }));
const ok = (extra = {}) => Response.json({ ok: true, ...extra });
test.afterEach(() => { cleanup(); window.localStorage.clear(); queued.length = 0; });
test.after(() => dom.window.close());

test('real note form preserves text and retry ID for HTML/redirect/malformed/negative ACKs', async () => {
  const view = panel();
  const field = view.getByLabelText('Not ekle');
  await waitFor(() => assert.equal(field.disabled, false));
  fireEvent.change(field, { target: { value: 'Kaybolmaması gereken not' } });
  const failures = [
    () => new Response('<html>Login</html>', { status: 200 }),
    () => Object.defineProperty(ok(), 'redirected', { value: true }),
    () => Response.json({}),
    () => Response.json({ ok: false }),
    () => Response.json({ ok: false, error: 'Oturum bitti' }, { status: 401 }),
  ];
  const ids = [];
  for (const response of failures) {
    globalThis.fetch = async (_url, options) => { ids.push(options.body.get('clientItemId')); return response(); };
    fireEvent.submit(field.closest('form'));
    await waitFor(() => assert.equal(view.getByText('Kaydet').disabled, false));
    assert.equal(field.value, 'Kaybolmaması gereken not'); assert.equal(Boolean(view.queryByText('Not eklendi.')), false);
  }
  assert.equal(new Set(ids).size, 1);
  globalThis.fetch = async () => ok();
  fireEvent.submit(field.closest('form'));
  await waitFor(() => assert.equal(field.value, ''));
  assert.ok(view.getByText('Not eklendi.'));
});
test('a successful ACK for the old note keeps text typed while the request was pending', async () => {
  const view = panel(); const field = view.getByLabelText('Not ekle');
  await waitFor(() => assert.equal(field.disabled, false));
  fireEvent.change(field, { target: { value: 'Gönderilen not' } });
  let finish; globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
  fireEvent.submit(field.closest('form'));
  await waitFor(() => assert.equal(typeof finish, 'function'));
  fireEvent.change(field, { target: { value: 'Yanıt beklerken yeni not' } });
  await act(async () => { finish(ok()); });
  await waitFor(() => assert.equal(view.getByText('Kaydet').disabled, false));
  assert.equal(field.value, 'Yanıt beklerken yeni not'); assert.ok(view.getByText(/Yeni düzenlemeniz taslakta korunuyor/));
});
test('draft and retry identity restore after remount and do not cross accounts', async () => {
  const ids = []; globalThis.fetch = async (_url, options) => { ids.push(options.body.get('clientItemId')); return Response.json({ ok: false }, { status: 401 }); };
  let view = panel(); let field = view.getByLabelText('Not ekle');
  await waitFor(() => assert.equal(field.disabled, false));
  fireEvent.change(field, { target: { value: 'Kalıcı taslak' } }); fireEvent.submit(field.closest('form'));
  await waitFor(() => assert.equal(view.getByText('Kaydet').disabled, false)); view.unmount();
  view = panel('observer-B'); field = view.getByLabelText('Not ekle');
  await waitFor(() => assert.equal(field.disabled, false)); assert.equal(field.value, ''); view.unmount();
  view = panel(); field = view.getByLabelText('Not ekle');
  await waitFor(() => assert.equal(field.value, 'Kalıcı taslak')); fireEvent.submit(field.closest('form'));
  await waitFor(() => assert.equal(view.getByText('Kaydet').disabled, false)); assert.equal(ids[0], ids[1]);
});
test('quick note keeps its drawer/draft on invalid ACK and preserves edits made during save', async () => {
  const view = quick(); fireEvent.click(view.getByText('Hizli Not Ekle'));
  const field = view.getByLabelText('Not'); await waitFor(() => assert.equal(field.disabled, false));
  fireEvent.change(field, { target: { value: 'Hızlı taslak' } });
  globalThis.fetch = async () => new Response('<html>Login</html>');
  fireEvent.submit(field.closest('form'));
  await waitFor(() => assert.ok(view.getByRole('alert'))); assert.ok(view.getByRole('dialog')); assert.equal(field.value, 'Hızlı taslak');
  let finish; globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
  fireEvent.submit(field.closest('form')); await waitFor(() => assert.equal(typeof finish, 'function'));
  fireEvent.change(field, { target: { value: 'Yeni hızlı taslak' } });
  await act(async () => { finish(ok()); });
  await waitFor(() => assert.equal(view.getByText('Kaydet').disabled, false)); assert.ok(view.getByRole('dialog')); assert.equal(field.value, 'Yeni hızlı taslak');
});
test('quick note durably queues originals once before its separate request; retry does not resend files', async () => {
  const view = quick(); fireEvent.click(view.getByText('Hizli Not Ekle'));
  const field = view.getByLabelText('Not'); await waitFor(() => assert.equal(field.disabled, false));
  fireEvent.change(field, { target: { value: 'Dosyalı not' } });
  const input = view.container.querySelector('input[type=file]');
  const file = new File(['photo'], 'saha.jpg', { type: 'image/jpeg' });
  // jsdom FormData reads the input selection; supply its form-backed getAll for this case.
  const OriginalFormData = globalThis.FormData;
  class SelectedFormData extends OriginalFormData {
    constructor(form) { super(form); this.selected = Boolean(form); }
    getAll(name) { return this.selected && name === 'files' ? [file] : super.getAll(name); }
  }
  globalThis.FormData = SelectedFormData;
  try {
    const requests = [];
    globalThis.fetch = async (_url, options) => { requests.push(options.body); assert.equal(queued.length, 1); return Response.json({ ok: false }, { status: 401 }); };
    fireEvent.submit(field.closest('form'));
    await waitFor(() => assert.ok(view.getByRole('alert')));
    assert.equal(queued.length, 1); assert.equal(queued[0].files[0].name, file.name); assert.equal(requests[0].getAll('files').length, 0); assert.equal(input.value, '');
    globalThis.FormData = OriginalFormData;
    globalThis.fetch = async (_url, options) => { requests.push(options.body); return ok(); };
    fireEvent.submit(field.closest('form'));
    await waitFor(() => assert.equal(Boolean(view.queryByRole('dialog')), false));
    assert.equal(queued.length, 1); assert.equal(requests[0].get('clientItemId'), requests[1].get('clientItemId'));
  } finally { globalThis.FormData = OriginalFormData; }
});
test('visit operation requires an actual visit ID, even with ok:true', async () => {
  const view = panel(); const field = view.getByLabelText('Ziyaret notu');
  await waitFor(() => assert.equal(field.disabled, false)); fireEvent.change(field, { target: { value: 'Ziyaret taslağı' } });
  fireEvent.click(view.getByText('Ziyaret Ettim'));
  globalThis.fetch = async () => ok(); fireEvent.click(view.getByText('Sahada misin?'));
  await waitFor(() => assert.ok(view.getByText(/Ziyaret kaydı doğrulanamadı/)));
  assert.equal(field.value, 'Ziyaret taslağı'); assert.equal(Boolean(view.queryByText('Ziyaret Edildi')), false);
});

test('a focus refresh after midnight cannot submit the stale day and keeps the draft for the refreshed day', async () => {
  const props = { userId: 'observer-A', projectId: 'project-A', currentDay: getVisitDayKey(new Date(Date.now() - 86_400_000)) };
  const view = render(React.createElement(VisitInteractionPanel, props));
  const field = view.getByLabelText('Ziyaret notu');
  await waitFor(() => assert.equal(field.disabled, false));
  fireEvent.change(field, { target: { value: 'Gece yarısı taslağı' } });
  fireEvent(window, new Event('focus'));
  let requests = 0; globalThis.fetch = async () => { requests++; return ok({ visitId: 'today-visit' }); };
  fireEvent.click(view.getByText('Ziyaret Ettim')); fireEvent.click(view.getByText('Sahada misin?'));
  await waitFor(() => assert.ok(view.getByText(/Gün değişti/)));
  assert.equal(requests, 0); assert.equal(field.value, 'Gece yarısı taslağı');
  view.rerender(React.createElement(VisitInteractionPanel, { ...props, currentDay: getVisitDayKey() }));
  assert.equal(field.value, 'Gece yarısı taslağı');
  fireEvent.click(view.getByText('Sahada misin?'));
  await waitFor(() => assert.ok(view.getByText('Ziyaret Edildi')));
  assert.equal(requests, 1); assert.equal(field.value, '');
});
