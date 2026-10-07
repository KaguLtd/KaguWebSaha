import { parseDateOnly } from "../dates/calendar";
import { exportTimeZone, isTemporalExportCell, prepareReportExport } from "./export";
import type { ExportSheet, ExportSnapshot, ReportExportContext } from "./export";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIP_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_CELLS = 2_000_000;
const MAX_SHEETS = 512;

function cleanText(value: string) {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    result += code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff ? character : "�";
  }
  return result;
}
function xml(value: string) {
  return cleanText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function textXml(value: string) {
  // Preserve literal OOXML escape-looking strings, rather than decoding user text.
  return xml(value.replace(/_x[\da-f]{4}_/gi, (match) => `_x005F_${match.slice(1)}`));
}
function columnName(index: number) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}
function uniqueSheetName(title: string, used: Set<string>) {
  const base = cleanText(title).replace(/[\\/?*\[\]:]/g, " ").replace(/^'+|'+$/g, "").trim() || "Bölüm";
  const truncate = (value: string, limit: number) => cleanText(value.slice(0, limit)).replace(/^'+|'+$/g, "") || "Bölüm";
  let name = truncate(base, 31);
  let suffix = 1;
  while (used.has(name.toLocaleLowerCase("en-US")) || name.toLocaleLowerCase("en-US") === "history") {
    const ending = ` (${++suffix})`;
    name = truncate(base, 31 - ending.length) + ending;
  }
  used.add(name.toLocaleLowerCase("en-US"));
  return name;
}

