import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { prepareReportExport, snapshotToCsv } from '../lib/reports/export.ts';
import { snapshotToXlsx } from '../lib/reports/xlsx.ts';

const xmlWindow = new JSDOM('').window;
test.after(() => xmlWindow.close());
const parseXml = (value) => {
  const document = new xmlWindow.DOMParser().parseFromString(value, 'application/xml');
  assert.equal(document.querySelector('parsererror'), null, 'every OOXML part must be valid XML');
  return document;
};
function checksum(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// An independent ZIP reader verifies directory offsets, counts, UTF-8 names and CRCs.
function readZip(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  assert.equal(buffer.readUInt16LE(end + 4), 0);
  assert.equal(buffer.readUInt16LE(end + 6), 0);
  const entries = buffer.readUInt16LE(end + 10);
  assert.equal(buffer.readUInt16LE(end + 8), entries);
  const directoryStart = buffer.readUInt32LE(end + 16);
  assert.equal(directoryStart + buffer.readUInt32LE(end + 12), end);
  const files = new Map();
  let cursor = directoryStart;
  for (let index = 0; index < entries; index++) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    assert.equal(buffer.readUInt16LE(cursor + 8), 0x0800);
    assert.equal(buffer.readUInt16LE(cursor + 10), 0, 'stored entry');
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const size = buffer.readUInt32LE(cursor + 24);
    assert.equal(buffer.readUInt32LE(cursor + 20), size);
    const offset = buffer.readUInt32LE(cursor + 42);
    assert.ok(offset < directoryStart);
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
    assert.equal(buffer.readUInt16LE(offset + 6), 0x0800);
    assert.equal(buffer.readUInt16LE(offset + 8), 0);
    assert.equal(buffer.readUInt32LE(offset + 18), size);
    assert.equal(buffer.readUInt32LE(offset + 22), size);
    assert.equal(buffer.readUInt16LE(offset + 26), nameLength);
    assert.equal(buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), name);
    const data = buffer.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    assert.equal(data.length, size);
    assert.equal(buffer.readUInt32LE(cursor + 16), checksum(data));
    assert.equal(buffer.readUInt32LE(offset + 14), checksum(data));
    files.set(name, parseXml(data.toString('utf8')));
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor, end);
  return files;
}
const context = { reportId: 'saved-42', reportType: 'PROJECT', startDate: '2026-10-01', endDate: '2026-10-06', createdAt: '2026-10-06T08:15:00Z', createdBy: 'Kayıt Yöneticisi' };
const snapshot = () => ({
  schemaVersion: 3, calculationVersion: 'report-3', generatedAt: '2026-10-06T07:59:00Z',
  headers: ['Proje', 'Görev'], rows: [['Şantiye; "A"', 2]], totals: { Görev: 2 },
  filters: { startDate: '2026-10-01', projectId: 'project-1' }, filterLabels: { Proje: 'Şantiye A' },
  metadata: { reportId: 'snapshot-id', reportType: 'PROJECT', startDate: '2026-10-01', endDate: '2026-10-06', timeZone: 'Europe/Istanbul', dateBasis: 'Görev günü ve olay zamanı', readAt: '2026-10-06T07:58:00Z', createdByUserId: 'admin-1', createdByName: 'Üreten Yönetici' },
  details: { headers: ['Tarih', 'Görev kimliği'], rows: [['2026-10-06', 'task-1']] },
  sections: [
    { id: 'notes', title: 'Notlar', description: 'Not kaynağı ayrı tutulur', headers: ['Not kimliği', 'Metin', 'Zaman'], rows: [['note-1', '=HYPERLINK("https://evil.test")', '2026-10-05T21:00:00Z']] },
    { id: 'files', title: 'Dosyalar', headers: ['Dosya kimliği', 'Bayt'], rows: [['file-1', 123456]] },
  ],
  trend: [{ date: '2026-10-06', tasks: 2, arrived: 1, closed: 1, minutes: 45, notes: 1, files: 1, visits: 1 }],
  definitions: ['Süre göreve ortaktır'], warnings: ['Bir ayrılış kaydı eksik'],
});
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freeze(item); } return value; }
function sheetFiles(files) { return [...files].filter(([name]) => name.startsWith('xl/worksheets/')); }
function getCell(sheet, address) { return sheet.querySelector(`c[r="${address}"]`); }

test('CSV carries record identity, filters, sections, source IDs and definitions without mutating snapshot', () => {
  const input = freeze(snapshot());
  const original = JSON.stringify(input);
  const csv = snapshotToCsv(input, 'Kapsamlı rapor', context);
  assert.ok(csv.startsWith('\uFEFF'));
  for (const expected of ['saved-42', 'PROJECT', 'Kayıt Yöneticisi', 'admin-1', 'Europe/Istanbul', 'report-3', 'Şema sürümü', 'Veri okuma zamanı', 'ISO 2026-10-06T07:59:00Z', 'ISO 2026-10-06T07:58:00Z', 'project-1', 'Not kaynağı ayrı tutulur', 'note-1', 'file-1', 'Günlük eğilim', 'Süre göreve ortaktır', 'Bir ayrılış kaydı eksik']) assert.ok(csv.includes(expected), expected);
  assert.ok(csv.includes('"Şantiye; ""A""";"2"'));
  assert.ok(csv.includes('"\'=HYPERLINK('));
  assert.equal(JSON.stringify(input), original);
});

