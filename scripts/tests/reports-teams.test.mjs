import test from 'node:test';
import assert from 'node:assert/strict';
import { teamHeadcount, parseActualHeadcount } from '../../lib/teams/headcount.ts';
import { summarizeWorkforce, buildTaskReport, measuredTaskMinutes } from '../../lib/reports/calculations.ts';
import { snapshotToCsv } from '../../lib/reports/export.ts';
import { resolveAssignmentSnapshots } from '../../lib/teams/selection.ts';
import { parseSavedReportSnapshot } from '../../lib/reports/snapshot.ts';

const crew = (extra = {}) => ({ userId: 'representative', teamId: 'team-1', teamNameSnapshot: 'Taşeron A', headcountSnapshot: 5, actualHeadcount: 5, workforceKindSnapshot: 'CONTRACTOR', user: { fullName: 'Temsilci', role: 'PERSONNEL' }, ...extra });
const task = (extra = {}) => ({ id: 'task-1', taskDate: new Date('2026-09-30T00:00:00.000Z'), status: 'COMPLETED', arrivedAt: new Date('2026-09-30T06:00:00.000Z'), leftAt: new Date('2026-09-30T08:00:00.000Z'), durationMinutes: 120, assignees: [crew()], projectId: 'project-1', project: { name: 'Şantiye', customer: { id: 'customer-1', name: 'Cari' } }, _count: { files: 2 }, ...extra });

test('ekip toplamı temsilci dahil 1+4=5, dahil değilken 4', () => {
  assert.equal(teamHeadcount(4, true), 5);
  assert.equal(teamHeadcount(4, false), 4);
  assert.throws(() => teamHeadcount(0, false));
  assert.throws(() => teamHeadcount(-1, true));
  assert.throws(() => teamHeadcount(2.5, true));
});

test('fiili mevcud boşken bilinmiyor, negatif/kesir geçersiz', () => {
  assert.equal(parseActualHeadcount(''), null);
  assert.equal(parseActualHeadcount('7'), 7);
  assert.equal(parseActualHeadcount('0'), 0);
  assert.throws(() => parseActualHeadcount('-1'));
  assert.throws(() => parseActualHeadcount('2.5'));
});

test('aynı ekip iki projede katılım 10, ekip/gün mevcudu 5', () => {
  const result = summarizeWorkforce([task(), task({ id: 'task-2', projectId: 'project-2' })]);
  assert.equal(result.knownProjectParticipation, 10);
  assert.equal(result.declaredProjectParticipation, 10);
  assert.equal(result.teamDays, 1);
  assert.equal(result.knownPlannedTeamHeadcountDays, 5);
  assert.equal(result.declaredTeamHeadcountDays, 5);
});

test('farklı günlerde aynı ekip ayrı ekip/gün sayılır', () => {
  const result = summarizeWorkforce([task(), task({ taskDate: new Date('2026-10-01T00:00:00.000Z') })]);
  assert.equal(result.teamDays, 2);
  assert.equal(result.declaredTeamHeadcountDays, 10);
});

test('gün içi farklı mevcud kesin sayı gibi seçilmez', () => {
  const result = summarizeWorkforce([task(), task({ id: 'task-2', assignees: [crew({ actualHeadcount: 7 })] })]);
  assert.equal(result.changingTeamDays, 1);
  assert.equal(result.declaredTeamHeadcountDays, 0);
  assert.equal(result.declaredProjectParticipation, 12);
});

test('legacy atamaya bugünkü ekip sayısı uygulanmaz', () => {
  const legacy = crew({ teamId: null, teamNameSnapshot: null, headcountSnapshot: null, actualHeadcount: null, workforceKindSnapshot: null });
  const result = summarizeWorkforce([task({ assignees: [legacy] })]);
  assert.equal(result.knownProjectParticipation, 0);
  assert.equal(result.unknownAssignments, 1);
});

test('observer işgücü değildir; kayıtlı personel snapshot sonradan role dönüşse de korunur', () => {
  const observer = crew({ workforceKindSnapshot: 'OBSERVER', headcountSnapshot: 0, actualHeadcount: null, teamId: null });
  assert.equal(summarizeWorkforce([task({ assignees: [observer] })]).knownProjectParticipation, 0);
  const recorded = crew({ workforceKindSnapshot: 'PERSONNEL', headcountSnapshot: 1, actualHeadcount: null, teamId: null, user: { fullName: 'Kişi', role: 'OBSERVER' } });
  assert.equal(summarizeWorkforce([task({ assignees: [recorded] })]).individualDays, 1);
});

test('plan fiili beyan sayılmaz ve otomatik kapanış süresiz kalır', () => {
  const planned = task({ status: 'PLANNED', arrivedAt: null, leftAt: null, durationMinutes: null });
  assert.equal(summarizeWorkforce([planned]).declaredProjectParticipation, 0);
  const stale = task({ leftAt: null, durationMinutes: null });
  assert.equal(measuredTaskMinutes(stale), null);
  const report = buildTaskReport('PROJECT', [planned, stale], {}, new Date('2026-09-30T12:00:00.000Z'));
  assert.equal(report.totals['Planlanan'], 1);
  assert.equal(report.totals['Varış kaydı olan'], 1);
  assert.equal(report.totals['Ölçülmüş ortak görev süresi (dk)'], 0);
  assert.equal(report.totals['Süresi eksik başlayan görev'], 1);
});