function excelDateSerial(timestamp: number) {
  // Excel's 1900 date system includes a fictitious 1900-02-29.
  const epoch = Date.UTC(1899, 11, 31);
  return (timestamp - epoch) / 86_400_000 + (timestamp >= Date.UTC(1900, 2, 1) ? 1 : 0);
}
function typedDate(value: string, formatter: Intl.DateTimeFormat): { value: number; style: number } | null {
  const dateOnly = parseDateOnly(value);
  if (dateOnly && dateOnly.getUTCFullYear() >= 1900) return { value: excelDateSerial(dateOnly.getTime()), style: 2 };
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !parseDateOnly(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = formatter.formatToParts(instant);
  const component = (name: string) => Number(parts.find((part) => part.type === name)?.value);
  const year = component("year");
  if (year < 1900 || year > 9999) return null;
  const local = Date.UTC(year, component("month") - 1, component("day"), component("hour"), component("minute"), component("second"), instant.getUTCMilliseconds());
  return { value: excelDateSerial(local), style: 3 };
}
function cell(value: number | string, address: string, formatter: Intl.DateTimeFormat, style?: number, allowDate = false) {
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${address}" s="${style ?? 0}" t="n"><v>${value}</v></c>`;
  const text = typeof value === "string" ? value : "Bilinmiyor";
  if (text.length > 32_767) throw new Error("Excel hücresi 32.767 karakter sınırını aşıyor. Bu raporu CSV olarak indirin.");
  const date = style === undefined && allowDate ? typedDate(text, formatter) : null;
  if (date) return `<c r="${address}" s="${date.style}" t="n"><v>${date.value}</v></c>`;
  // User content is always an inline string, including =, +, -, @ and URLs. No formula nodes.
  return `<c r="${address}" s="${style ?? 0}" t="inlineStr"><is><t xml:space="preserve">${textXml(text)}</t></is></c>`;
}

function worksheet(sheet: ExportSheet, timeZone: string, budget: { cells: number; bytes: number }) {
  const formatter = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let columns = Math.max(1, sheet.headers.length);
  for (const row of sheet.rows) columns = Math.max(columns, row.length);
  if (columns > 16_384 || sheet.rows.length + 3 > 1_048_576) throw new Error("Rapor Excel satır veya sütun sınırını aşıyor. Filtreleri daraltın.");
  const output: string[] = [];
  const widths = Array.from({ length: columns }, () => 12);
  let rowNumber = 0;
  const addRow = (values: Array<number | string>, style?: number) => {
    budget.cells += values.length;
    if (budget.cells > MAX_CELLS) throw new Error("Excel raporu çok büyük. Tarih veya proje filtresini daraltın.");
    rowNumber++;
    const cells = values.map((value, index) => {
      if (style !== 4 && style !== 5) widths[index] = Math.max(widths[index] ?? 12, Math.min(60, String(value).split(/\r?\n/).reduce((length, line) => Math.max(length, line.length), 0) + 2));
      return cell(value, `${columnName(index)}${rowNumber}`, formatter, style, style === undefined && isTemporalExportCell(sheet, values, index));
    }).join("");
    const row = `<row r="${rowNumber}">${cells}</row>`;
    budget.bytes += Buffer.byteLength(row);
    if (budget.bytes > MAX_ARCHIVE_BYTES) throw new Error("Excel raporu 64 MiB sınırını aşıyor. Filtreleri daraltın.");
    output.push(row);
  };
  addRow([sheet.title], 4);
  if (sheet.description) addRow([sheet.description], 5);
  const headerRow = rowNumber + 1;
  addRow(sheet.headers, 1);
  for (const row of sheet.rows) addRow(row);
  const lastColumn = columnName(columns - 1);
  const range = `A1:${lastColumn}${rowNumber}`;
  const filters = sheet.headers.length && sheet.rows.length ? `<autoFilter ref="A${headerRow}:${lastColumn}${rowNumber}"/>` : "";
  return `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}"><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${output.join("")}</sheetData>${filters}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

const STYLES = `${XML_DECLARATION}<styleSheet xmlns="${SPREADSHEET_NS}"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="15"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(data: Buffer) {
  let value = 0xffffffff;
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
}

/** PKWARE APPNOTE stored ZIP: bounded, deterministic, UTF-8, CRC32; no ZIP64 required. */
function zip(files: Array<{ name: string; content: string }>) {
  if (files.length > 65_535) throw new Error("Excel dosyasında çok fazla bölüm var.");
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  let centralSize = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.content, "utf8");
    if (name.length > 65_535 || data.length > 0xffffffff) throw new Error("Excel ZIP sınırı aşıldı.");
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8); header.writeUInt16LE(33, 12); // 1980-01-01 DOS date; no fresh export timestamp.
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(0, 10); directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(directory, name);
    offset += header.length + name.length + data.length;
    centralSize += directory.length + name.length;
    if (offset + centralSize + 22 > MAX_ARCHIVE_BYTES) throw new Error("Excel raporu 64 MiB sınırını aşıyor. Filtreleri daraltın.");
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end], offset + centralSize + end.length);
}

/** Creates a real .xlsx from a saved snapshot, without formulas, external links or database reads. */
export function snapshotToXlsx(snapshot: ExportSnapshot, title: string, context: ReportExportContext = {}): Buffer {
  const sheets = prepareReportExport(snapshot, title, context);
  if (sheets.length > MAX_SHEETS) throw new Error("Excel raporu 512 bölüm sınırını aşıyor.");
  const usedNames = new Set<string>();
  const names = sheets.map((sheet) => uniqueSheetName(sheet.title, usedNames));
  const files = [
    { name: "[Content_Types].xml", content: `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", content: `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIP_NS}"><Relationship Id="rId1" Type="${RELATIONSHIP_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `${XML_DECLARATION}<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${RELATIONSHIP_NS}"><workbookPr date1904="0"/><bookViews><workbookView/></bookViews><sheets>${names.map((name, index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIP_NS}">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${RELATIONSHIP_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${RELATIONSHIP_NS}/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: STYLES },
  ];
  const budget = { cells: 0, bytes: 0 };
  const timeZone = exportTimeZone(snapshot);
  for (const [index, sheet] of sheets.entries()) files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, content: worksheet(sheet, timeZone, budget) });
  return zip(files);
}
