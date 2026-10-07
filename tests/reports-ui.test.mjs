import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLFormElement', 'HTMLDetailsElement', 'FormData', 'Event', 'MouseEvent', 'SubmitEvent']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const state = { refreshes: 0, requests: [], responses: [] };
globalThis.__reportsUi = state;
registerHooks({
  resolve(specifier, context, next) {
    const key = ({ 'next/navigation': 'navigation', 'next/link': 'link' })[specifier];
    return key ? { url: `reports-ui:${key}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'reports-ui:navigation') return { format: 'module', source: 'export const useRouter=()=>({refresh:()=>globalThis.__reportsUi.refreshes++});', shortCircuit: true };
    if (url === 'reports-ui:link') return { format: 'module', source: 'export default function Link(props){return globalThis.__reportsUi.React.createElement("a",props);}', shortCircuit: true };
    return next(url, context);
  },
});
const React = await import('react');
state.React = React;
const { render, fireEvent, waitFor, cleanup, within } = await import('@testing-library/react');
const { ReportsDashboard } = await import('../components/admin/reports-dashboard.tsx');
const { ReportSnapshotContent, ReportTable } = await import('../components/admin/report-snapshot.tsx');
const { PrintReportButton } = await import('../components/admin/print-report-button.tsx');
const baseProps = {
  projects: [{ id: 'project-A', name: 'Şantiye A', customerName: 'Cari A', isActive: true }],
  customers: [{ id: 'customer-A', name: 'Cari A' }], personnel: [{ id: 'admin-A', name: 'Yönetici A' }], teams: [{ id: 'team-A', name: 'Ekip A' }],
  reports: [], today: '2026-10-06', weekStart: '2026-09-30', query: '', selectedType: '', page: 1, pages: 1, total: 0,
};
const snapshot = (value = 1) => ({ schemaVersion: 3, calculationVersion: 'reports-3', headers: ['Kayıt'], rows: [[value]], totals: { Görev: value }, definitions: ['Görev süresi ortak ölçüdür.'] });
const previewResponse = (fingerprint, value = 1, status = 200) => Response.json({ ok: status === 200, title: 'Örnek rapor', snapshot: snapshot(value), fingerprint, ...(status === 409 ? { error: 'Veriler değişti. Güncel önizlemeyi inceleyin.' } : {}) }, { status });
const dashboard = (extra = {}) => render(React.createElement(ReportsDashboard, { ...baseProps, ...extra }));
test.beforeEach(() => {
  state.refreshes = 0; state.requests = []; state.responses = [];
  globalThis.fetch = async (_url, options) => { state.requests.push(Object.fromEntries(options.body.entries())); return state.responses.shift(); };
});
test.afterEach(() => cleanup());
test.after(() => dom.window.close());

test('table formatting preserves ISO-looking notes and IDs instead of treating them as dates', () => {
  const view = render(React.createElement(ReportTable, { table: { headers: ['Kaynak ID', 'Not', 'Kayıt zamanı'], rows: [['2026-10-06', '2026-10-06T08:00:00Z', '2026-10-06T08:00:00Z']] } }));
  const cells = view.getByRole('table').querySelectorAll('tbody td');
  assert.equal(cells[0].textContent, '2026-10-06'); assert.equal(cells[1].textContent, '2026-10-06T08:00:00Z'); assert.ok(cells[2].textContent.includes('11:00'));
});

test('an unread visit measure cannot be selected in the chart or appear as a daily zero', () => {
  const data = { ...snapshot(), excludedMetrics: ['visits'], trend: [{ date: '2026-10-06', tasks: 1, arrived: 1, closed: 0, minutes: 120, notes: 3, files: 2, visits: 0 }] };
  const view = render(React.createElement(ReportSnapshotContent, { snapshot: data }));
  assert.equal(within(view.getByLabelText('Grafik ölçüsü')).queryByRole('option', { name: 'Ziyaret' }), null);
  const headers = [...view.container.querySelector('table[aria-label="Günlük değerler"]').querySelectorAll('th')].map((item) => item.textContent);
  assert.equal(headers.some((header) => header.includes('Ziyaret')), false);
});

test('all eight report types are available and date shortcuts, zero activity and equal comparison scope work', async () => {
  const view = dashboard();
  const catalog = within(view.getByRole('region', { name: 'Rapor türleri' }));
  assert.equal(catalog.getAllByRole('button').length, 8);
  fireEvent.click(catalog.getByRole('button', { name: /Proje faaliyetleri/ }));
  const dialog = within(view.getByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: 'Dün' }));
  assert.equal(dialog.getByLabelText('Başlangıç').value, '2026-10-05');
  assert.equal(dialog.getByLabelText('Bitiş').value, '2026-10-05');
  fireEvent.click(dialog.getByRole('button', { name: 'Bu ay' }));
  assert.equal(dialog.getByLabelText('Başlangıç').value, '2026-10-01');
  fireEvent.click(dialog.getByLabelText(/Dönemde faaliyet kaydı olmayan/));
  state.responses.push(previewResponse('preview-one'));
  fireEvent.click(dialog.getByRole('button', { name: 'Önizle' }));
  await waitFor(() => assert.equal(dialog.getByRole('button', { name: 'Raporu kaydet' }).disabled, false));
  assert.equal(state.requests[0].includeInactiveRows, 'true');
  fireEvent.change(dialog.getByLabelText('Cari'), { target: { value: 'customer-A' } });
  assert.equal(dialog.getByRole('button', { name: 'Raporu kaydet' }).disabled, true);
  fireEvent.click(dialog.getByRole('button', { name: 'Kapat' }));
  fireEvent.click(catalog.getByRole('button', { name: /Dönem karşılaştırması/ }));
  assert.ok(within(view.getByRole('dialog')).getByText(/23.09.2026 – 29.09.2026/));
});

test('a changed-data save keeps the drawer, replaces preview and sends the new fingerprint on the next save', async () => {
  const view = dashboard(); fireEvent.click(view.getByRole('button', { name: /Operasyon özeti/ }));
  const dialog = within(view.getByRole('dialog'));
  state.responses.push(previewResponse('old-data', 1), previewResponse('new-data', 2, 409), Response.json({ ok: true, id: 'saved-A' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Önizle' }));
  await waitFor(() => assert.equal(dialog.getByRole('button', { name: 'Raporu kaydet' }).disabled, false));
  fireEvent.click(dialog.getByRole('button', { name: 'Raporu kaydet' }));
  await waitFor(() => assert.ok(dialog.getByRole('alert').textContent.includes('Veriler değişti')));
  assert.ok(view.getByRole('dialog')); assert.equal(state.requests[1].previewFingerprint, 'old-data');
  assert.ok(dialog.getByRole('table', { name: 'Özet tablosu' }).textContent.includes('2'));
  assert.equal(state.refreshes, 0);
  fireEvent.click(dialog.getByRole('button', { name: 'Raporu kaydet' }));
  await waitFor(() => assert.equal(Boolean(view.queryByRole('dialog')), false));
  assert.equal(state.requests[2].previewFingerprint, 'new-data'); assert.equal(state.refreshes, 1);
});

test('invalid save acknowledgements retain the reviewed preview and selecting-project search does not change scope', async () => {
  const view = dashboard(); fireEvent.click(view.getByRole('button', { name: /Proje faaliyetleri/ }));
  const dialog = within(view.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('Proje'), { target: { value: 'project-A' } });
  state.responses.push(previewResponse('stable'), Response.json({ ok: true }));
  fireEvent.click(dialog.getByRole('button', { name: 'Önizle' }));
  await waitFor(() => assert.equal(dialog.getByRole('button', { name: 'Raporu kaydet' }).disabled, false));
  fireEvent.change(dialog.getByLabelText('Proje arama'), { target: { value: 'eşleşmeyen arama' } });
  assert.equal(dialog.getByLabelText('Proje').value, 'project-A');
  assert.equal(dialog.getByRole('button', { name: 'Raporu kaydet' }).disabled, false);
  fireEvent.click(dialog.getByRole('button', { name: 'Raporu kaydet' }));
  await waitFor(() => assert.ok(dialog.getByRole('alert').textContent.includes('Rapor kaydı doğrulanamadı')));
  assert.ok(view.getByRole('dialog')); assert.equal(state.refreshes, 0); assert.equal(state.requests[1].projectId, 'project-A');
});

test('archive rows show metadata and export links without embedding snapshots, and paging preserves the search scope', () => {
  const view = dashboard({ reports: [{ id: 'saved-A', title: 'Aylık rapor', reportType: 'QUALITY', createdBy: 'Yönetici A', createdAt: '2026-10-06T09:00:00Z', startDate: '2026-09-01', endDate: '2026-09-30', snapshot: { headers: ['Gizli büyük veri'], rows: [['Arşivde gömülmemeli']] } }], query: 'Aylık', selectedType: 'QUALITY', archiveStart: '2026-09-10', archiveEnd: '2026-09-20', archiveCreator: 'admin-A', total: 26, pages: 2 });
  assert.equal(view.queryByText('Arşivde gömülmemeli'), null);
  assert.equal(view.getByRole('link', { name: 'XLSX' }).getAttribute('href'), '/api/admin/reports/saved-A/export?format=xlsx');
  const next = new URL(view.getByRole('link', { name: 'Sonraki' }).href);
  assert.equal(next.searchParams.get('q'), 'Aylık'); assert.equal(next.searchParams.get('type'), 'QUALITY'); assert.equal(next.searchParams.get('creator'), 'admin-A');
  assert.equal(next.searchParams.get('start'), '2026-09-10'); assert.equal(next.searchParams.get('end'), '2026-09-20'); assert.equal(next.searchParams.get('page'), '2');
  assert.equal(view.getByLabelText('Raporu üreten kişi').value, 'admin-A');
});

test('search, numeric sort and pagination preserve source links and never shrink the full print data', () => {
  const rows = Array.from({ length: 30 }, (_, index) => [`Şantiye ${index + 1}`, 30 - index]);
  const rowLinks = rows.map((_, index) => ({ href: `/admin/projects/project-${index}`, label: 'Projeyi aç' }));
  const view = render(React.createElement('article', { className: 'kagu-print-report' }, React.createElement(PrintReportButton), React.createElement(ReportSnapshotContent, { snapshot: { headers: ['Proje', 'Sayı'], rows, rowLinks } })));
  const screenTable = view.getByRole('table', { name: 'Özet tablosu' });
  assert.equal(screenTable.querySelectorAll('tbody tr').length, 25);
  fireEvent.click(view.getByRole('button', { name: 'Sonraki sayfa' }));
  assert.equal(screenTable.querySelectorAll('tbody tr').length, 5);
  fireEvent.click(view.getByRole('button', { name: 'Sayı: sırala' }));
  assert.equal(screenTable.querySelector('tbody tr a').getAttribute('href'), '/admin/projects/project-29');
  assert.ok(screenTable.querySelector('tbody tr').textContent.includes('Şantiye 30'));
  fireEvent.change(view.getByLabelText('Özet tablosu: tabloda ara'), { target: { value: 'şantiye 30' } });
  assert.equal(screenTable.querySelectorAll('tbody tr').length, 1);
  assert.equal(screenTable.querySelector('tbody tr a').getAttribute('href'), '/admin/projects/project-29');
  assert.equal(view.container.querySelectorAll('.report-print-only tbody tr').length, 0);
  let printed = false;
  window.print = () => { printed = true; assert.equal(view.container.querySelectorAll('.report-print-only tbody tr').length, 30); };
  fireEvent.click(view.getByRole('button', { name: 'Yazdır / PDF olarak kaydet' }));
  assert.equal(printed, true);
  fireEvent(window, new Event('afterprint'));
  assert.equal(view.container.querySelectorAll('.report-print-only tbody tr').length, 0);
});

test('section tabs, chart values and printing use the same saved data including all hidden sections', () => {
  const data = { ...snapshot(), sections: [{ id: 'tasks', title: 'Görevler', headers: ['Not'], rows: [['Uzun iş açıklaması']] }, { id: 'files', title: 'Dosyalar', headers: ['Dosya'], rows: [['kanıt.pdf']], rowLinks: [{ href: '/api/files/file-A', label: 'Dosyayı aç' }] }], trend: [{ date: '2026-10-06', tasks: 1, arrived: 1, closed: 0, minutes: 120, notes: 3, files: 2, visits: 0 }] };
  const view = render(React.createElement('article', { className: 'kagu-print-report' }, React.createElement(PrintReportButton), React.createElement(ReportSnapshotContent, { snapshot: data })));
  fireEvent.keyDown(view.getByRole('tab', { name: /Görevler/ }), { key: 'ArrowRight' });
  assert.equal(document.activeElement, view.getByRole('tab', { name: /Dosyalar/ }));
  assert.equal(view.getByRole('tabpanel').querySelector('a').getAttribute('href'), '/api/files/file-A');
  fireEvent.change(view.getByLabelText('Grafik ölçüsü'), { target: { value: 'notes' } });
  assert.ok(view.getByRole('img').getAttribute('aria-label').startsWith('Not faaliyeti'));
  assert.equal(view.getByRole('img').querySelector('circle title').textContent, '06.10.2026: 3');
  let printed = false;
  const originalOpen = Array.from(view.container.querySelectorAll('details')).map((item) => item.open);
  window.print = () => { printed = true; assert.ok(Array.from(view.container.querySelectorAll('details')).every((item) => item.open)); assert.equal(view.container.querySelectorAll('[data-report-section] .report-print-only tbody tr').length, 2); };
  fireEvent.click(view.getByRole('button', { name: 'Yazdır / PDF olarak kaydet' }));
  assert.equal(printed, true);
  fireEvent(window, new Event('afterprint'));
  assert.deepEqual(Array.from(view.container.querySelectorAll('details')).map((item) => item.open), originalOpen);
});

test('native Ctrl+P lifecycle prepares hidden sections, opens details and restores the screen after printing', () => {
  const data = { ...snapshot(), sections: [{ id: 'first', title: 'İlk bölüm', headers: ['Kayıt'], rows: [['ilk']] }, { id: 'second', title: 'İkinci bölüm', headers: ['Kayıt'], rows: [['ikinci']] }], details: { headers: ['Not'], rows: [['uzun açıklama']] } };
  const view = render(React.createElement('article', { className: 'kagu-print-report' }, React.createElement(ReportSnapshotContent, { snapshot: data })));
  const originalOpen = Array.from(view.container.querySelectorAll('details')).map((item) => item.open);
  assert.equal(view.container.querySelectorAll('.report-print-only').length, 0);
  fireEvent(window, new Event('beforeprint'));
  assert.equal(view.container.querySelectorAll('[data-report-section] .report-print-only tbody tr').length, 2);
  assert.equal(view.container.querySelectorAll('[data-report-section][hidden]').length, 0);
  assert.ok(Array.from(view.container.querySelectorAll('details')).every((item) => item.open));
  fireEvent(window, new Event('beforeprint'));
  fireEvent(window, new Event('afterprint'));
  assert.deepEqual(Array.from(view.container.querySelectorAll('details')).map((item) => item.open), originalOpen);
  assert.equal(view.container.querySelectorAll('.report-print-only').length, 0);
  assert.equal(view.container.querySelectorAll('[data-report-section][hidden]').length, 1);
});
