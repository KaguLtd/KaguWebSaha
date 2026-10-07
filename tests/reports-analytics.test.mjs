import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsReport } from '../lib/reports/analytics.ts';
import { buildTaskReport, measuredTaskMinutes, summarizeWorkforce } from '../lib/reports/calculations.ts';
import { isSafeReportLink, parseSavedReportSnapshot } from '../lib/reports/snapshot.ts';

const now = new Date('2026-10-06T09:00:00Z');
const filters = { startDate: '2026-10-01', endDate: '2026-10-02', includeInactiveRows: 'false' };
const project = (extra = {}) => ({ id: 'p1', name: 'Proje A', customer: { id: 'c1', name: 'Cari A' }, city: 'İstanbul', description: null, isActive: true, createdAt: new Date('2026-01-01T00:00:00Z'), ...extra });
const crew = (extra = {}) => ({ id: 'a1', userId: 'u1', teamId: 'team1', teamNameSnapshot: 'Ekip A', headcountSnapshot: 5, actualHeadcount: 5, workforceKindSnapshot: 'CONTRACTOR', user: { fullName: 'Temsilci A', role: 'PERSONNEL' }, ...extra });
const task = (extra = {}) => ({ id: 't1', title: 'Cephe montajı', managerNote: 'Kaynak notu', taskDate: new Date('2026-10-01T00:00:00Z'), projectId: 'p1', project: { name: 'Proje A', customer: { id: 'c1', name: 'Cari A' } }, status: 'COMPLETED', arrivedAt: new Date('2026-10-01T06:00:00Z'), leftAt: new Date('2026-10-01T08:00:00Z'), durationMinutes: 120, assignees: [crew()], _count: { files: 2 }, ...extra });
const activity = (extra = {}) => ({ id: 'event1', projectId: 'p1', dailyTaskId: 't1', projectVisitId: null, userId: 'u1', userName: 'Temsilci A', eventType: 'NOTE_ADDED', title: 'Personel not ekledi', description: 'Kaynak not', createdAt: new Date('2026-10-01T09:00:00Z'), ...extra });
const file = (extra = {}) => ({ id: 'f1', projectId: 'p1', dailyTaskId: 't1', projectVisitId: null, uploadedByUserId: 'u1', userName: 'Temsilci A', originalName: 'Fotoğraf.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, note: null, createdAt: new Date('2026-10-01T09:00:00Z'), scope: 'TASK', ...extra });
const visit = (extra = {}) => ({ id: 'visit1', source: 'VISIT', projectId: 'p1', projectName: 'Proje A', customerName: 'Cari A', userId: 'visitor1', userName: 'Kontrol', visitedAt: new Date('2026-10-01T09:00:00Z'), note: 'Kontrol notu', fileCount: 0, ...extra });
const data = (extra = {}) => ({ projects: [project()], tasks: [task()], activity: [], notes: [], files: [], siteEvents: [], visits: [], latestVisits: [], mediaJobs: [], warnings: [], ...extra });
const getSection = (report, id) => report.sections.find((section) => section.id === id);
const getCell = (section, row, header) => section.rows[row][section.headers.indexOf(header)];

test('historical unknown class never depends on the current user role', () => {
  const legacy = crew({ teamId: null, teamNameSnapshot: null, workforceKindSnapshot: null, headcountSnapshot: null, actualHeadcount: null });
  const before = summarizeWorkforce([task({ assignees: [legacy] })]);
  const after = summarizeWorkforce([task({ assignees: [{ ...legacy, user: { ...legacy.user, role: 'OBSERVER' } }] })]);
  assert.equal(before.unknownAssignments, 1);
  assert.deepEqual(before, after);
  assert.equal(summarizeWorkforce([task({ assignees: [crew({ workforceKindSnapshot: 'OBSERVER', headcountSnapshot: 0 })] })]).knownProjectParticipation, 0);
});

test('measured task minutes validate ordered timestamps using operational minute rounding', () => {
  assert.equal(measuredTaskMinutes(task()), 120);
  assert.equal(measuredTaskMinutes(task({ leftAt: new Date('2026-10-01T05:00:00Z') })), null);
  assert.equal(measuredTaskMinutes(task({ durationMinutes: 121 })), null);
  assert.equal(measuredTaskMinutes(task({ leftAt: new Date('2026-10-01T06:00:29Z'), durationMinutes: 0 })), 0);
  assert.equal(measuredTaskMinutes(task({ leftAt: new Date('2026-10-01T06:00:31Z'), durationMinutes: 1 })), 1);
  assert.equal(measuredTaskMinutes(task({ durationMinutes: Number.NaN })), null);
});

test('an incomplete team declaration invalidates only that team-day actual total; zero remains valid', () => {
  const complete = task();
  const missing = task({ id: 't2', assignees: [crew({ actualHeadcount: null })] });
  const summary = summarizeWorkforce([complete, missing]);
  assert.equal(summary.declaredProjectParticipation, 5);
  assert.equal(summary.declaredTeamHeadcountDays, 0);
  assert.equal(summary.knownPlannedTeamHeadcountDays, 5);
  assert.equal(summary.incompleteTeamDays, 1);
  assert.equal(summary.missingDeclarations, 1);
  const zero = summarizeWorkforce([task({ assignees: [crew({ actualHeadcount: 0 })] })]);
  assert.equal(zero.missingDeclarations, 0);
  assert.equal(zero.declaredTeamHeadcountDays, 0);
});

test('personnel groups preserve changing historical classes and team names', () => {
  const first = task({ assignees: [crew({ teamId: null, teamNameSnapshot: null, workforceKindSnapshot: 'PERSONNEL', headcountSnapshot: 1, actualHeadcount: null })] });
  const observer = task({ id: 't2', assignees: [crew({ teamId: null, teamNameSnapshot: null, workforceKindSnapshot: 'OBSERVER', headcountSnapshot: 0, actualHeadcount: null })] });
  const report = buildTaskReport('PERSONNEL', [first, observer, task(), task({ id: 't3', assignees: [crew({ teamNameSnapshot: 'Yeni ekip adı' })] })], filters, now);
  assert.equal(report.rows.length, 4);
  assert.deepEqual(new Set(report.rows.map((row) => row[1])), new Set(['Personel', 'Saha kontrol', 'Taşeron ekip']));
  assert.equal(report.totals['Ölçülmüş ortak görev süresi (dk)'], 480);
});

test('all eight report types return versioned metadata and meaningful structured sections without writes', () => {
  const input = data({ activity: [activity()], files: [file()], visits: [visit()], latestVisits: [visit()] });
  const before = JSON.stringify(input);
  for (const type of ['PROJECT', 'CUSTOMER', 'PERSONNEL', 'VISIT', 'OPERATIONS', 'QUALITY', 'MEDIA', 'COMPARISON']) {
    const report = buildAnalyticsReport(type, input, filters, now);
    assert.equal(report.schemaVersion, 3);
    assert.equal(report.metadata.reportType, type);
    assert.equal(report.metadata.timeZone, 'Europe/Istanbul');
    assert.equal(report.generatedAt, now.toISOString());
    assert.equal(report.metadata.readAt, now.toISOString());
    assert.ok(report.sections.length);
    assert.equal(JSON.stringify(input), before);
  }
});

test('duplicate source IDs are counted once and project note mirrors never increase canonical notes', () => {
  const note = { id: 'archive1', projectId: 'p1', userId: 'u1', userName: 'Temsilci A', note: 'Kaynak not', createdAt: new Date('2026-10-01T09:00:00Z') };
  const input = data({ tasks: [task(), task()], activity: [activity(), activity()], notes: [note], files: [file(), file()], siteEvents: [{ id: 'site1', projectId: 'p1', dailyTaskId: 't1', userId: 'u1', userName: 'Temsilci A', type: 'NOTE_ADDED', createdAt: new Date('2026-10-01T09:00:00Z'), hasLocation: false }] });
  const report = buildAnalyticsReport('OPERATIONS', input, filters, now);
  assert.equal(report.totals['Görev'], 1);
  assert.equal(report.totals['Dönemdeki kanonik not'], 1);
  assert.equal(report.totals['Dosya (program kapsamı)'], 1);
  assert.equal(getSection(report, 'notesArchive').rows.length, 1);
  assert.equal(report.trend[0].notes, 1);
});

test('planned status and arrival evidence remain separate facts; correction notes produce no work evidence', () => {
  const report = buildAnalyticsReport('OPERATIONS', data({ tasks: [task({ status: 'PLANNED', arrivedAt: null, leftAt: null, durationMinutes: null })], activity: [activity({ title: 'Fiili mevcud düzeltildi', description: '5 yerine 6' })] }), filters, now);
  assert.equal(report.totals['Planlanan'], 1);
  assert.equal(report.totals['Varış kaydı olan'], 0);
  assert.equal(report.totals['Ekip mevcudu/gün (fiili beyan)'], 0);
  assert.equal(report.totals['Ölçülmüş ortak görev süresi (dk)'], 0);
  assert.equal(report.trend[0].notes, 1);
  const inconsistent = buildAnalyticsReport('QUALITY', data({ tasks: [task({ status: 'PLANNED' })] }), filters, now);
  assert.equal(inconsistent.totals['Varış kaydı olan'], 1);
  assert.ok(getSection(inconsistent, 'quality').rows.some((row) => row.includes('Durum / varış uyuşmazlığı')));
});

test('late task files/notes remain traceable but never enter period counts and daily trend', () => {
  const report = buildAnalyticsReport('OPERATIONS', data({ activity: [activity(), activity({ id: 'lateNote', createdAt: new Date('2026-10-05T09:00:00Z') })], files: [file(), file({ id: 'lateFile', createdAt: new Date('2026-10-05T09:00:00Z') })] }), filters, now);
  assert.equal(report.totals['Kanonik not (program kapsamı)'], 2);
  assert.equal(report.totals['Dönemdeki kanonik not'], 1);
  assert.equal(report.totals['Dosya (program kapsamı)'], 2);
  assert.equal(report.totals['Dönemde yüklenen dosya'], 1);
  assert.equal(report.trend.reduce((sum, row) => sum + row.notes, 0), 1);
  assert.equal(report.trend.reduce((sum, row) => sum + row.files, 0), 1);
  assert.match(getCell(getSection(report, 'files'), 1, 'Tarih kapsamı'), /dönem dışı/);
});

test('daily trend uses Istanbul midnight for events and UTC date-only program dates for tasks', () => {
  const report = buildAnalyticsReport('OPERATIONS', data({ activity: [activity({ createdAt: new Date('2026-09-30T21:01:00Z') }), activity({ id: 'nextDay', createdAt: new Date('2026-10-01T21:01:00Z') })] }), filters, now);
  assert.deepEqual(report.trend.map((row) => [row.date, row.tasks, row.notes]), [['2026-10-01', 1, 1], ['2026-10-02', 0, 1]]);
});

test('task-free projects with period activity appear by default; inactive rows remain optional', () => {
  const onlyNote = project({ id: 'p2', name: 'Yalnız not' });
  const empty = project({ id: 'p3', name: 'Faaliyetsiz' });
  const future = project({ id: 'p4', name: 'Sonraki proje', createdAt: new Date('2026-10-04T00:00:00Z') });
  const input = data({ projects: [project(), onlyNote, empty, future], activity: [activity({ id: 'p2note', projectId: 'p2', dailyTaskId: null })] });
  const report = buildAnalyticsReport('PROJECT', input, filters, now);
  assert.deepEqual(report.rows.map((row) => row[0]), ['Proje A', 'Yalnız not']);
  const noteRow = report.rows.find((row) => row[0] === 'Yalnız not');
  assert.equal(noteRow[report.headers.indexOf('Dönem notu')], 1);
  const withEmpty = buildAnalyticsReport('PROJECT', input, { ...filters, includeInactiveRows: 'true' }, now);
  assert.deepEqual(withEmpty.rows.map((row) => row[0]), ['Proje A', 'Yalnız not', 'Faaliyetsiz']);
  const customerReport = buildAnalyticsReport('CUSTOMER', input, filters, now);
  assert.equal(customerReport.rows.length, 1);
  assert.equal(customerReport.rows[0][customerReport.headers.indexOf('Proje')], 2);
});

test('workforce matrix flags missing declarations and keeps personal attendance unknown', () => {
  const input = data({ tasks: [task(), task({ id: 't2', assignees: [crew({ actualHeadcount: null, teamNameSnapshot: 'Yeni ad' })] }), task({ id: 't3', assignees: [crew({ userId: 'person2', teamId: null, teamNameSnapshot: null, workforceKindSnapshot: 'PERSONNEL', headcountSnapshot: 1, actualHeadcount: null })] })] });
  const report = buildAnalyticsReport('PERSONNEL', input, filters, now);
  const matrix = getSection(report, 'workforceDaily');
  assert.match(getCell(matrix, 0, 'Günlük fiili mevcud'), /Bilinmiyor/);
  const personal = matrix.rows.find((row) => row[matrix.headers.indexOf('Tarihsel tür')] === 'Personel');
  assert.equal(personal[matrix.headers.indexOf('Günlük fiili mevcud')], 'Kişisel fiili mevcud ölçülmüyor');
  assert.equal(report.totals['Ölçülmüş ortak görev süresi (dk)'], 360);
});

test('actual team-day remains known when only the planned count changed', () => {
  const report = buildAnalyticsReport('PERSONNEL', data({ tasks: [task(), task({ id: 't2', assignees: [crew({ headcountSnapshot: 6 })] })] }), filters, now);
  const matrix = getSection(report, 'workforceDaily');
  assert.match(getCell(matrix, 0, 'Günlük plan mevcudu'), /Bilinmiyor/);
  assert.equal(getCell(matrix, 0, 'Günlük fiili mevcud'), 5);
});

test('visits carry source IDs, legacy unknown file counts and current scope exclusions', () => {
  const archived = project({ id: 'p2', name: 'Arşiv', isActive: false });
  const newProject = project({ id: 'p3', createdAt: new Date('2026-10-05T00:00:00Z') });
  const oldVisit = visit({ id: 'legacy1', source: 'LEGACY', visitedAt: new Date('2026-10-01T08:00:00Z'), fileCount: null });
  const report = buildAnalyticsReport('VISIT', data({ projects: [project(), archived, newProject], visits: [oldVisit], latestVisits: [visit({ id: 'latestEarlier', userId: 'anotherActor', visitedAt: new Date('2026-09-01T09:00:00Z') })] }), filters, now);
  assert.equal(report.totals['31+ gün'], 1);
  assert.equal(report.totals['Hiç ziyaret yok'], 0);
  assert.equal(getCell(getSection(report, 'visits'), 0, 'Dosya'), 'Bilinmiyor');
  assert.equal(getCell(getSection(report, 'visits'), 0, 'Kaynak ID'), 'legacy1');
  assert.ok(getSection(report, 'projectInfo').rows.some((row) => row.includes('Arşiv — gecikme hesabı dışında')));
});

test('comparison uses equal prior calendar period and never invents percentages on a zero baseline', () => {
  const previous = data({ tasks: [], activity: [], files: [] });
  const report = buildAnalyticsReport('COMPARISON', data({ previous }), filters, now);
  const comparison = getSection(report, 'comparison');
  assert.match(comparison.description, /2026-09-29 – 2026-09-30 \(2 takvim günü\)/);
  const row = comparison.rows.find((row) => row[0] === 'Görev');
  assert.deepEqual(row.slice(1, 4), [0, 1, 1]);
  assert.match(row[4], /taban 0/);
  const missing = buildAnalyticsReport('COMPARISON', data(), filters, now);
  assert.equal(getSection(missing, 'comparison').rows[0][1], 'Bilinmiyor');
});

test('quality report identifies unknown classes, inconsistent time and missing declarations without mutating source', () => {
  const input = data({ tasks: [task({ leftAt: new Date('2026-10-01T05:00:00Z'), assignees: [crew({ actualHeadcount: null }), crew({ id: 'legacy', userId: 'u2', workforceKindSnapshot: null, headcountSnapshot: null })] })] });
  const before = JSON.stringify(input);
  const report = buildAnalyticsReport('QUALITY', input, filters, now);
  const quality = getSection(report, 'quality');
  for (const title of ['Tutarsız süre', 'Tarihsel sınıf eksik', 'Fiili ekip beyanı eksik / geçersiz']) assert.ok(quality.rows.some((row) => row.includes(title)));
  assert.equal(report.totals['Ölçülmüş ortak görev süresi (dk)'], 0);
  assert.equal(JSON.stringify(input), before);
});

test('media inventory exposes authorized links and server statuses without paths or error payloads', () => {
  const report = buildAnalyticsReport('MEDIA', data({ files: [file()], mediaJobs: [{ id: 'job1', projectId: 'p1', kind: 'HEIC', status: 'FAILED', createdAt: now, updatedAt: now }] }), filters, now);
  assert.equal(getSection(report, 'files').rowLinks[0].href, '/api/files/f1');
  assert.equal(getCell(getSection(report, 'serverMedia'), 0, 'Okuma anındaki durum'), 'FAILED');
  assert.ok(report.definitions.some((definition) => definition.includes('offline')));
  assert.ok(!JSON.stringify(report).includes('storagePath'));
});

test('legacy snapshot tables preserve recorded numbers while unknown formats produce a warning', () => {
  const old = { headers: ['Kişi', 'Toplam'], rows: [['Ali', 12]], totals: { 'eski toplam': 19 } };
  const before = JSON.stringify(old);
  const parsed = parseSavedReportSnapshot(old);
  assert.deepEqual(parsed.rows, old.rows);
  assert.deepEqual(parsed.totals, old.totals);
  assert.equal(parsed.schemaVersion, undefined);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(JSON.stringify(old), before);
  assert.ok(parseSavedReportSnapshot({ rows: [{ person: 'Ali' }] }).warnings.length);
});

test('v3 snapshot roundtrips metadata, sections and trends and drops unsafe links safely', () => {
  const report = buildAnalyticsReport('OPERATIONS', data({ files: [file()] }), filters, now);
  report.metadata.reportId = 'saved1'; report.metadata.createdByName = 'Yönetici';
  const decoded = parseSavedReportSnapshot(JSON.parse(JSON.stringify(report)));
  assert.deepEqual(decoded.metadata, report.metadata);
  assert.deepEqual(decoded.sections, report.sections);
  assert.deepEqual(decoded.trend, report.trend);
  for (const href of ['/admin/projects/p1', '/admin/schedule/tasks/t1', '/admin/visits/p1', '/api/files/f1']) assert.equal(isSafeReportLink(href), true);
  for (const href of ['https://evil.example/x', '//evil.example/x', '/api/files/%2Fsecret', '/api/files/%2e%2e', '/api/files/f1?download=1', '/api/files/f1/anything', '/admin/projects/p1/../../secret', '/api/files/%ZZ']) assert.equal(isSafeReportLink(href), false);
  const bad = parseSavedReportSnapshot({ headers: ['ID'], rows: [['x']], metadata: { reportType: 3 }, sections: [{ id: 'files', title: 'Files', headers: ['ID'], rows: [['x']], rowLinks: [{ href: '/api/files/%2Fsecret', label: 'x' }] }], trend: [{ date: '2026-10-01', tasks: Number.NaN }] });
  assert.equal(bad.metadata, undefined);
  assert.equal(bad.sections[0].rowLinks[0], null);
  assert.deepEqual(bad.trend, []);
  assert.ok(bad.warnings.length);
});

test('report totals omit unread sources instead of claiming measured zero values', () => {
  const job = { id: 'job1', projectId: 'p1', kind: 'HEIC', status: 'PENDING', createdAt: now, updatedAt: now };
  const visitReport = buildAnalyticsReport('VISIT', data({ tasks: [], visits: [visit()], latestVisits: [visit()], files: [file({ dailyTaskId: null, projectVisitId: 'visit1' })], activity: [activity({ dailyTaskId: null, projectVisitId: 'visit1' })] }), filters, now);
  assert.equal(visitReport.totals['Ziyaret'], 1);
  assert.equal(visitReport.totals['Ziyaret eki'], 1);
  assert.equal(visitReport.totals['Bağlı ziyaret notu'], 1);
  for (const unread of ['Görev', 'Planlanan', 'Ölçülmüş ortak görev süresi (dk)', 'Sunucu medya işi']) assert.equal(Object.hasOwn(visitReport.totals, unread), false);
  const mediaReport = buildAnalyticsReport('MEDIA', data({ files: [file()], mediaJobs: [job] }), filters, now);
  assert.equal(mediaReport.totals['Sunucu medya işi'], 1);
  assert.equal(mediaReport.totals['Dosya (program kapsamı)'], 1);
  for (const irrelevant of ['Görev', 'Ziyaret', 'Plan katılımı (bilinen)']) assert.equal(Object.hasOwn(mediaReport.totals, irrelevant), false);
  for (const type of ['PROJECT', 'PERSONNEL', 'CUSTOMER', 'COMPARISON']) {
    const report = buildAnalyticsReport(type, data({ mediaJobs: [job] }), filters, now);
    assert.equal(report.totals['Görev'], 1);
    assert.equal(Object.hasOwn(report.totals, 'Sunucu medya işi'), false);
  }
  for (const type of ['QUALITY', 'OPERATIONS', 'MEDIA']) {
    const report = buildAnalyticsReport(type, data({ mediaJobs: [] }), filters, now);
    assert.equal(report.totals['Sunucu medya işi'], 0);
  }
});

test('malformed v3 section tables warn even when the section identity remains readable', () => {
  for (const invalid of [
    { headers: 'ID', rows: [['source1']] },
    { headers: ['ID'], rows: [{ id: 'source1' }] },
    { headers: ['ID', 'Not'], rows: [['source1']] },
    { headers: ['ID'], rows: [[null]] },
  ]) {
    const snapshot = { schemaVersion: 3, headers: ['Metrik'], rows: [['Kayıt']], sections: [{ id: 'tasks', title: 'Görevler', ...invalid }] };
    const before = JSON.stringify(snapshot);
    const parsed = parseSavedReportSnapshot(snapshot);
    assert.equal(parsed.sections.length, 1);
    assert.equal(parsed.sections[0].id, 'tasks');
    assert.ok(parsed.warnings.some((warning) => warning.includes('bölüm tabloları')));
    assert.equal(JSON.stringify(snapshot), before);
  }
  const valid = parseSavedReportSnapshot({ schemaVersion: 3, headers: ['Metrik'], rows: [['Kayıt']], sections: [{ id: 'tasks', title: 'Görevler', headers: ['ID'], rows: [['source1']] }] });
  assert.equal(valid.warnings.length, 0);
});

test('discarded malformed rows never shift source links onto a different retained row', () => {
  const wrong = { href: '/admin/projects/wrong-project', label: 'Bozuk satırın kaynağı' };
  const correct = { href: '/admin/schedule/tasks/correct-task', label: 'Doğru görev' };
  const malformed = { headers: ['Kaynak ID'], rows: [null, ['correct-task']], rowLinks: [wrong, correct] };
  const snapshot = { schemaVersion: 3, ...malformed, details: malformed, sections: [{ id: 'tasks', title: 'Görevler', ...malformed }] };
  const before = JSON.stringify(snapshot);
  const parsed = parseSavedReportSnapshot(snapshot);
  for (const table of [parsed, parsed.details, parsed.sections[0]]) {
    assert.deepEqual(table.rows, [['correct-task']]);
    assert.deepEqual(table.rowLinks, [correct]);
  }
  assert.equal(JSON.stringify(snapshot), before);
  const valid = { headers: ['Kaynak ID', 'Sayı'], rows: [['source1', 0], ['source2', 12]], rowLinks: [correct, null] };
  const decoded = parseSavedReportSnapshot(valid);
  assert.deepEqual(decoded.headers, valid.headers);
  assert.deepEqual(decoded.rows, valid.rows);
  assert.deepEqual(decoded.rowLinks, valid.rowLinks);
});

test('task filters exclude unread period visits while retaining independently read project visit lag', () => {
  const input = data({ visitsAvailable: false, visits: [], latestVisits: [visit({ visitedAt: new Date('2026-09-01T09:00:00Z') })] });
  const taskFilters = { ...filters, teamId: 'team1' };
  for (const type of ['PROJECT', 'CUSTOMER', 'PERSONNEL', 'OPERATIONS', 'QUALITY', 'COMPARISON']) {
    const report = buildAnalyticsReport(type, { ...input, previous: data({ visitsAvailable: false }) }, taskFilters, now);
    assert.equal(Object.hasOwn(report.totals, 'Ziyaret'), false);
    assert.equal(Object.hasOwn(report.totals, 'Ziyaret edilen şantiye'), false);
    assert.equal(report.totals['31+ gün'], 1);
    assert.equal(report.totals['Hiç ziyaret yok'], 0);
    assert.deepEqual(report.excludedMetrics, ['visits']);
    const daily = getSection(report, 'daily');
    if (daily) {
      assert.equal(daily.headers.includes('Ziyaret'), false);
      assert.ok(daily.rows.every((row) => row.length === daily.headers.length));
    }
    if (type === 'PROJECT' || type === 'CUSTOMER') assert.equal(report.rows[0][report.headers.indexOf('Dönem ziyareti')], 'Uygulanmaz');
    if (type === 'COMPARISON') assert.equal(getSection(report, 'comparison').rows.some((row) => row[0] === 'Ziyaret'), false);
    assert.deepEqual(parseSavedReportSnapshot(JSON.parse(JSON.stringify(report))).excludedMetrics, ['visits']);
  }
  // An available source with no records is a measured zero, including legacy fixtures without the flag.
  const available = buildAnalyticsReport('PROJECT', data(), filters, now);
  assert.equal(available.totals['Ziyaret'], 0);
  assert.equal(available.excludedMetrics, undefined);
  assert.ok(getSection(available, 'daily').headers.includes('Ziyaret'));
  const malformed = parseSavedReportSnapshot({ headers: [], rows: [], excludedMetrics: ['visits', null, 3] });
  assert.deepEqual(malformed.excludedMetrics, ['visits']);
});

test('visit reports exclude unread task trend series while preserving measured visit, note and file series', () => {
  const input = data({ tasks: [], visits: [visit()], latestVisits: [visit()], activity: [activity({ dailyTaskId: null, projectVisitId: 'visit1' })], files: [file({ dailyTaskId: null, projectVisitId: 'visit1' })] });
  const report = buildAnalyticsReport('VISIT', input, filters, now);
  assert.deepEqual(report.excludedMetrics, ['tasks', 'arrived', 'closed', 'minutes']);
  assert.equal(report.trend[0].visits, 1);
  assert.equal(report.trend[0].notes, 1);
  assert.equal(report.trend[0].files, 1);
  assert.equal(Object.hasOwn(report.totals, 'Görev'), false);
  assert.deepEqual(parseSavedReportSnapshot(JSON.parse(JSON.stringify(report))).excludedMetrics, report.excludedMetrics);
  const bothUnavailable = buildAnalyticsReport('VISIT', { ...input, visits: [], visitsAvailable: false }, filters, now);
  assert.deepEqual(bothUnavailable.excludedMetrics, ['tasks', 'arrived', 'closed', 'minutes', 'visits']);
  for (const type of ['PROJECT', 'PERSONNEL', 'CUSTOMER', 'OPERATIONS', 'QUALITY', 'MEDIA', 'COMPARISON']) {
    const measured = buildAnalyticsReport(type, data({ tasks: [] }), filters, now);
    assert.equal(measured.excludedMetrics, undefined);
  }
});