test('XLSX is a valid OOXML ZIP with all saved tables and metadata, without snapshot mutation', () => {
  const input = freeze(snapshot());
  const original = JSON.stringify(input);
  const first = snapshotToXlsx(input, 'Kapsamlı rapor', context);
  assert.deepEqual(snapshotToXlsx(input, 'Kapsamlı rapor', context), first, 'same saved values give deterministic bytes');
  const files = readZip(first);
  const workbook = files.get('xl/workbook.xml');
  const sheets = workbook.querySelectorAll('sheet');
  assert.equal(sheets.length, 9);
  const names = [...sheets].map((sheet) => sheet.getAttribute('name'));
  for (const name of ['Rapor bilgisi', 'Özet', 'Toplamlar', 'Ayrıntı', 'Notlar', 'Dosyalar', 'Günlük eğilim', 'Hesap tanımları', 'Eksik veri ve uyarılar']) assert.ok(names.includes(name));
  const all = sheetFiles(files).map(([, document]) => document.documentElement.textContent).join('\n');
  for (const expected of ['saved-42', 'Kayıt Yöneticisi', 'note-1', 'file-1', 'report-3', 'Europe/Istanbul', 'admin-1', 'project-1']) assert.ok(all.includes(expected), expected);
  assert.equal(files.get('xl/_rels/workbook.xml.rels').querySelectorAll('Relationship').length, sheets.length + 1);
  assert.equal(files.get('[Content_Types].xml').querySelectorAll('Override').length, sheets.length + 2);
  assert.equal(JSON.stringify(input), original);
});

test('XLSX keeps numbers numeric, IDs and formulas as text, dates and Istanbul timestamp as serials', () => {
  const input = { headers: ['Sayı', 'Kimlik', 'Metin', 'Tarih', 'Zaman'], rows: [[-2.5, '0000123', '=1+1', '2026-10-06', '2026-10-05T21:00:00Z']] };
  const files = readZip(snapshotToXlsx(input, 'Türler'));
  const table = files.get('xl/worksheets/sheet2.xml');
  assert.equal(getCell(table, 'A3').getAttribute('t'), 'n');
  assert.equal(getCell(table, 'A3').textContent, '-2.5');
  assert.equal(getCell(table, 'B3').getAttribute('t'), 'inlineStr');
  assert.equal(getCell(table, 'B3').textContent, '0000123');
  assert.equal(getCell(table, 'C3').getAttribute('t'), 'inlineStr');
  assert.equal(getCell(table, 'C3').textContent, '=1+1');
  assert.equal(getCell(table, 'D3').getAttribute('s'), '2');
  assert.equal(getCell(table, 'E3').getAttribute('s'), '3');
  assert.equal(getCell(table, 'D3').textContent, getCell(table, 'E3').textContent, '21:00 UTC is next Istanbul calendar day midnight');
  assert.equal(Number(getCell(table, 'D3').textContent), 46301);
  for (const [, document] of sheetFiles(files)) assert.equal(document.querySelector('f'), null);
  assert.ok(table.querySelector('pane[state="frozen"]'));
  assert.ok(table.querySelector('autoFilter'));
  assert.ok(table.querySelector('col[customWidth="1"]'));
});

test('worksheet names are valid, distinct and bounded while Turkish content is preserved', () => {
  const input = { sections: ['Şantiye / [Notlar]: Çok uzun bölüm ismi', 'Şantiye / [Notlar]: Çok uzun bölüm ismi', 'history', "''", 'a'.repeat(30) + "'xx", 'a'.repeat(30) + '🏗️'].map((title, index) => ({ id: String(index), title, headers: ['Değer'], rows: [['İşçilik ölçümü 🏗️']] })) };
  const files = readZip(snapshotToXlsx(input, 'İşçilik'));
  const names = [...files.get('xl/workbook.xml').querySelectorAll('sheet')].map((sheet) => sheet.getAttribute('name'));
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length);
  for (const name of names) { assert.ok(name.length <= 31); assert.doesNotMatch(name, /[\\/?*\[\]:]/); assert.ok(!name.startsWith("'") && !name.endsWith("'")); }
  assert.ok(sheetFiles(files).some(([, sheet]) => sheet.documentElement.textContent.includes('İşçilik ölçümü 🏗️')));
});

