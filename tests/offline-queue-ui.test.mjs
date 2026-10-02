import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'CustomEvent', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const state = { items: [], progress: null, stopped: 0, retried: [], legacy: 0, deleted: [], confirmed: true };
globalThis.__queueUi = state;
const sources = {
  navigation: 'export const useRouter=()=>globalThis.__queueUi.router;',
  link: 'export default function Link(props){return globalThis.__queueUi.React.createElement("a",props);}',
  queue: `const s=globalThis.__queueUi;
    export const listOfflineItems=async()=>s.items;
    export const countLegacyOfflineItems=async()=>s.legacy;
    export const getOfflineSyncProgress=()=>s.progress;
    export const stopOfflineSync=async()=>{s.stopped++;s.items=s.items.map(row=>({...row,sendingUntil:undefined}));s.progress=null;window.dispatchEvent(new Event('kagu-sync-progress'));};
    export const retryOfflineItem=async(id)=>{s.retried.push(id);};
    export const syncOfflineItems=async()=>{s.progress={current:1,total:2,itemId:'stuck',progress:48,overallProgress:24};window.dispatchEvent(new Event('kagu-sync-progress'));if(s.hold)await s.hold;return {synced:0,remaining:s.items.length,failedIds:[]};};
    export const deleteOfflineItem=async(id)=>{s.deleted.push(id);s.items=s.items.filter(row=>row.id!==id);};
    export const clearLegacyOfflineItems=async()=>{s.legacy=0;};
    export const readLegacyOfflineItemsForRecovery=async()=>[];
    export const replaceOfflineItemFiles=async()=>{};
    export const dismissOfflineNotifications=(userId,kind)=>window.dispatchEvent(new CustomEvent('kagu-dismiss-queue-notifications',{detail:{userId,kind}}));
    export const showOfflineNotifications=(userId,kind)=>window.dispatchEvent(new CustomEvent('kagu-show-queue-notifications',{detail:{userId,kind}}));`,
};
registerHooks({
  resolve(specifier, context, next) {
    const key = ({ 'next/navigation': 'navigation', 'next/link': 'link', '@/lib/offline/queue': 'queue' })[specifier];
    return key ? { url: `queue-ui:${key}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) { return url.startsWith('queue-ui:') ? { format: 'module', source: sources[url.slice(9)], shortCircuit: true } : next(url, context); },
});
const React = await import('react');
state.React = React;
const { render, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react');
const { OfflineQueueManager } = await import('../components/personnel/offline-queue-manager.tsx');
const { OfflineSyncBoot } = await import('../components/personnel/offline-sync-boot.tsx');
state.router = { refresh() {} };
const props = { userId: 'person-A', kind: 'PERSONNEL' };
test.beforeEach(() => {
  Object.assign(state, { items: [{ id: 'stuck', type: 'PERSONNEL_FILE', files: [], status: 'FAILED', sendingUntil: Date.now() + 180_000 }], progress: null, stopped: 0, retried: [], legacy: 26, deleted: [], confirmed: true, hold: null });
  window.confirm = () => state.confirmed;
});
test.afterEach(() => { cleanup(); sessionStorage.clear(); });
test.after(() => dom.window.close());

test('a sending record has usable retry and cleanup controls; retry stops the old transfer and displays progress', async () => {
  let finish; state.hold = new Promise(resolve => { finish = resolve; });
  const view = render(React.createElement(OfflineQueueManager, props));
  const retry = view.getByText('Yüklenemeyenleri tekrar yüklemeyi dene');
  await waitFor(() => assert.equal(retry.disabled, false));
  assert.equal(view.getByText('Tekrar dene').disabled, false);
  fireEvent.click(retry);
  await waitFor(() => assert.deepEqual(state.retried, ['stuck']));
  assert.equal(state.stopped, 1);
  await waitFor(() => assert.ok(view.getByText('%24')));
  assert.ok(view.getByText('Gönderimi durdur'));
  assert.equal(view.getByText('Eski yüklenemeyen kayıtları temizle').disabled, false);
  await act(async () => finish());
});

test('cleanup requires confirmation and removes failed and legacy records after stopping the transfer', async () => {
  const view = render(React.createElement(OfflineQueueManager, props));
  const button = view.getByText('Eski yüklenemeyen kayıtları temizle');
  await waitFor(() => assert.equal(button.disabled, false));
  state.confirmed = false; fireEvent.click(button);
  assert.equal(state.stopped, 0); assert.equal(state.legacy, 26);
  state.confirmed = true; fireEvent.click(button);
  await waitFor(() => assert.equal(state.legacy, 0));
  assert.deepEqual(state.deleted, ['stuck']); assert.equal(state.stopped, 1);
  await waitFor(() => assert.ok(view.getByText(/Dosyaları yükleme ekranından yeniden seçebilirsiniz/)));
});

test('dismissed notifications stay hidden across periodic refresh and remount, and a new record shows them', async () => {
  state.items[0].sendingUntil = undefined;
  let view = render(React.createElement(OfflineSyncBoot, props));
  await waitFor(() => assert.ok(view.getByText('Bekleyen kayıtları aç')));
  fireEvent.click(view.getByRole('button', { name: 'Bildirimleri kaldır' }));
  await waitFor(() => assert.ok(sessionStorage.getItem('kagu-queue-dismissed:person-A:PERSONNEL')));
  fireEvent(window, new Event('kagu-queue-changed'));
  await act(async () => {});
  assert.equal(view.queryByText('Bekleyen kayıtları aç'), null);
  view.unmount(); view = render(React.createElement(OfflineSyncBoot, props));
  await act(async () => {});
  assert.equal(view.queryByText('Bekleyen kayıtları aç'), null);
  state.items.push({ ...state.items[0], id: 'new' });
  fireEvent(window, new Event('kagu-queue-changed'));
  await waitFor(() => assert.ok(view.getByText('Bekleyen kayıtları aç')));
});
