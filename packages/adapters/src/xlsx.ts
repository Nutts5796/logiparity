import { wallClock } from '@logiparity/core';
import { xlsxLimits } from './xlsx-limits.js';
import { posix } from 'node:path';
import unzipper from 'unzipper';
import { xmlEvents } from './xlsx-xml.js';
import { SharedStrings } from './xlsx-strings.js';

export interface XlsxRow {
  number: number;
  values: unknown[];
}
interface Cell {
  column: number;
  type: string;
  style: number;
  value: string;
  text: string;
  formula: boolean;
  cached: boolean;
}
const dates = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56,
  57, 58,
]);
const dateFormat = (format: string) => /[ymdhs]/i.test(format.replace(/"[^"]*"|\\.|\[(?![hms]+\])[^\]]*\]/gi, ''));
const unescapeText = (text: string) =>
  text.replace(/_x([\da-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

async function metadata(
  archive: unzipper.CentralDirectory,
  sheetName: string,
): Promise<{ path: string; date1904: boolean; dateStyles: Set<number> }> {
  const workbook = archive.files.find((entry) => entry.path === 'xl/workbook.xml');
  const relationships = archive.files.find((entry) => entry.path === 'xl/_rels/workbook.xml.rels');
  if (!workbook || !relationships)
    throw new Error('XLSX workbook metadata is missing; save a valid unencrypted .xlsx file.');
  let id: string | undefined;
  let date1904 = false;
  for await (const event of xmlEvents(workbook))
    if (event.type === 'open') {
      if (event.name === 'workbookPr') date1904 = ['1', 'true'].includes(event.attributes.date1904 ?? '');
      if (event.name === 'sheet' && event.attributes.name === sheetName)
        id = Object.entries(event.attributes).find(([key]) => key.endsWith(':id'))?.[1];
    }
  let path: string | undefined;
  for await (const event of xmlEvents(relationships))
    if (
      event.type === 'open' &&
      event.name === 'Relationship' &&
      event.attributes.Id === id &&
      event.attributes.TargetMode !== 'External'
    )
      path = posix.normalize(
        event.attributes.Target!.startsWith('/')
          ? event.attributes.Target!.slice(1)
          : posix.join('xl', event.attributes.Target!),
      );
  if (!path || path.startsWith('../'))
    throw new Error(`Header was not found in sheet "${sheetName}"; check the sheet name.`);
  const dateStyles = new Set<number>();
  const formats = new Map<number, string>();
  let inCellXfs = false;
  let index = 0;
  const styles = archive.files.find((entry) => entry.path === 'xl/styles.xml');
  if (styles)
    for await (const event of xmlEvents(styles)) {
      if (event.type === 'open') {
        if (event.name === 'numFmt') formats.set(Number(event.attributes.numFmtId), event.attributes.formatCode ?? '');
        if (event.name === 'cellXfs') inCellXfs = true;
        if (event.name === 'xf' && inCellXfs) {
          const id = Number(event.attributes.numFmtId);
          if (dates.has(id) || dateFormat(formats.get(id) ?? '')) dateStyles.add(index);
          index++;
        }
      } else if (event.type === 'close' && event.name === 'cellXfs') inCellXfs = false;
    }
  return { path, date1904, dateStyles };
}

async function readSharedStrings(entry: unzipper.File, strings: SharedStrings): Promise<void> {
  let value = '';
  let inText = false;
  let phonetic = false;
  for await (const event of xmlEvents(entry)) {
    if (event.type === 'open') {
      if (event.name === 'si') value = '';
      if (event.name === 'rPh') phonetic = true;
      if (event.name === 't') inText = true;
    }
    if (event.type === 'text' && inText && !phonetic) {
      if (value.length + event.text.length > xlsxLimits.cellChars)
        throw new Error('XLSX shared string exceeds the 1 MiB cell limit.');
      value += event.text;
    }
    if (event.type === 'close') {
      if (event.name === 'rPh') phonetic = false;
      if (event.name === 't') inText = false;
      if (event.name === 'si') await strings.add(unescapeText(value));
    }
  }
  await strings.flush();
}

async function cellValue(
  cell: Cell,
  strings: SharedStrings,
  dateStyles: Set<number>,
  date1904: boolean,
): Promise<unknown> {
  if (cell.formula && !cell.cached)
    return new Error('Formula has no cached result; recalculate and save the workbook.');
  switch (cell.type) {
    case 's':
      return strings.get(Number(cell.value));
    case 'inlineStr':
      return unescapeText(cell.text);
    case 'str':
      return unescapeText(cell.value);
    case 'b':
      if (!['0', '1', 'true', 'false'].includes(cell.value)) return new Error('Invalid XLSX boolean.');
      return ['1', 'true'].includes(cell.value);
    case 'e':
      return new Error('Unsupported or error XLSX cell; export a scalar value.');
    case 'd': {
      const text = cell.value.replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, '');
      const date = new Date(text + 'Z');
      if (Number.isNaN(date.getTime())) return new Error('Invalid XLSX date.');
      Object.defineProperty(date, wallClock, { value: text });
      return date;
    }
    case '':
    case 'n': {
      if (!cell.cached) return null;
      const number = Number(cell.value);
      if (!Number.isFinite(number) || !cell.value.trim()) return new Error('Invalid XLSX number.');
      if (dateStyles.has(cell.style)) {
        const date = new Date(Math.round((number - (date1904 ? 24107 : number < 60 ? 25568 : 25569)) * 86400000));
        Object.defineProperty(date, wallClock, { value: date.toISOString().replace(/Z$/, '') });
        return date;
      }
      return number;
    }
    default:
      return new Error(`Unsupported XLSX cell type ${cell.type}.`);
  }
}

// Open metadata by central-directory path, then stream only the selected worksheet.
export async function* xlsxRows(file: string, sheetName: string): AsyncIterable<XlsxRow> {
  const archive = await unzipper.Open.file(file);
  const { path, date1904, dateStyles } = await metadata(archive, sheetName);
  const worksheet = archive.files.find((entry) => entry.path === path);
  if (!worksheet) throw new Error(`XLSX worksheet part ${path} is missing.`);
  const strings = await SharedStrings.create();
  let currentRow = 0;
  try {
    const shared = archive.files.find((entry) => entry.path === 'xl/sharedStrings.xml');
    if (shared) await readSharedStrings(shared, strings);
    let row: XlsxRow = { number: 0, values: [] };
    let cell: Cell | undefined;
    let inValue = false;
    let inText = false;
    let materializedBytes = 0;
    for await (const event of xmlEvents(worksheet)) {
      if (event.type === 'open') {
        if (event.name === 'row') {
          row = { number: Number(event.attributes.r ?? row.number + 1), values: [] };
          currentRow = row.number;
        }
        if (event.name === 'c') {
          const letters = event.attributes.r?.match(/^[A-Z]+/i)?.[0];
          const column = letters
            ? [...letters.toUpperCase()].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1
            : row.values.length;
          if (column < 0 || column >= 16384) throw new Error('XLSX column is outside the supported worksheet range.');
          cell = {
            column,
            type: event.attributes.t ?? '',
            style: Number(event.attributes.s ?? 0),
            value: '',
            text: '',
            formula: false,
            cached: false,
          };
        }
        if (cell && event.name === 'f') cell.formula = true;
        if (cell && event.name === 'v') {
          inValue = true;
          cell.cached = true;
        }
        if (cell && event.name === 't') inText = true;
      } else if (event.type === 'text' && cell) {
        if (cell.value.length + cell.text.length + event.text.length > xlsxLimits.cellChars)
          throw new Error(`XLSX cell exceeds the 1 MiB limit (sheet ${sheetName}, row ${row.number}).`);
        if (inValue) cell.value += event.text;
        if (inText) cell.text += event.text;
      } else if (event.type === 'close') {
        if (event.name === 'v') inValue = false;
        if (event.name === 't') inText = false;
        if (event.name === 'c' && cell) {
          const value = await cellValue(cell, strings, dateStyles, date1904);
          materializedBytes += typeof value === 'string' ? Buffer.byteLength(value) : 16;
          if (materializedBytes > xlsxLimits.materializedBytes)
            throw new Error(
              `XLSX materialized text exceeds the 64 MiB sheet/source quota (sheet ${sheetName}, row ${row.number}).`,
            );
          row.values[cell.column] = value;
          cell = undefined;
        }
        if (event.name === 'row') yield row;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      message.includes('(sheet ')
        ? message
        : `${message} (sheet ${sheetName}${currentRow ? `, row ${currentRow}` : ''}).`,
    );
  } finally {
    await strings.close();
  }
}