test('legacy snapshots retain rows and totals; malformed dates and illegal XML characters remain harmless text', () => {
  const input = { headers: ['Değer', 'Tarih'], rows: [['<&"\u0000_x000A_ 🏗️', '2026-02-30'], ['\t@SUM(1)', '2026-10-06T25:00:00Z']], totals: { gorev: 2 } };
  const files = readZip(snapshotToXlsx(input, 'Eski rapor'));
  const table = files.get('xl/worksheets/sheet2.xml');
  assert.equal(getCell(table, 'B3').getAttribute('t'), 'inlineStr');
  assert.equal(getCell(table, 'B3').textContent, '2026-02-30');
  assert.equal(getCell(table, 'B4').getAttribute('t'), 'inlineStr');
  assert.equal(getCell(table, 'A3').textContent, '<&"�_x005F_x000A_ 🏗️');
  assert.ok(files.get('xl/worksheets/sheet3.xml').documentElement.textContent.includes('gorev2'));
  assert.ok(snapshotToCsv(input, 'Eski rapor').includes('"\'\t@SUM(1)"'));
  assert.ok(snapshotToCsv({}, 'Boş rapor').includes('Bilinmiyor'));
  readZip(snapshotToXlsx({}, 'Boş rapor'));
});

test('exports use recorded timezone and leave timestamps without a zone as explicit text', () => {
  const input = { metadata: { timeZone: 'UTC' }, headers: ['Saat'], rows: [['2026-10-06T10:20:00Z'], ['2026-10-06T10:20:00']] };
  const csv = snapshotToCsv(input, 'Saat dilimi');
  assert.ok(csv.includes('"UTC"'));
  assert.ok(csv.includes('10:20'));
  assert.ok(csv.includes('"2026-10-06T10:20:00"'));
  const files = readZip(snapshotToXlsx(input, 'Saat dilimi'));
  const table = files.get('xl/worksheets/sheet2.xml');
  assert.equal(getCell(table, 'A3').getAttribute('s'), '3');
  assert.equal(getCell(table, 'A4').getAttribute('t'), 'inlineStr');
  const actualTime = Number(getCell(table, 'A3').textContent) % 1 * 1440;
  assert.ok(Math.abs(actualTime - 620) < 0.00001);
  assert.ok(snapshotToCsv({ metadata: { timeZone: 'invalid/timezone' } }, 'Eski bilgi').includes('Europe/Istanbul'));
});

test('oversized Excel cells and worksheet counts fail explicitly instead of truncating data', () => {
  assert.throws(() => snapshotToXlsx({ rows: [['x'.repeat(32_768)]] }, 'Büyük not'), /32\.767/);
  assert.throws(() => snapshotToXlsx({ headers: Array.from({ length: 16_385 }, () => 'x') }, 'Çok sütun'), /sütun sınırı/);
  assert.throws(() => snapshotToXlsx({ sections: Array.from({ length: 512 }, (_, index) => ({ id: String(index), title: String(index), headers: [], rows: [] })) }, 'Çok bölüm'), /512/);
});

test('date-looking names, IDs and notes remain literal text while temporal fields keep date types', () => {
  const input = { headers: ['Kaynak ID', 'Dosya adı', 'Not', 'Kayıt zamanı'], rows: [['2026-10-06', '2026-10-06T08:00:00Z', '2026-10-06', '2026-10-06T08:00:00Z']] };
  const table = readZip(snapshotToXlsx(input, 'Türlerin korunması')).get('xl/worksheets/sheet2.xml');
  assert.equal(getCell(table, 'A3').getAttribute('t'), 'inlineStr'); assert.equal(getCell(table, 'A3').textContent, '2026-10-06');
  assert.equal(getCell(table, 'B3').textContent, '2026-10-06T08:00:00Z'); assert.equal(getCell(table, 'C3').textContent, '2026-10-06');
  assert.equal(getCell(table, 'D3').getAttribute('s'), '3');
  const csv = snapshotToCsv(input, 'Türlerin korunması');
  assert.ok(csv.includes('"2026-10-06";"2026-10-06T08:00:00Z";"2026-10-06";')); assert.ok(csv.includes('11:00:00'));
});

test('unread visit metrics stay out of daily export tables rather than appearing as zero', () => {
  const input = { ...snapshot(), excludedMetrics: ['visits'] };
  const daily = prepareReportExport(input, 'Görev filtresi').find((sheet) => sheet.title === 'Günlük eğilim');
  assert.equal(daily.headers.includes('Ziyaret'), false); assert.equal(daily.rows[0].length, daily.headers.length);
  const files = readZip(snapshotToXlsx(input, 'Görev filtresi'));
  const names = [...files.get('xl/workbook.xml').querySelectorAll('sheet')].map((item) => item.getAttribute('name'));
  const sheet = files.get(`xl/worksheets/sheet${names.indexOf('Günlük eğilim') + 1}.xml`);
  assert.equal(sheet.querySelector('row[r="2"]').textContent.includes('Ziyaret'), false);
});