test('rapor hesabı geçmiş atama nesnesini değiştirmez ve görev süresini toplamda ikiye katlamaz', () => {
  const input = task({ assignees: [crew(), crew({ userId: 'person-2', teamId: null, teamNameSnapshot: null, headcountSnapshot: 1, actualHeadcount: null, workforceKindSnapshot: 'PERSONNEL' })] });
  const before = JSON.stringify(input);
  const report = buildTaskReport('PERSONNEL', [input], {});
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.totals['Ölçülmüş ortak görev süresi (dk)'], 120);
  assert.equal(JSON.stringify(input), before);
});

test('CSV Excel için BOM, alıntı ve formül güvenliği içerir; eski snapshot yeniden hesaplanmaz', () => {
  const snapshot = { headers: ['Personel', 'Görev'], rows: [['=1+1', 3], ['Ad; "soyad"', 2]], totals: { gorev: 5 } };
  const before = JSON.stringify(snapshot);
  const csv = snapshotToCsv(snapshot, 'Rapor');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=1+1";"3"'));
  assert.ok(csv.includes('"Ad; ""soyad"""'));
  assert.equal(JSON.stringify(snapshot), before);
});

const today = new Date('2026-09-30T00:00:00.000Z');
const person = { id: 'representative', role: 'PERSONNEL', isActive: true };
const currentTeam = { id: 'team-1', representativeUserId: person.id, name: 'Yeni ekip adı', extraPersonnelCount: 6, includeRepresentative: true, isActive: true, effectiveFrom: today, representative: person };

test('ekip ve temsilci birlikte gönderildiğinde tek atama ve 7 kişi olur', () => {
  const result = resolveAssignmentSnapshots([person.id], [currentTeam.id], [person], [currentTeam], today, [], today);
  assert.equal(result.length, 1);
  assert.equal(result[0].headcountSnapshot, 7);
  assert.equal(result[0].workforceKindSnapshot, 'CONTRACTOR');
});

test('ekip düzenlense de mevcut görevde eski 5 sayısı ve adı korunur', () => {
  const oldAssignment = crew();
  const result = resolveAssignmentSnapshots([], [currentTeam.id], [], [currentTeam], today, [oldAssignment], today);
  assert.equal(result[0].headcountSnapshot, 5);
  assert.equal(result[0].teamNameSnapshot, 'Taşeron A');
  assert.equal(result[0].actualHeadcount, 5);
});

test('legacy tek hesap ataması normal kaydetmeyle bugünkü 1 sayısına çevrilmez', () => {
  const legacy = crew({ teamId: null, teamNameSnapshot: null, headcountSnapshot: null, actualHeadcount: null, workforceKindSnapshot: null });
  const result = resolveAssignmentSnapshots([person.id], [], [person], [], today, [legacy], today);
  assert.equal(result[0].headcountSnapshot, null);
  assert.equal(result[0].workforceKindSnapshot, null);
});

test('eski açık görev formu mevcut taşeron snapshotını bireysel personele dönüştürmez', () => {
  const old = crew();
  const result = resolveAssignmentSnapshots([person.id], [], [person], [], today, [old], today, true);
  assert.equal(result[0].teamId, old.teamId);
  assert.equal(result[0].headcountSnapshot, old.headcountSnapshot);
  assert.equal(result[0].workforceKindSnapshot, 'CONTRACTOR');
});

test('geçmiş göreve bugünkü ekip sayısı atanamaz; mevcut eski ekip kaydı korunabilir', () => {
  const yesterday = new Date('2026-09-29T00:00:00.000Z');
  assert.throws(() => resolveAssignmentSnapshots([], [currentTeam.id], [], [currentTeam], yesterday, [], today));
  assert.equal(resolveAssignmentSnapshots([], [currentTeam.id], [], [currentTeam], yesterday, [crew()], today)[0].headcountSnapshot, 5);
});

test('aynı temsilcinin eski ve yeni ekibi birlikte gelirse sıra fark etmeksizin reddedilir', () => {
  const replacement = { ...currentTeam, id: 'team-2' };
  for (const selected of [[currentTeam, replacement], [replacement, currentTeam]]) {
    assert.throws(() => resolveAssignmentSnapshots([], selected.map((item) => item.id), [], selected, today, [crew()], today));
  }
});

test('legacy kayıt aynı satır ve toplamlarla okunur, orijinal JSON değiştirilmez', () => {
  const old = { headers: ['Personel', 'Görev'], rows: [['Ali', 2]], totals: { gorev: 2 } };
  const before = JSON.stringify(old);
  const result = parseSavedReportSnapshot(old);
  assert.deepEqual(result.rows, old.rows);
  assert.deepEqual(result.totals, old.totals);
  assert.equal(result.schemaVersion, undefined);
  assert.equal(JSON.stringify(old), before);
});

test('geçersiz JSON snapshot güvenle boş tablo/uyarıya çevrilir', () => {
  assert.ok(parseSavedReportSnapshot(null).warnings.length);
  assert.deepEqual(parseSavedReportSnapshot({ headers: 'hatalı', rows: [null, [null, 3]] }).rows, [['Bilinmiyor', 3]]);
});
